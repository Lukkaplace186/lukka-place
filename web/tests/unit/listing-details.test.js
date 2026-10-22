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
import { calls, normalizeSql, reset } from '../support/fakePool.js';

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
    furnished: '1', households_count: '3', landlord_on_site: '0', toilet_location: 'Intérieur',
    shower_location: 'exterieur', electricity_meter: 'prepaye', plot_dimensions: '15/20',
    installments_available: true, installment_terms: '30 % puis 12 mois',
  };
  const flat = details.normaliseListingDetails(all, { categoryName: 'Appartement', categoryType: 'residential', purpose: 'rent' });
  assert.equal(flat.plot_dimensions, null, 'a flat has no plot');
  assert.equal(flat.installments_available, null, 'a rent is not paid in instalments');
  assert.equal(flat.households_count, 3);
  assert.equal(flat.toilet_location, 'interieur');
  const land = details.normaliseListingDetails(all, { categoryName: 'Terrain', categoryType: 'residential', purpose: 'sale' });
  assert.equal(land.households_count, null);
  assert.equal(land.toilet_location, null);
  assert.equal(land.electricity_meter, null);
  assert.equal(land.furnished, null);
  assert.equal(land.plot_area_m2, 300);
  assert.equal(land.installment_terms, '30 % puis 12 mois');
  const hall = details.normaliseListingDetails(all, { categoryName: 'Salle de fête', categoryType: 'commercial', purpose: 'rent' });
  assert.equal(hall.landlord_on_site, null, 'nobody shares an event hall as a household');
  assert.equal(details.normaliseListingDetails({ toilet_location: 'cuisine', households_count: 900 }).toilet_location, null);
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
  await listings.getListings({ plotMin: 'abc' });
  assert.ok(!calls.map((c) => normalizeSql(c.text)).join('\n').includes("->> 'plot_area_m2', '')::numeric"), 'a junk size filters nothing');
});

test('the new types filter by category, and old studios still match by title', async () => {
  await listings.getListings({ propertyType: 'studio' });
  const sql = calls.map((c) => normalizeSql(c.text)).join('\n');
  assert.ok(sql.includes("LOWER(catc.name) = 'appartement' AND pc.title ~*"));
  for (const [value, name] of [['chambre', 'chambre / annexe'], ['ferme', 'ferme / terrain agricole'], ['salle_de_fete', 'salle de fête']]) {
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
  assert.equal(parseSearchQuery('salle de fête limete').property_type, 'salle_de_fete');
  assert.equal(parseSearchQuery('terrain agricole mont-ngafula').property_type, 'ferme');
  assert.equal(parseSearchQuery('annexe à louer ngaba').property_type, 'chambre');
  assert.equal(parseSearchQuery('2 chambres kintambo').property_type, undefined, 'bedrooms are not a room to let');
});

test('every new type has a plural, a landing page and a smart-paste category', () => {
  for (const value of ['studio', 'chambre / annexe', 'salle de fête', 'ferme / terrain agricole']) {
    const key = PROPERTY_TYPE_PLURAL_KEYS[value];
    assert.ok(key, value);
    assert.ok(key.split('.').reduce((o, k) => o?.[k], fr), `${value}: ${key} exists`);
    assert.ok(Object.values(SEO_PROPERTY_TYPES).some((t) => t.propertyType === value), `${value} has a landing page`);
  }
  assert.equal(parseSeoSegments('location', ['salles-de-fete']).propertyType, 'salle de fête');
  const categories = [
    { id: 34, name: 'Appartement' }, { id: 47, name: 'Studio' }, { id: 48, name: 'Chambre / Annexe' },
    { id: 49, name: 'Salle de fête' }, { id: 50, name: 'Ferme / Terrain agricole' },
  ];
  assert.equal(matchCategoryId(categories, 'studio'), 47);
  assert.equal(matchCategoryId(categories, 'chambre'), 48);
  assert.equal(matchCategoryId(categories, 'salle_de_fete'), 49);
  assert.equal(matchCategoryId(categories, 'ferme'), 50);
  assert.equal(matchCategoryId([{ id: 34, name: 'Appartement' }], 'studio'), 34, 'before the migration');
});

test('forms read the details from the fields, and a select left on "Non précisé" is NULL', () => {
  const form = new Map(Object.entries({
    furnished: '', households_count: '4', landlord_on_site: '1', toilet_location: '', shower_location: 'interieur',
    electricity_meter: 'partage', plot_dimensions: '5 ares', installments_available: '1', installment_terms: 'en 6 mois',
  }));
  const parsed = details.listingDetailsFromForm({ get: (k) => (form.has(k) ? form.get(k) : null) });
  assert.equal(parsed.furnished, null);
  assert.equal(parsed.households_count, 4);
  assert.equal(parsed.landlord_on_site, true);
  assert.equal(parsed.toilet_location, null);
  assert.equal(parsed.plot_area_m2, 500);
  assert.equal(parsed.installments_available, true);
  assert.deepEqual(details.DETAIL_COLUMNS, engine.DETAIL_FIELDS, 'the same ten columns on both sides');
});
