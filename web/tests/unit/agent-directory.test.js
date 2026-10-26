import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import {
  DIRECTORY_PAGE_SIZE,
  directoryAgentName,
  directoryHref,
  foldSearchText,
  hasDirectoryFilters,
  parseDirectoryParams,
} from '@/lib/agentDirectoryRules';
import { buildDirectoryQuery, getAgentDirectory } from '@/lib/agentDirectory';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../..');

beforeEach(() => reset());

test('params: defaults, unknown values dropped, commune decides its city', () => {
  assert.deepEqual(parseDirectoryParams({}), {
    q: '', ville: null, commune: null, offre: null, verifies: false, tri: 'listings', page: 1,
  });
  const p = parseDirectoryParams({ ville: 'nowhere', commune: 'Atlantis', offre: 'x', tri: 'x', page: '-3' });
  assert.equal(p.ville, null);
  assert.equal(p.commune, null);
  assert.equal(p.offre, null);
  assert.equal(p.tri, 'listings');
  assert.equal(p.page, 1);

  const k = parseDirectoryParams({ commune: 'Kampemba' });
  assert.equal(k.commune, 'Kampemba');
  assert.equal(k.ville, 'Lubumbashi');

  // A commune of another city than the one asked for is dropped.
  const mismatch = parseDirectoryParams({ ville: 'Kinshasa', commune: 'Kampemba' });
  assert.equal(mismatch.ville, 'Kinshasa');
  assert.equal(mismatch.commune, null);

  assert.equal(parseDirectoryParams({ q: 'x'.repeat(200) }).q.length, 60);
});

test('href: defaults left out, a filter change resets the page, a city change drops the commune', () => {
  const p = parseDirectoryParams({ ville: 'Kinshasa', commune: 'Gombe', page: '3', tri: 'rating' });
  assert.equal(directoryHref(p, { page: 4 }), '/agents?ville=Kinshasa&commune=Gombe&tri=rating&page=4');
  assert.equal(directoryHref(p, { offre: 'vente' }), '/agents?ville=Kinshasa&commune=Gombe&offre=vente&tri=rating');
  assert.equal(directoryHref(p, { ville: 'Goma' }), '/agents?ville=Goma&tri=rating');
  assert.equal(directoryHref(parseDirectoryParams({}), {}), '/agents');
  assert.equal(hasDirectoryFilters(parseDirectoryParams({})), false);
  assert.equal(hasDirectoryFilters(parseDirectoryParams({ verifies: '1' })), true);
});

test('names: person first, never a phone number or a console placeholder', () => {
  assert.deepEqual(directoryAgentName({ first_name: 'Marie', last_name: 'Nsumbu', agency_name: 'Immo Plus' }), {
    name: 'Marie Nsumbu', agency: 'Immo Plus',
  });
  assert.deepEqual(directoryAgentName({ agency_name: '243812345678', vendor_name: 'Agence #12' }), { name: null, agency: null });
  assert.deepEqual(directoryAgentName({ vendor_name: 'Kin Immo' }), { name: 'Kin Immo', agency: null });
  assert.equal(foldSearchText('Élodie MUKÉNDI'), 'elodie mukendi');
});

test('SQL: public gate, live agents only, phone only under the routing rule, one page', () => {
  const { sql, values } = buildDirectoryQuery(parseDirectoryParams({ page: '2' }));
  const text = normalizeSql(sql);
  assert.match(text, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(text, /JOIN live ON live\.agent_id = a\.id/);
  assert.match(text, /a\.status = 1 AND a\.deleted_at IS NULL/);
  assert.match(text, /CASE WHEN a\.phone_verified_at IS NOT NULL AND a\.direct_routing_enabled IS NOT FALSE THEN a\.phone END AS contact_phone/);
  assert.doesNotMatch(text, /a\.username/);
  assert.deepEqual(values.slice(-2), [DIRECTORY_PAGE_SIZE, DIRECTORY_PAGE_SIZE]);
});

test('SQL: search is escaped and accent-folded; a city filters by its communes', () => {
  const { sql, values } = buildDirectoryQuery(parseDirectoryParams({ q: 'Mukéndi 100%', ville: 'Goma' }));
  assert.equal(values[0], '%mukendi 100\\%%');
  assert.ok(Array.isArray(values[1]) && values[1].length > 0);
  const text = normalizeSql(sql);
  assert.match(text, /translate\(lower\(/);
  assert.match(text, /COALESCE\(a\.primary_communes, '\{\}'\) && \$2::text\[\]/);
  assert.match(text, /lp\.status = 1 AND lp\.approve_status = 1/);
});

test('SQL: rating sort needs the public minimum; it falls back without the reviews table', () => {
  const rated = normalizeSql(buildDirectoryQuery(parseDirectoryParams({ tri: 'rating' })).sql);
  assert.match(rated, /COALESCE\(r\.review_count, 0\) >= 5/);
  const fallback = normalizeSql(buildDirectoryQuery(parseDirectoryParams({ tri: 'rating' }), { withRatings: false }).sql);
  assert.doesNotMatch(fallback, /agent_reviews/);
  assert.doesNotMatch(fallback, /r\.average_stars DESC/);
});

test('getAgentDirectory returns the page and the window total', async () => {
  enqueue([{ id: 1, total_count: 31 }, { id: 2, total_count: 31 }]);
  const result = await getAgentDirectory(parseDirectoryParams({}));
  assert.equal(result.total, 31);
  assert.equal(result.agents.length, 2);
  assert.equal(calls.length, 1);
});

test('menu carries Agents in the bar and the drawer', () => {
  const header = readFileSync(path.join(web, 'components/Header.js'), 'utf8');
  assert.match(header, /\{ href: '\/agents', labelKey: 'nav\.agents' \}/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(path.join(web, `lib/i18n/${lang}.json`), 'utf8'));
    assert.equal(dict.nav.agents, 'Agents');
  }
});
