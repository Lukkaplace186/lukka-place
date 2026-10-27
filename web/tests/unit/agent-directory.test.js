import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import {
  DIRECTORY_PAGE_SIZE,
  directoryAgentName,
  directoryHref,
  foldSearchText,
  hasDirectoryFilters,
  nameQuery,
  nearestCommunes,
  parseDirectoryParams,
  resolvePlaceQuery,
  toggleCommuneHref,
} from '@/lib/agentDirectoryRules';
import { buildCommuneCountsQuery, buildDirectoryQuery, getAgentDirectory } from '@/lib/agentDirectory';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../..');

beforeEach(() => reset());

test('params: defaults, unknown values dropped, communes decide their city', () => {
  assert.deepEqual(parseDirectoryParams({}), {
    q: '', nom: false, place: null, ville: null, communes: [], pres: false, offre: null, verifies: false, tri: 'listings', page: 1,
  });
  const p = parseDirectoryParams({ ville: 'nowhere', communes: 'Atlantis', offre: 'x', tri: 'x', page: '-3' });
  assert.equal(p.ville, null);
  assert.deepEqual(p.communes, []);
  assert.equal(p.offre, null);
  assert.equal(p.tri, 'listings');
  assert.equal(p.page, 1);

  // The older single ?commune= still works and names its city.
  const k = parseDirectoryParams({ commune: 'Kampemba' });
  assert.deepEqual(k.communes, ['Kampemba']);
  assert.equal(k.ville, 'Lubumbashi');

  // Several communes; capped at five; another city's commune is dropped.
  const many = parseDirectoryParams({ communes: 'Gombe,Ngaliema,Lingwala,Limete,Lemba,Kintambo' });
  assert.deepEqual(many.communes, ['Gombe', 'Ngaliema', 'Lingwala', 'Limete', 'Lemba']);
  assert.equal(many.ville, 'Kinshasa');
  assert.deepEqual(parseDirectoryParams({ ville: 'Kinshasa', communes: 'Gombe,Kampemba' }).communes, ['Gombe']);
  // Communes of two cities: no single city.
  assert.equal(parseDirectoryParams({ communes: 'Gombe,Kampemba' }).ville, null);

  assert.equal(parseDirectoryParams({ q: 'x'.repeat(200) }).q.length, 60);
  // pres only means something with communes.
  assert.equal(parseDirectoryParams({ pres: '1' }).pres, false);
  assert.equal(parseDirectoryParams({ pres: '1', communes: 'Lemba' }).pres, true);
});

test('a quartier, landmark, commune or city typed in the box is read as a place', () => {
  const righini = parseDirectoryParams({ q: 'Righini' });
  assert.deepEqual(righini.communes, ['Lemba']);
  assert.equal(righini.ville, 'Kinshasa');
  assert.equal(righini.place.label.toLowerCase(), 'righini');
  assert.equal(nameQuery(righini), '', 'a place is not also a name filter');

  assert.deepEqual(parseDirectoryParams({ q: 'à Gombe' }).communes, ['Gombe']);
  assert.deepEqual(parseDirectoryParams({ q: 'près de l’UPN' }).communes, ['Ngaliema']);
  const salongo = resolvePlaceQuery('Salongo');
  assert.ok(salongo.communes.length > 1, 'a quartier several communes share gives all of them');

  assert.deepEqual(parseDirectoryParams({ q: 'Kampemba' }).communes, ['Kampemba']);
  const goma = parseDirectoryParams({ q: 'Goma' });
  assert.equal(goma.ville, 'Goma');
  assert.deepEqual(goma.communes, []);

  // Anything else left over keeps it a name search.
  const agency = parseDirectoryParams({ q: 'Agence Prince Immo' });
  assert.equal(agency.place, null);
  assert.equal(nameQuery(agency), 'Agence Prince Immo');
  // nom=1 forces a name search.
  const forced = parseDirectoryParams({ q: 'Righini', nom: '1' });
  assert.equal(forced.place, null);
  assert.deepEqual(forced.communes, []);
  assert.equal(nameQuery(forced), 'Righini');
  // The place overrides the menus.
  assert.deepEqual(parseDirectoryParams({ q: 'Righini', ville: 'Goma', communes: 'Gombe' }).communes, ['Lemba']);
});

test('href: defaults left out, a filter change resets the page, a city change drops other cities’ communes', () => {
  const p = parseDirectoryParams({ ville: 'Kinshasa', communes: 'Gombe', page: '3', tri: 'rating' });
  assert.equal(directoryHref(p, { page: 4 }), '/agents?ville=Kinshasa&communes=Gombe&tri=rating&page=4');
  assert.equal(directoryHref(p, { offre: 'vente' }), '/agents?ville=Kinshasa&communes=Gombe&offre=vente&tri=rating');
  assert.equal(directoryHref(p, { ville: 'Goma' }), '/agents?ville=Goma&tri=rating');
  assert.equal(directoryHref(parseDirectoryParams({}), {}), '/agents');
  assert.equal(hasDirectoryFilters(parseDirectoryParams({})), false);
  assert.equal(hasDirectoryFilters(parseDirectoryParams({ verifies: '1' })), true);
  // "Chercher parmi les noms" from a place search.
  const place = parseDirectoryParams({ q: 'Righini' });
  assert.equal(directoryHref(place, { nom: true, communes: [], ville: null }), '/agents?q=Righini&nom=1');
});

