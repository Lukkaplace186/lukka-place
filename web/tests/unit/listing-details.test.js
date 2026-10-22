import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as listings from '@/lib/listings';
import * as details from '@/lib/listingDetails';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { parseSearchQuery } from '@/lib/searchParser';
import { PROPERTY_TYPE_PLURAL_KEYS } from '@/lib/constants';
import { SEO_PROPERTY_TYPES, parseSeoSegments } from '@/lib/seoPages';
import { matchCategoryId } from '@/lib/smartPaste';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

/**
 * Practical listing details and the 2026-10-22 types (lib/listingDetails.js;
 * engine services/listingDetails.js).
 */

const require = createRequire(import.meta.url);
const engine = require('../../../services/listingDetails.js');

test.beforeEach(() => reset());

test('plot sizes are read the way agents write them, identically on both sides', () => {
  assert.deepEqual(details.PLOT_AREA_FIXTURES, engine.PLOT_AREA_FIXTURES.map((row) => [...row]));
  for (const [text, m2] of details.PLOT_AREA_FIXTURES) {
    assert.equal(details.parsePlotArea(text), m2, text);
    assert.equal(engine.parsePlotArea(text), m2, `engine: ${text}`);
  }
});

test('details are gated on what the property can have', () => {
  const all = {
    furnished: '1', households_count: '3', landlord_on_site: '0', has_generator: '1',
    has_pool: true, has_gym: false, electricity_meter: 'prepaye', plot_dimensions: '15/20',
    installments_available: true, installment_terms: '30 % puis 12 mois',
  };
  const flat = details.normaliseListingDetails(all, { categoryName: 'Appartement', categoryType: 'residential', purpose: 'rent' });
  assert.equal(flat.plot_dimensions, null, 'a flat has no plot');
  assert.equal(flat.installments_available, null, 'a rent is not paid in instalments');
  assert.equal(flat.households_count, 3);
  assert.equal(flat.has_generator, true);
  assert.equal(flat.has_pool, true);
  assert.equal(flat.has_gym, null, 'a "no" is never stored');
  const land = details.normaliseListingDetails(all, { categoryName: 'Terrain', categoryType: 'residential', purpose: 'sale' });
  assert.equal(land.households_count, null);
  assert.equal(land.has_pool, null, 'bare land has no pool');
  assert.equal(land.electricity_meter, null);
  assert.equal(land.furnished, null);
  assert.equal(land.plot_area_m2, 300);
  assert.equal(land.installment_terms, '30 % puis 12 mois');
  const office = details.normaliseListingDetails(all, { categoryName: 'Bureau', categoryType: 'commercial', purpose: 'rent' });
  assert.equal(office.landlord_on_site, null, 'nobody shares an office as a household');
  assert.equal(office.has_generator, true, 'an office can have a generator');
  assert.equal(details.normaliseListingDetails({ households_count: 900 }).households_count, null);
  // The engine applies the same rules to its own type codes.
  const engineFarm = engine.normaliseListingDetails(all, { propertyType: 'ferme', transactionType: 'vente' });
  assert.equal(engineFarm.households_count, null);
  assert.equal(engineFarm.plot_area_m2, 300);
});

test('a sale plot gets a price per m², a rent never does', () => {
  const plot = { purpose: 'sale', price: 30000, category_name: 'Terrain', area: '600', listing_details: {} };
  assert.equal(details.pricePerM2(plot), 50, 'a Terrain falls back to its own area');
  assert.equal(details.pricePerM2({ ...plot, listing_details: { plot_area_m2: 300 } }), 100, 'the stated plot wins');
  assert.equal(details.pricePerM2({ ...plot, purpose: 'rent' }), null);
  assert.equal(details.pricePerM2({ ...plot, category_name: 'Appartement' }), null, 'a flat\'s area is not land');
  assert.equal(details.plotAreaLabel(300), '300 m² · 3 ares');
  assert.equal(details.plotAreaLabel(20000), '20 000 m² · 2 ha');
});

