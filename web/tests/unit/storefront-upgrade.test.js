import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { understoodChips } from '@/lib/searchUnderstood';
import { parseSearchQuery } from '@/lib/searchParser';
import { mapFilterHref } from '@/lib/mapQuickFilters';

/**
 * The storefront upgrade (2026-10-06, prototype in
 * web/Design/storefront-prototype.html): landing search card, the card's
 * entry chip, map quick filters, the listing page's phone layout.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const { default: fr } = await import('@/lib/i18n/fr.json', { with: { type: 'json' } });
const lookup = (key, vars = {}) => {
  let value = key.split('.').reduce((node, part) => node?.[part], fr);
  if (value && typeof value === 'object') value = vars.count === 1 ? value.one : value.other;
  return String(value ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
};
const t = Object.assign(lookup, { locale: 'fr' });

test('listing cards carry no entry-terms or "À louer" chip (rolled back 2026-10-06)', () => {
  const card = read('components/PropertyCard.js');
  assert.doesNotMatch(card, /entryTermsChip|entryItemizedChip|cardFactChips|listings\.transaction\.rent/);
  assert.match(card, /matchedAmenities\(listing, 3\)/);
  assert.doesNotMatch(read('components/MapCardCarousel.js'), /entryChipLabel/);
});

test('the search card reads back what it understood, and nothing it did not', () => {
  const chips = understoodChips(parseSearchQuery('2 chambres à Gombe 800$'), t).map((c) => c.label);
  assert.deepEqual(chips, ['Gombe', '2 ch.+', '≤ 800 $']);
  assert.deepEqual(understoodChips(parseSearchQuery('près de UPN'), t).map((c) => c.label), ['Près de UPN']);
  assert.deepEqual(understoodChips(parseSearchQuery('quelque chose'), t), []);
  assert.deepEqual(understoodChips(null, t), []);
});

test('no "try these" example chips on the hero (not enough listings yet)', () => {
  const bar = read('components/SearchBar.js');
  assert.doesNotMatch(bar, /home\.search\.(try|example)/);
  assert.match(bar, /home\.search\.seeCount/);
});

test('map quick filters keep every other param, including the map area', () => {
  const search = '?view=map&commune=Gombe&sw_lat=-4.4&sw_lng=15.2&ne_lat=-4.3&ne_lng=15.3&page=2';
  const href = mapFilterHref(search, 'price_max', 1500);
  const params = new URLSearchParams(href.split('?')[1]);
  assert.equal(params.get('price_max'), '1500');
  assert.equal(params.get('view'), 'map');
  assert.equal(params.get('sw_lat'), '-4.4');
  assert.equal(params.get('page'), null, 'a new filter starts at page 1');
  assert.equal(new URLSearchParams(mapFilterHref('?beds_min=2&view=map', 'beds_min', '').split('?')[1]).get('beds_min'), null);
  assert.equal(new URLSearchParams(mapFilterHref('?property_type=parcelle&parcelle_subtype=villa', 'property_type', 'maison').split('?')[1]).get('parcelle_subtype'), null);
});

test('key facts are the two-column grid again on phones (rolled back 2026-10-06)', () => {
  const facts = read('components/KeyFacts.js');
  assert.doesNotMatch(facts, /phoneFactLayout|md:hidden/);
  assert.match(facts, /grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4/);
});

test('the phone section strip only names sections that render', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  assert.match(page, /entryCostBreakdown\(listing\) \? \{ id: 'couts'/);
  assert.match(page, /id="apercu"/);
  assert.match(page, /id="caracteristiques"/);
  assert.match(page, /id="emplacement"/);
  assert.match(read('components/EntryCostsBreakdown.js'), /id="couts"/);
});
