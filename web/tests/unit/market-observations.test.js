import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BLENDED_GUIDES_SQL, COMPARISON_SQL, LUKKA_ONLY_GUIDES_SQL, LUKKA_RENTS_SQL, MARKET_RENTS_SQL, SET_EXCLUSION_SQL,
  queryPriceGuides, setObservationExclusion,
} from '@/lib/marketGuide';
import {
  COLLECTED_SOURCES, MANUAL_SOURCES, MARKET_SOURCES, PROPERTY_KINDS, RESIDENTIAL_KINDS,
  manualSourceRef, prefillFromExtraction, validateManualObservation,
} from '@/lib/marketObservationRules';
import { PRICE_GUIDES_SQL } from '@/lib/browseFeatures';
import { PERMISSIONS } from '@/lib/adminRoles';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Asking prices seen outside Lukka Place (2026-11-04): the blended price
 * guide, the commune comparison and hand entry. web/CLAUDE.md, "Market
 * observations"; engine root CLAUDE.md, same heading.
 */

const squash = (sql) => sql.replace(/\s+/g, ' ');
const ENGINE = path.join(process.cwd(), '..');
const read = (file) => readFileSync(path.join(ENGINE, file), 'utf8');

beforeEach(() => reset());

test('the guide is the blended query, and Lukka listings still pass the public gate', () => {
  assert.equal(PRICE_GUIDES_SQL, BLENDED_GUIDES_SQL);
  const lukka = squash(LUKKA_RENTS_SQL);
  assert.match(lukka, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(lukka, /test_agent/);
  assert.match(lukka, /NOT IN \('jour', 'semaine'\)/);
  assert.match(lukka, /'furnished'\)::boolean, false\) = false/, 'furnished homes are a different market');
});