test('listing reads carry the details through to_jsonb; the plot filter and Meublé are SQL', async () => {
  await listings.getListings(parseListingsSearchParams(new URLSearchParams('plot_min=500&plot_max=2000&amenities=furnished')));
  const sql = calls.map((c) => normalizeSql(c.text)).join('\n');
  assert.ok(sql.includes('AS listing_details'));
  assert.ok(sql.includes("to_jsonb(p) ->> 'plot_area_m2'"), 'plot size read through to_jsonb');
  assert.ok(sql.includes("to_jsonb(p) ->> 'furnished' = 'true'"), 'Meublé reads the column');
  assert.ok(sql.includes('p.status = 1 AND p.approve_status = 1'));
  const params = calls.flatMap((c) => c.values || []);
  assert.ok(params.includes(500) && params.includes(2000));
  reset();
  await listings.getListings(parseListingsSearchParams(new URLSearchParams('amenities=pool,generator,gym,solar')));
  const equipmentSql = calls.map((c) => normalizeSql(c.text)).join('\n');
  for (const column of ['has_pool', 'has_generator', 'has_gym', 'has_solar']) {
    assert.ok(equipmentSql.includes(`to_jsonb(p) ->> '${column}' = 'true'`), column);
  }
  reset();
  await listings.getListings({ plotMin: 'abc' });
  assert.ok(!calls.map((c) => normalizeSql(c.text)).join('\n').includes("->> 'plot_area_m2', '')::numeric"), 'a junk size filters nothing');
});

test('the new types filter by category, and old studios still match by title', async () => {
  await listings.getListings({ propertyType: 'studio' });
  const sql = calls.map((c) => normalizeSql(c.text)).join('\n');
  assert.ok(sql.includes('pc.title ~*'), 'older studios match by title');
  assert.ok(calls.flatMap((c) => c.values || []).some((v) => Array.isArray(v) && v.length === 1 && v[0] === 'appartement'), '…only under Appartement');
  for (const [value, name] of [['chambre', 'chambre / annexe'], ['ferme', 'ferme / terrain agricole']]) {
    reset();
    await listings.getListings({ propertyType: value });
    assert.ok(calls.flatMap((c) => c.values || []).some((p) => Array.isArray(p) && p.includes(name)), value);
  }
});

test('the search box reads plot sizes, Meublé and the new types', () => {
  assert.equal(parseSearchQuery('terrain 5 ares à Maluku').plot_min, 500);
  assert.equal(parseSearchQuery('parcelle 20x30 ngaliema 50000$').plot_min, 600);
  assert.equal(parseSearchQuery('parcelle 20x30 ngaliema 50000$').price_max, 50000, 'the size is not a price');
  assert.equal(parseSearchQuery('terrain 600 m2 vente').price_max, undefined, '"600 m2" is never $600');
  assert.deepEqual(parseSearchQuery('appartement meublé gombe').amenities, ['furnished']);
  assert.equal(parseSearchQuery('appartement non meublé').amenities, undefined);
  assert.equal(parseSearchQuery('appartement dans un immeuble').amenities, undefined, '"immeuble" is not "meublé"');
  assert.equal(parseSearchQuery('salle de fête limete').property_type, undefined, 'Salle de fête was removed');
  assert.equal(parseSearchQuery('terrain agricole mont-ngafula').property_type, 'ferme');
  assert.equal(parseSearchQuery('annexe à louer ngaba').property_type, 'chambre');
  assert.equal(parseSearchQuery('2 chambres kintambo').property_type, undefined, 'bedrooms are not a room to let');
});

