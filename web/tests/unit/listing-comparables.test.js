import test from 'node:test';
import assert from 'node:assert/strict';
import {
  storedPosition,
  comparablesQuery,
  pickComparables,
  comparableBeds,
  COMPARABLES_MAX,
} from '@/lib/comparables';

/**
 * The detail page's comparison map (lib/comparables.js): which listings count
 * as "like this one", and from which point.
 */

const kintambo = { lat: -4.33, lng: 15.28 };
const listing = {
  id: 293,
  purpose: 'rent',
  category_name: 'Appartement',
  beds: 3,
  latitude: '-4.33',
  longitude: '15.28',
};

test('storedPosition uses stored coordinates only', () => {
  assert.deepEqual(storedPosition(listing), { lat: -4.33, lng: 15.28, approximate: false });
  assert.equal(storedPosition({ ...listing, latitude: '', longitude: '' }), null);
  assert.equal(storedPosition({ ...listing, latitude: null }), null);
  assert.equal(storedPosition({ ...listing, latitude: '0', longitude: '0' }), null);
  assert.equal(storedPosition({ ...listing, latitude: 'abc' }), null);
});

test('comparablesQuery: same purpose, type and bedrooms, in a box around the listing', () => {
  const q = comparablesQuery(listing, kintambo);
  assert.equal(q.get('transaction_type'), 'location');
  assert.equal(q.get('property_type'), 'appartement');
  assert.equal(q.get('beds_min'), '3');
  assert.ok(Number(q.get('sw_lat')) < kintambo.lat && Number(q.get('ne_lat')) > kintambo.lat);
  assert.ok(Number(q.get('sw_lng')) < kintambo.lng && Number(q.get('ne_lng')) > kintambo.lng);
  // ~3 km each way.
  assert.ok(Math.abs(Number(q.get('ne_lat')) - kintambo.lat - 0.027) < 0.001);
});

test('comparablesQuery: a parcelle compares with the same sub-type; a sale with sales', () => {
  const q = comparablesQuery({ ...listing, purpose: 'sale', parcelle_subtype: 'villa' }, kintambo);
  assert.equal(q.get('transaction_type'), 'vente');
  assert.equal(q.get('property_type'), 'parcelle');
  assert.equal(q.get('parcelle_subtype'), 'villa');
});

test('comparablesQuery: no bedroom filter for a listing that states none; nothing without a type', () => {
  assert.equal(comparablesQuery({ ...listing, beds: 0 }, kintambo).get('beds_min'), null);
  assert.equal(comparableBeds({ beds: null }), null);
  assert.equal(comparablesQuery({ ...listing, category_name: null }, kintambo), null);
  assert.equal(comparablesQuery({ ...listing, purpose: null }, kintambo), null);
});

test('pickComparables: never itself, exact bedrooms, priced, inside the radius, nearest first, capped', () => {
  const near = (id, dLat, extra = {}) => ({ id, lat: kintambo.lat + dLat, lng: kintambo.lng, beds: 3, price: 1000, ...extra });
  const markers = [
    near(293, 0),                       // the listing itself
    near(1, 0.02),                      // ~2.2 km
    near(2, 0.005),                     // ~0.6 km
    near(3, 0.001, { beds: 4 }),        // beds_min lets a 4-bed through: dropped
    near(4, 0.001, { price: null }),    // price on request: nothing to compare
    near(5, 0.026),                     // box corner reach, ~2.9 km: kept
    near(6, 0.04),                      // ~4.4 km: outside the radius
  ];
  const picked = pickComparables(markers, listing, kintambo).map((m) => m.id);
  assert.deepEqual(picked, [2, 1, 5]);

  const many = Array.from({ length: 20 }, (_, i) => near(100 + i, 0.001 * (i + 1)));
  assert.equal(pickComparables(many, listing, kintambo).length, COMPARABLES_MAX);
});