test('an observation counts only when clean, a home, recent, still online and not already a Lukka listing', () => {
  const market = squash(MARKET_RENTS_SQL);
  assert.match(market, /o\.excluded_reason IS NULL/);
  assert.match(market, /o\.furnished IS NOT TRUE/);
  assert.match(market, /o\.property_kind = ANY\(\$2::text\[\]\)/);
  assert.match(market, /o\.beds BETWEEN 1 AND 5/);
  assert.match(market, /INTERVAL '365 days'/);
  assert.match(market, /o\.last_seen_at >= NOW\(\) - INTERVAL '60 days'/);
  // A published group capture is counted once, as the Lukka listing; a
  // rejected or deleted one not at all.
  assert.match(market, /NOT EXISTS \( SELECT 1 FROM properties lp WHERE lp\.id = o\.property_id/);
  assert.match(market, /lp\.approve_status = 2/);
  assert.match(market, /deleted_at/);
});

test('the same price on several sources counts as the most any one source shows, never the sum', () => {
  const sql = squash(BLENDED_GUIDES_SQL);
  assert.match(sql, /GROUP BY commune, beds, ROUND\(amount\), src/);
  assert.match(sql, /SELECT commune, beds, amt, MAX\(n\)::int AS n/);
  assert.match(sql, /generate_series\(1, points\.n\)/);
  assert.match(sql, /HAVING COUNT\(\*\) >= \$1/);
  assert.match(sql, /lukka_listings/);
});

/** A pool that answers from a script: an Error entry is thrown, anything else is the rows. */
function scriptedPool(script) {
  const seen = [];
  return {
    seen,
    async query(text, values) {
      seen.push({ text, values });
      const next = script.shift();
      if (next instanceof Error) throw next;
      return { rows: next || [] };
    },
  };
}

test('before the migration the guide falls back to Lukka listings only', async () => {
  const pool = scriptedPool([
    Object.assign(new Error('relation "market_observations" does not exist'), { code: '42P01' }),
    [{ commune: 'Limete', beds: 2, listings: 6, median: 450, p25: 400, p75: 500, lukka_listings: 6, sources: {} }],
  ]);
  const rows = await queryPriceGuides(5, { pool });
  assert.equal(rows.length, 1);
  assert.equal(pool.seen.length, 2);
  assert.equal(pool.seen[1].text, LUKKA_ONLY_GUIDES_SQL);
  assert.deepEqual(pool.seen[0].values, [5, RESIDENTIAL_KINDS]);
});

test('any other database error is not hidden behind the fallback', async () => {
  const pool = scriptedPool([Object.assign(new Error('syntax error'), { code: '42601' })]);
  await assert.rejects(() => queryPriceGuides(5, { pool }), /syntax error/);
});

test('the comparison binds the kinds as its only parameter', () => {
  assert.match(squash(COMPARISON_SQL), /o\.property_kind = ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(COMPARISON_SQL, /\$2/);
  assert.match(squash(COMPARISON_SQL), /FULL OUTER JOIN/);
});

test('an automatic exclusion cannot be restored by hand', async () => {
  assert.match(squash(SET_EXCLUSION_SQL), /\$2::text IS NOT NULL OR excluded_reason IS NULL OR excluded_reason LIKE 'manual:%'/);
  enqueue([]);
  assert.equal(await setObservationExclusion(9, null), null);
  assert.deepEqual(calls.at(-1).values, [9, null]);
});

test('hand entry: only Facebook / Zwandako / other, a link unless Facebook, dollars, a monthly or yearly rent, a listed commune', () => {
  const base = { source: 'zwandako', source_url: 'https://zwandako.com/immobilier/x/', purpose: 'rent', property_kind: 'appartement', beds: '2', price: '1 200', price_period: 'an', commune: 'Limete' };
  const ok = validateManualObservation(base, { communes: ['Limete', 'Gombe'] });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.monthly_usd, 100);
  assert.equal(ok.value.price, 1200);
  assert.equal(validateManualObservation({ ...base, source: 'smartimmo' }).error, 'source', 'collected sources are not typed in');
  assert.equal(validateManualObservation({ ...base, source_url: '' }).error, 'urlRequired');
  assert.equal(validateManualObservation({ ...base, source: 'facebook', source_url: '' }, { communes: ['Limete'] }).ok, true);
  assert.equal(validateManualObservation({ ...base, source_url: 'javascript:alert(1)' }).error, 'url');
  assert.equal(validateManualObservation({ ...base, currency: 'CDF' }).error, 'currency');
  assert.equal(validateManualObservation({ ...base, price_period: 'jour' }).error, 'shortStay');
  assert.equal(validateManualObservation({ ...base, price: '250000', price_period: 'mois' }).error, 'priceRange');
  assert.equal(validateManualObservation({ ...base, commune: 'Atlantis' }, { communes: ['Limete'] }).error, 'commune');
  assert.equal(validateManualObservation({ ...base, property_kind: 'castle' }).error, 'kind');
  assert.equal(validateManualObservation({ ...base, posted_at: '2024-01-01' }, { now: new Date('2026-11-04T00:00:00Z') }).error, 'dateOld');
  assert.equal(validateManualObservation({ ...base, beds: '' }).value.beds, null, 'not stated stays unknown');
});

test('the same link entered twice is one row; no link gets a one-off reference', () => {
  assert.equal(manualSourceRef({ source_url: 'https://zwandako.com/immobilier/x/' }), 'url:https://zwandako.com/immobilier/x/');
  assert.match(manualSourceRef({ source_url: null }), /^manual:\d+:/);
});

test('a pasted post prefills from the engine extraction without inventing a commune', () => {
  const fields = prefillFromExtraction(
    { transaction_type: 'location', property_type: 'parcelle', parcelle_subtype: 'maison_type_locataire', bedrooms: 3, price: 450, price_period: 'mois', commune: 'limete', furnished: false },
    ['Limete', 'Gombe'],
  );
  assert.deepEqual(
    [fields.purpose, fields.property_kind, fields.beds, fields.price, fields.commune, fields.furnished],
    ['rent', 'maison', '3', '450', 'Limete', 'no'],
  );
  assert.equal(prefillFromExtraction({ commune: 'Nowhere' }, ['Limete']).commune, '');
});

test('web and engine agree on the sources, the kinds and the migration', () => {
  const engine = read('services/marketObservations.js');
  const migration = read('migrations/20261104_market_observations.sql');
  for (const source of MARKET_SOURCES) {
    assert.ok(engine.includes(`'${source}'`), `engine knows ${source}`);
    assert.ok(migration.includes(`'${source}'`), `migration CHECK lists ${source}`);
  }
  assert.match(engine, new RegExp(`COLLECTED_SOURCES = \\[${COLLECTED_SOURCES.map((s) => `'${s}'`).join(', ')}\\]`));
  assert.match(engine, new RegExp(`MANUAL_SOURCES = \\[${MANUAL_SOURCES.map((s) => `'${s}'`).join(', ')}\\]`));
  assert.match(engine, new RegExp(`RESIDENTIAL_KINDS = \\[${RESIDENTIAL_KINDS.map((s) => `'${s}'`).join(', ')}\\]`));
  for (const kind of PROPERTY_KINDS) assert.ok(engine.includes(`'${kind}'`), `engine knows kind ${kind}`);
});

test('entering and excluding observations is a permission of its own', () => {
  assert.deepEqual(PERMISSIONS['market.manage'], ['owner', 'moderator', 'analyst']);
  const actions = readFileSync(path.join(process.cwd(), 'app/admin/market-data/marche/actions.js'), 'utf8');
  assert.equal((actions.match(/requireAdmin\('market\.manage'\)/g) || []).length, 3);
  assert.match(actions, /recordAudit/);
});
