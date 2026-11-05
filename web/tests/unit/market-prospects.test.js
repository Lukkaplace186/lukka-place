import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  advertToRow, formatProspectPhone, mergeSources, observationInput, pasteRefSeed, prospectPhone,
  PROSPECT_CHANNELS, PROSPECT_STATUSES, validateProspect,
} from '@/lib/marketProspectRules';
import { validateManualObservation } from '@/lib/marketObservationRules';
import {
  UPSERT_PROSPECT_SQL, buildProspectListQuery, saveMarketPasteBatch, updateProspect,
} from '@/lib/marketProspects';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };
import { calls, enqueue, reset, getPool } from '../support/fakePool.js';

/**
 * "Coller des annonces" (2026-11-05): one paste feeds the price guide AND
 * the agent prospects list. Engine half: services/marketPaste.js (§75).
 */

const squash = (sql) => sql.replace(/\s+/g, ' ');
const ENGINE = path.join(process.cwd(), '..');
const COMMUNES = ['Ngaliema', 'Limete', 'Gombe'];

beforeEach(() => reset());

const advert = (over = {}) => ({
  purpose: 'rent', property_kind: 'appartement', beds: 2, price: 600, price_unverified: false, currency: 'USD', price_period: 'mois',
  furnished: null, commune: 'Ngaliema', commune_written: 'Ngaliema', commune_from_quartier: false, quartier: 'Mbinza Delvaux',
  contact_name: 'Jean Mukendi', agency_name: 'Bonheur Immo', contact_phone: '243812345678', posted_hint: null, title: 'Appartement 2 ch.', ...over,
});

test('a DRC number in any written form becomes 243…; anything else stays digits or nothing', () => {
  assert.equal(prospectPhone('0812 345 678'), '243812345678');
  assert.equal(prospectPhone('+243 81 234 5678'), '243812345678');
  assert.equal(prospectPhone('812345678'), '243812345678');
  assert.equal(prospectPhone('+33 6 12 34 56 78'), '33612345678');
  assert.equal(prospectPhone('12'), null);
  assert.equal(formatProspectPhone('243812345678'), '+243 812 345 678');
});

test('an engine advert becomes an editable row, and never gains a fact the engine did not keep', () => {
  const row = advertToRow(advert(), 0, { communes: COMMUNES });
  assert.equal(row.commune, 'Ngaliema');
  assert.equal(row.price, '600');
  assert.equal(row.phone, '243812345678');
  assert.equal(row.keepProspect, true);
  const blank = advertToRow(advert({ commune: null, commune_written: 'Mbinza', price: null, price_unverified: true, contact_phone: null }), 1, { communes: COMMUNES });
  assert.equal(blank.commune, '');
  assert.equal(blank.communeWritten, 'Mbinza');
  assert.equal(blank.price, '');
  assert.equal(blank.priceUnverified, true);
  assert.equal(blank.keepProspect, false, 'no number, no prospect');
  assert.equal(advertToRow(advert({ commune: 'Kintambo' }), 2, { communes: COMMUNES }).commune, '', 'only a commune of the allow-list');
});

test('a prospect needs a number; a name alone is not one', () => {
  assert.deepEqual(validateProspect({ keepProspect: false }), { ok: true, value: null });
  assert.equal(validateProspect({ keepProspect: true, phone: '', name: 'Jean' }).error, 'phone');
  assert.deepEqual(validateProspect({ keepProspect: true, phone: '0812345678', name: ' Jean  M ', agency: '' }).value, { phone: '243812345678', name: 'Jean M', agency: null });
});

test('a batch row validates as a hand entry, without a link of its own', () => {
  const row = advertToRow(advert(), 0, { communes: COMMUNES });
  const input = observationInput(row, { source: 'zwandako' });
  assert.equal(validateManualObservation(input, { communes: COMMUNES }).error, 'urlRequired', 'the single form still asks for a link');
  const check = validateManualObservation(input, { communes: COMMUNES, requireUrl: false });
  assert.equal(check.ok, true);
  assert.equal(check.value.monthly_usd, 600);
});

test('the same advert pasted twice is one row; two adverts from one page are two', () => {
  const value = { source: 'facebook', purpose: 'rent', property_kind: 'appartement', beds: 2, price: 600, price_period: 'mois', commune: 'Ngaliema', quartier: 'Mbinza' };
  assert.equal(pasteRefSeed(value, '243812345678'), pasteRefSeed({ ...value, quartier: 'MBINZA' }, '243812345678'));
  assert.notEqual(pasteRefSeed(value, '243812345678'), pasteRefSeed({ ...value, beds: 3 }, '243812345678'));
  assert.deepEqual(mergeSources(['facebook'], 'zwandako'), ['facebook', 'zwandako']);
  assert.deepEqual(mergeSources(['facebook'], 'facebook'), ['facebook']);
});