test('chips: add, remove, cap at five; a chip turns a typed place into chosen communes', () => {
  const p = parseDirectoryParams({ communes: 'Gombe' });
  assert.equal(toggleCommuneHref(p, 'Ngaliema'), '/agents?ville=Kinshasa&communes=Gombe%2CNgaliema');
  assert.equal(toggleCommuneHref(p, 'Gombe'), '/agents?ville=Kinshasa');
  const full = parseDirectoryParams({ communes: 'Gombe,Ngaliema,Lingwala,Limete,Lemba' });
  assert.equal(toggleCommuneHref(full, 'Kintambo'), null);
  assert.match(toggleCommuneHref(full, 'Lemba'), /communes=Gombe%2CNgaliema%2CLingwala%2CLimete$/);
  const place = parseDirectoryParams({ q: 'Righini' });
  assert.equal(toggleCommuneHref(place, 'Limete'), '/agents?ville=Kinshasa&communes=Lemba%2CLimete');
  // Chips from an empty search name their own city.
  assert.equal(toggleCommuneHref(parseDirectoryParams({}), 'Kampemba'), '/agents?ville=Lubumbashi&communes=Kampemba');
});

test('Autour de moi: nearest communes, neighbours within reach, nothing outside covered cities', () => {
  const centres = [
    { key: 'Gombe', lat: -4.3, lng: 15.3 },
    { key: 'Lingwala', lat: -4.31, lng: 15.3 },
    { key: 'Maluku', lat: -4.1, lng: 15.6 },
    { key: 'Ngaliema', lat: -4.35, lng: 15.25 },
  ];
  assert.deepEqual(nearestCommunes({ lat: -4.302, lng: 15.3 }, centres), ['Gombe', 'Lingwala']);
  assert.equal(nearestCommunes({ lat: 48.85, lng: 2.35 }, centres), null);
  assert.equal(nearestCommunes(null, centres), null);
  // The browser module carries no data and no imports.
  assert.doesNotMatch(readFileSync(path.join(web, 'lib/nearestCommunes.js'), 'utf8'), /^import /m);
  const button = readFileSync(path.join(web, 'app/(portfolio)/agents/NearMeButton.js'), 'utf8');
  assert.doesNotMatch(button, /latitude[^)]*query|query\.set\('(lat|lng)/, 'coordinates never go into the URL');
  assert.doesNotMatch(button, /agentDirectoryRules|gazetteer/, 'the gazetteer stays on the server');
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

test('SQL: several communes are one OR; a place search is not a name search', () => {
  const { sql, values } = buildDirectoryQuery(parseDirectoryParams({ communes: 'Gombe,Ngaliema' }));
  assert.deepEqual(values[0], ['Gombe', 'Ngaliema']);
  assert.match(normalizeSql(sql), /COALESCE\(a\.primary_communes, '\{\}'\) && \$1::text\[\]/);
  const place = buildDirectoryQuery(parseDirectoryParams({ q: 'Righini' }));
  assert.deepEqual(place.values[0], ['Lemba']);
  assert.doesNotMatch(normalizeSql(place.sql), /translate\(lower\(concat_ws/);
});

test('SQL: chip counts apply the other filters but not the chosen communes, and only public listings', () => {
  const params = parseDirectoryParams({ communes: 'Gombe', offre: 'location', q: 'Immo Plus' });
  const { sql, values } = buildCommuneCountsQuery(params);
  const text = normalizeSql(sql);
  assert.match(text, /live\.rent_count > 0/);
  assert.match(text, /translate\(lower\(concat_ws/);
  assert.doesNotMatch(text, /&& \$\d+::text\[\]/, 'the chosen communes do not narrow their own counts');
  assert.match(text, /lp\.status = 1 AND lp\.approve_status = 1/);
  assert.match(text, /a\.status = 1 AND a\.deleted_at IS NULL/);
  // Scoped to the city's communes.
  assert.ok(values[values.length - 1].includes('Gombe'));
  assert.ok(!values[values.length - 1].includes('Kampemba'));
});

test('getAgentDirectory returns the page and the window total', async () => {
  enqueue([{ id: 1, total_count: 31 }, { id: 2, total_count: 31 }]);
  const result = await getAgentDirectory(parseDirectoryParams({}));
  assert.equal(result.total, 31);
  assert.equal(result.agents.length, 2);
  assert.equal(calls.length, 1);
});

test('menu carries Agences, directly under À propos, in the bar and the drawer', () => {
  const header = readFileSync(path.join(web, 'components/Header.js'), 'utf8');
  const primary = header.slice(header.indexOf('const PRIMARY_LINKS = ['), header.indexOf('];', header.indexOf('const PRIMARY_LINKS = [')));
  const hrefs = [...primary.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(hrefs.slice(-2), ['/a-propos', '/agents'], 'Agences is the link right after À propos');
  assert.equal(hrefs.filter((h) => h === '/agents').length, 1, 'one directory link, not Agents and Agences');
  assert.match(primary, /\{ href: '\/agents', labelKey: 'nav\.agencies' \}/);
  assert.match(header, /const DRAWER_PRIMARY_LINKS = PRIMARY_LINKS;/, 'the drawer uses the same order');
  // The drawer's second band opens with Favoris, so Agences sits just above it.
  for (const list of ['DRAWER_GUEST_LINKS', 'DRAWER_ACCOUNT_LINKS']) {
    const body = header.slice(header.indexOf(`const ${list} = [`));
    assert.match(body, /^const \w+ = \[\s*\{ href: '\/favoris'/, list);
  }
  assert.ok(existsSync(path.join(web, 'app/(portfolio)/agents/page.js')), '/agents is a real route');
  const fr = JSON.parse(readFileSync(path.join(web, 'lib/i18n/fr.json'), 'utf8'));
  const en = JSON.parse(readFileSync(path.join(web, 'lib/i18n/en.json'), 'utf8'));
  assert.equal(fr.nav.agencies, 'Agences');
  assert.equal(en.nav.agencies, 'Agencies');
});
