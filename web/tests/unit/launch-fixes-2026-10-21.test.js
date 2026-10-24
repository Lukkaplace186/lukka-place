// Launch fixes (2026-10-21): cities in search, surface decimals, the
// verification reminder, and who may delete visits / prospects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseSearchQuery } from '../../lib/searchParser.js';
import { understoodChips } from '../../lib/searchUnderstood.js';
import { normaliseArea, formatArea } from '../../lib/listingView.js';
import { verificationReminderText } from '../../lib/verificationReminder.js';
import { PERMISSIONS, can } from '../../lib/adminRoles.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const t = (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

test('a city typed (even half-typed) is the city, never the Kinshasa quartier named after it', () => {
  for (const [text, ville] of [['lubum', 'Lubumbashi'], ['Lubumbashi', 'Lubumbashi'], ['goma', 'Goma'], ['mbuji mayi', 'Mbuji-Mayi']]) {
    const parsed = parseSearchQuery(text);
    assert.equal(parsed.ville, ville, text);
    assert.equal(parsed.commune, undefined, `${text} must not become a Kinshasa commune`);
    assert.equal(parsed.keywords, '', `${text} must not stay as a keyword`);
  }
});

test("another city's commune sets both the commune and its city", () => {
  const parsed = parseSearchQuery('appartement kampemba 2 chambres');
  assert.equal(parsed.commune, 'Kampemba');
  assert.equal(parsed.ville, 'Lubumbashi');
  assert.equal(parsed.beds_min, 2);
  assert.deepEqual(understoodChips(parsed, t).find((c) => c.key === 'place').label, 'Kampemba, Lubumbashi');
});

test('Kinshasa searches are unchanged', () => {
  assert.equal(parseSearchQuery('gombe').commune, 'Gombe');
  assert.equal(parseSearchQuery('gombe').ville, undefined);
  const campagne = parseSearchQuery('ma campagne');
  assert.equal(campagne.commune, 'Ngaliema');
  assert.equal(campagne.quartier, 'Ma Campagne');
  assert.equal(parseSearchQuery('2 chambres bandal 800$').commune, 'Bandalungwa');
});

// The hero's Ville select was removed on 2026-10-23 (the "Lieu" box takes a
// city, commune or quartier); the city now comes from the text alone.
// The Ville dropdown came back on 2026-10-24 (owner request); typed text still wins over it.
test('the hero search sends ?ville= from the dropdown and from the text', () => {
  const bar = read('components/SearchBar.js');
  assert.match(bar, /id="hero-city"/);
  assert.match(bar, /if \(ville\) qs\.set\('ville', ville\)/);
  assert.match(bar, /if \(parsed\.ville\) qs\.set\('ville', parsed\.ville\)/);
  assert.match(read('components/LocationAutocomplete.js'), /params\.set\('ville', parsed\.ville\)/);
});

test('a surface keeps up to two decimals and shows them the French way', () => {
  assert.equal(normaliseArea('12.5'), 12.5);
  assert.equal(normaliseArea('250,756'), 250.76);
  assert.equal(normaliseArea(''), null);
  assert.ok(Number.isNaN(normaliseArea('abc')));
  assert.ok(Number.isNaN(normaliseArea('0')));
  assert.equal(formatArea('12.5'), '12,5');
  assert.equal(formatArea('300'), '300');
  assert.equal(formatArea('0'), '');
});

test('every surface field accepts decimals', () => {
  for (const file of ['components/CreateListingDialog.js', 'components/AgentListingEditor.js', 'app/admin/listings/[id]/AdminListingEditor.js', 'app/admin/listings/nouveau/AdminCreateListingForm.js']) {
    assert.match(read(file), /name="area"[\s\S]{0,120}step="0\.01"/, file);
  }
  assert.doesNotMatch(read('app/compte/agent/actions.js'), /area = areaRaw \? Number\.parseInt/);
});

test('the verification reminder names the agent only when there is a real first name', () => {
  assert.match(verificationReminderText('Jean'), /^Bonjour Jean ! 🚀 Votre compte Lukka Place est presque vérifié\./);
  assert.match(verificationReminderText('243810000000'), /^Bonjour ! /);
  assert.match(verificationReminderText(null), /Assistance : \+243 846 962 654$/);
});