test('a second paste never overwrites what the team already typed', () => {
  const sql = squash(UPSERT_PROSPECT_SQL);
  assert.match(sql, /ON CONFLICT \(phone\) DO UPDATE/);
  assert.match(sql, /name = COALESCE\(market_prospects\.name, EXCLUDED\.name\)/);
  assert.match(sql, /agency = COALESCE\(market_prospects\.agency, EXCLUDED\.agency\)/);
  assert.doesNotMatch(sql, /status =|notes =/, 'the follow-up is never touched by a paste');
});

test('one save writes prices and prospects in ONE transaction, one prospect per number', async () => {
  const value = validateManualObservation(observationInput(advertToRow(advert(), 0, { communes: COMMUNES }), { source: 'facebook' }), { communes: COMMUNES, requireUrl: false }).value;
  enqueue([]); // BEGIN
  enqueue([{ id: 11 }]); // first observation
  enqueue([{ id: 12 }]); // second observation
  enqueue([{ id: 5, created: true }]); // prospect upsert
  const prospect = { phone: '243812345678', name: 'Jean', agency: null };
  const saved = await saveMarketPasteBatch(
    [{ observation: value, prospect }, { observation: { ...value, beds: 3 }, prospect }],
    { source: 'facebook', recordedBy: 7, pool: getPool() },
  );
  assert.equal(saved.pricesSaved, 2);
  assert.equal(saved.prospectsNew, 1);
  const sqls = calls.map((c) => c.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.equal(sqls.at(-1), 'COMMIT');
  assert.equal(sqls.filter((s) => s.includes('INSERT INTO market_prospects ')).length, 1);
  const upsert = calls.find((c) => c.sql.includes('INSERT INTO market_prospects '));
  assert.equal(upsert.values[5], 2, 'both adverts counted');
  assert.equal(sqls.filter((s) => s.includes('INSERT INTO market_prospect_adverts')).length, 2);
  const obs = calls.find((c) => c.sql.includes('INSERT INTO market_observations'));
  assert.match(obs.values[1], /^paste:[0-9a-f]{32}$/);
  assert.ok(!obs.values.includes('243812345678'), 'market_observations never holds a phone number');
});

test('the list query is parameterised and the default shows prospects still worth a call', () => {
  const { sql, params } = buildProspectListQuery({ q: "0812 '%", limit: 50 });
  assert.match(squash(sql), /mp\.status IN \('todo', 'noanswer', 'callback', 'interested'\)/);
  assert.ok(!sql.includes('0812'));
  assert.ok(params.includes('%0812%'));
  assert.ok(params.some((p) => p === "%0812 '\\%%"));
});

test('a follow-up is validated before it is written', async () => {
  assert.equal((await updateProspect(1, { status: 'maybe' }, 1, { pool: getPool() })).error, 'status');
  assert.equal((await updateProspect(1, { status: 'todo', channel: 'fax' }, 1, { pool: getPool() })).error, 'channel');
  assert.equal(calls.length, 0);
  enqueue([{ id: 1 }]);
  assert.equal((await updateProspect(1, { status: 'interested', channel: 'whatsapp', contacted_on: '2026-11-05', notes: 'Rappeler lundi' }, 1, { pool: getPool() })).ok, true);
});

test('the migration CHECKs match the rules, and RLS shuts the tables', () => {
  const sql = readFileSync(path.join(ENGINE, 'migrations', '20261105_market_prospects.sql'), 'utf8');
  for (const s of PROSPECT_STATUSES) assert.ok(sql.includes(`'${s}'`), s);
  for (const c of PROSPECT_CHANNELS) assert.ok(sql.includes(`'${c}'`), c);
  assert.match(sql, /ALTER TABLE market_prospects ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON market_prospects FROM anon, authenticated/);
});

test('every status and channel has its label in both languages', () => {
  for (const dict of [fr, en]) {
    for (const s of PROSPECT_STATUSES) assert.ok(dict.admin.marketProspects.status[s], s);
    for (const c of PROSPECT_CHANNELS) assert.ok(dict.admin.marketProspects.channel[c], c);
  }
});