test('every new type has a plural, a landing page and a smart-paste category', () => {
  for (const value of ['studio', 'chambre / annexe', 'ferme / terrain agricole']) {
    const key = PROPERTY_TYPE_PLURAL_KEYS[value];
    assert.ok(key, value);
    assert.ok(key.split('.').reduce((o, k) => o?.[k], fr), `${value}: ${key} exists`);
    assert.ok(Object.values(SEO_PROPERTY_TYPES).some((t) => t.propertyType === value), `${value} has a landing page`);
  }
  assert.equal(parseSeoSegments('location', ['salles-de-fete']), null);
  const categories = [
    { id: 34, name: 'Appartement' }, { id: 47, name: 'Studio' }, { id: 48, name: 'Chambre / Annexe' },
    { id: 50, name: 'Ferme / Terrain agricole' },
  ];
  assert.equal(matchCategoryId(categories, 'studio'), 47);
  assert.equal(matchCategoryId(categories, 'chambre'), 48);
  assert.equal(matchCategoryId(categories, 'ferme'), 50);
  assert.equal(matchCategoryId([{ id: 34, name: 'Appartement' }], 'studio'), 34, 'before the migration');
});

test('forms read the details from the fields, and a select left on "Non précisé" is NULL', () => {
  const form = new Map(Object.entries({
    furnished: '', households_count: '4', landlord_on_site: '1', has_pool: '1', has_gym: '',
    electricity_meter: 'partage', plot_dimensions: '5 ares', installments_available: '1', installment_terms: 'en 6 mois',
  }));
  const parsed = details.listingDetailsFromForm({ get: (k) => (form.has(k) ? form.get(k) : null) });
  assert.equal(parsed.furnished, null);
  assert.equal(parsed.households_count, 4);
  assert.equal(parsed.landlord_on_site, true);
  assert.equal(parsed.has_pool, true);
  assert.equal(parsed.has_gym, null);
  assert.equal(parsed.has_generator, null);
  assert.equal(parsed.plot_area_m2, 500);
  assert.equal(parsed.installments_available, true);
  assert.deepEqual(details.DETAIL_COLUMNS, engine.DETAIL_FIELDS, 'the same ten columns on both sides');
});

test('the hero search offers long / short term on the Rent tab and sends lease_term', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../components/SearchBar.js', import.meta.url), 'utf8');
  assert.ok(source.includes("lease_term: transactionType === 'location' ? leaseTerm : ''"), 'the search URL carries it, rentals only');
  assert.ok(source.includes("qs.set('lease_term', leaseTerm)"), 'the live count uses it');
  assert.ok(source.includes("homeTab === 'louer' ?"), 'shown on the Rent tab only');
});

test('Villa counts and filters the same listings: the category, villa plots, and older villas filed under Maison / Duplex', async () => {
  await listings.getListings({ propertyType: 'villa' });
  const filterSql = calls.map((c) => normalizeSql(c.text)).join('\n');
  const filterValues = calls.flatMap((c) => c.values || []);
  assert.ok(filterSql.includes('LOWER(catc.name) = ANY('), 'by category');
  assert.ok(filterSql.includes('pc.title ~*'), 'by title for the older ones');
  assert.ok(filterValues.some((v) => Array.isArray(v) && v.includes('maison') && v.includes('duplex')));
  assert.ok(filterValues.includes('villa'), 'and villa plots');
  reset();
  enqueue([{ label: 'Maison', category_type: 'residential', n: '10' }, { label: 'Duplex', category_type: 'residential', n: '1' }]);
  enqueue([{ n: '0' }]);
  enqueue([{ n: '5' }]);
  const facets = await listings.getPropertyTypeFacets();
  const facetSql = calls.map((c) => normalizeSql(c.text)).join('\n');
  assert.ok(facetSql.includes("pc.title ~*"), 'the Villa count uses the same rule');
  assert.equal(facets.find((f) => f.value === 'villa')?.count, 5);
  assert.equal(facets.find((f) => f.value === 'maison')?.count, 10, 'Maison keeps its own count');
});

test('the filter sheet shows the five chips in order, every other type in one dropdown', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../components/FilterModal.js', import.meta.url), 'utf8');
  assert.ok(source.includes("const PRIMARY_TYPE_VALUES = ['parcelle', 'appartement', 'maison', 'villa', 'terrain'];"));
  assert.ok(source.includes("t('listings.filters.otherTypes')"), 'Duplex, Studio, Bureau… stay reachable');
});