test('deleting visits and prospects is owner-only; reminders and agency renames need agents.manage', () => {
  assert.ok(PERMISSIONS['leads.delete'] && PERMISSIONS['viewings.delete']);
  assert.equal(can('owner', 'leads.delete'), true);
  assert.equal(can('support', 'leads.delete'), false);
  assert.equal(can('moderator', 'viewings.delete'), false);
  assert.match(read('app/admin/recordDeleteActions.js'), /requireAdmin\('leads\.delete'\)[\s\S]*requireAdmin\('viewings\.delete'\)/);
  assert.match(read('app/admin/agents/verificationReminderActions.js'), /requireAdmin\('agents\.manage'\)/);
  assert.match(read('app/admin/agencies/[id]/renameActions.js'), /requireAdmin\('agents\.manage'\)/);
  assert.match(read('app/admin/listings/createActions.js'), /adminAssignListingAgentAction[\s\S]*?requireAdmin\('listings\.edit'\)/);
});

// --- City shown where the search runs (2026-10-21, owner screenshots) --------

test('a card line names the listing’s own city, never Kinshasa after Lubumbashi', async () => {
  const { feedLocationLine } = await import('../../lib/listingView.js');
  assert.equal(feedLocationLine({ quartier: 'Golf Malela', commune: 'Lubumbashi' }), 'Golf Malela, Lubumbashi');
  assert.equal(feedLocationLine({ quartier: 'Bel-Air I', commune: 'Kampemba' }), 'Bel-Air I, Kampemba, Lubumbashi');
  assert.equal(feedLocationLine({ quartier: 'Industriel', commune: 'Limete' }), 'Industriel, Limete, Kinshasa');
  assert.equal(feedLocationLine({ quartier: 'Gare', commune: 'Kinshasa' }), 'Gare, Kinshasa');
  // A city with no communes known (Muanda): the row's own city closes it.
  assert.equal(feedLocationLine({ quartier: 'Plage', commune: null, city_name: 'Muanda' }), 'Plage, Muanda');
});

test('the results page passes the commune’s city to the picker, heading and suggestions', () => {
  const page = fs.readFileSync(new URL('../../app/(site)/listings/page.js', import.meta.url), 'utf8');
  assert.match(page, /const searchCity = searchCityOf\(filters\)/);
  assert.match(page, /searchCity,\r?\n/);
  assert.match(page, /city=\{searchCity\}/);
  assert.match(page, /searchCity !== DEFAULT_CITY \? \[\] : nearbyCommunes/);
  const bar = fs.readFileSync(new URL('../../components/FilterBar.js', import.meta.url), 'utf8');
  assert.match(bar, /current=\{defaults\.searchCity \|\| defaults\.ville\}/);
  const header = fs.readFileSync(new URL('../../components/ResultsHeader.js', import.meta.url), 'utf8');
  assert.doesNotMatch(header, /'Kinshasa'/);
});

test('the hero location box mirrors the place typed or tapped', () => {
  const src = fs.readFileSync(new URL('../../components/SearchBar.js', import.meta.url), 'utf8');
  assert.match(src, /onValueChange=\{onLocationChange\}/);
  // The dropdown follows the place typed or tapped; a new city clears a place of another city.
  assert.match(src, /function onLocationChange\(text\)/);
  assert.match(src, /function onCityChange\(next\)/);
});

test('searchCityOf reads a commune-only link as that commune’s city', async () => {
  const { searchCityOf } = await import('../../lib/cities.js');
  assert.equal(searchCityOf({ commune: 'Lubumbashi' }), 'Lubumbashi');
  assert.equal(searchCityOf({ commune: 'Kalamu (Boma)' }), 'Boma');
  assert.equal(searchCityOf({ commune: 'Gombe' }), 'Kinshasa');
  assert.equal(searchCityOf({}), 'Kinshasa');
});

test('the admin editor saves a blank surface as "not stated" (\'0\'), never NULL — the column is NOT NULL', () => {
  const actions = read('app/admin/listings/[id]/actions.js');
  assert.match(actions, /area: areaValue === undefined \? undefined : areaValue == null \? '0' : String\(areaValue\)/);
  assert.match(actions, /if \(Number\.isNaN\(areaValue\)\) return \{ ok: false, error: t\('errors\.invalidArea'\) \}/);
});
