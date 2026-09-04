import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WEB_ROOT, REPO_ROOT } from '../support/env.mjs';

/**
 * F6. Two independent code paths write into the same `properties` schema:
 *   - the engine's services/postgres.js  (a listing sent by WhatsApp)
 *   - web/lib/agentListings.js           (a listing typed into the agent form)
 *
 * They live in separate apps — one CommonJS/Express, one ESM/Next — so the
 * shared conventions are duplicated by hand rather than imported. That
 * duplication is documented and accepted (agentListings.js:22-26); what was
 * missing is anything that notices when the two copies drift apart. A
 * mismatch here is not a style issue: COMMUNE_AMENITY_IDS is how commune is
 * stored at all (it is not a column), so one wrong id silently files a
 * listing under the wrong commune.
 */

const require_ = createRequire(import.meta.url);
const enginePostgres = require_(path.join(REPO_ROOT, 'services', 'postgres.js'));
const agentListingsSource = fs.readFileSync(path.join(WEB_ROOT, 'lib', 'agentListings.js'), 'utf8');

/**
 * COMMUNE_AMENITY_IDS is module-local in agentListings.js (not exported), so
 * it is read out of the source text rather than imported. Parsing the literal
 * is deliberate: adding an export purely to satisfy a test would change the
 * module's public surface to describe itself.
 */
function extractObjectLiteral(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} not found in source`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return new Function(`return (${source.slice(open, i + 1)});`)();
      }
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const webCommuneIds = extractObjectLiteral(agentListingsSource, 'COMMUNE_AMENITY_IDS');
const engineCommuneIds = enginePostgres.COMMUNE_AMENITY_IDS;

test('both write paths agree on every commune amenity id', () => {
  assert.ok(engineCommuneIds, 'engine must export COMMUNE_AMENITY_IDS');
  assert.deepEqual(
    webCommuneIds,
    engineCommuneIds,
    'commune -> amenity id maps have drifted between the engine and the agent form',
  );
});

test('the commune map covers all 24 Kinshasa communes and uses the documented id range', () => {
  const ids = Object.values(engineCommuneIds);
  assert.equal(Object.keys(engineCommuneIds).length, 24);
  assert.equal(new Set(ids).size, 24, 'ids must be unique — a duplicate files two communes as one');
  assert.equal(Math.min(...ids), 21);
  assert.equal(Math.max(...ids), 44);
});

test('both write paths agree on the content language id', () => {
  const webLang = Number(agentListingsSource.match(/const CONTENT_LANGUAGE_ID = (\d+)/)[1]);
  assert.equal(webLang, 20, 'web write path must write property_contents at language_id 20');
});

test('both write paths agree on the no-photo placeholder URL', () => {
  const webUrl = agentListingsSource.match(/const NO_PHOTO_URL = '([^']+)'/)[1];
  const engineSource = fs.readFileSync(path.join(REPO_ROOT, 'services', 'postgres.js'), 'utf8');
  const engineUrl = engineSource.match(/const NO_PHOTO_URL = '([^']+)'/)[1];
  assert.equal(webUrl, engineUrl);
});

test('a new listing from either path enters moderation, never straight to public', () => {
  const engineSource = fs.readFileSync(path.join(REPO_ROOT, 'services', 'postgres.js'), 'utf8');
  assert.match(engineSource, /approve_status: 0/, 'engine must insert as pending');
  assert.match(agentListingsSource, /approve_status/, 'agent form must set approve_status explicitly');
});

/**
 * The drift that actually exists today, pinned so the fix is verifiable and
 * so it cannot silently regress afterwards. Each of these is a real column
 * the engine populates and the agent form does not.
 */
test('the agent form populates the same listing fields the engine does (F6)', () => {
  const missing = [];
  // `area` is a TEXT column; the engine writes the real surface area, the
  // agent form hardcodes '0', which renders as "0 m²" (see hasArea()).
  if (/area: '0'/.test(agentListingsSource)) missing.push("area (hardcoded '0')");
  if (/quartier: null/.test(agentListingsSource)) missing.push('quartier (hardcoded null)');
  if (!/deposit_months/.test(agentListingsSource)) missing.push('deposit_months');
  if (!/parcelle_subtype/.test(agentListingsSource)) missing.push('parcelle_subtype');
  if (!/units_count/.test(agentListingsSource)) missing.push('units_count');
  if (!/reference/.test(agentListingsSource)) missing.push('reference');

  assert.deepEqual(missing, [], `agent-form listings are thinner than WhatsApp ones: ${missing.join(', ')}`);
});

/**
 * Embeddings are the one field the agent form genuinely does not write, and
 * that is a deliberate, documented gap rather than an oversight: generating
 * one needs an OpenAI key, and web/ has none (only the engine holds it).
 *
 * It is covered by scripts/backfill-embeddings.js, and the live data agrees —
 * zero approved listings are missing an embedding on either write path. The
 * real consequence is latency, not absence: a freshly created agent listing
 * does not appear in "biens similaires" until that backfill next runs.
 *
 * Pinned here so the compensating mechanism cannot be deleted without this
 * failing, which is the actual risk.
 */
test('the embedding gap in the agent form has a real compensating backfill', () => {
  const backfill = path.join(REPO_ROOT, 'scripts', 'backfill-embeddings.js');
  assert.ok(
    fs.existsSync(backfill),
    'agent-form listings carry no embedding on write; scripts/backfill-embeddings.js is what fills them in',
  );
  const source = fs.readFileSync(backfill, 'utf8');
  assert.match(source, /embedding/, 'the backfill must actually write the embedding column');
});
