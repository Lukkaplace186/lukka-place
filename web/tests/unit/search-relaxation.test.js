import test from 'node:test';
import assert from 'node:assert/strict';
import * as listings from '@/lib/listings';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * lib/listings.js — the free-text words, several communes, and relaxSearch
 * (what /listings shows instead of an empty page). SQL-shape assertions, as
 * in listings-sql.test.js: the public gate must survive every relaxed query.
 */

const APPROVED = 'p.status = 1 AND p.approve_status = 1';

test.beforeEach(() => reset());

test('leftover words are matched one by one, accent-insensitively — never as one phrase', async () => {
  enqueue([{ total: '2' }]);
  enqueue([]);
  await listings.getListings({ search: 'pas cher meublé piscine' });

  const [count] = calls;
  // Filler is gone; each real word is its own regex parameter.
  assert.ok(count.values.includes('\\ymeuble'));
  assert.ok(count.values.includes('\\ypiscine'));
  assert.ok(!count.values.some((v) => typeof v === 'string' && /cher/.test(v)), 'filler must not be searched');
  assert.ok(count.sql.includes('translate(lower('), 'columns must be accent-folded');
  assert.ok(!/ILIKE '%pas cher/.test(count.sql));
});

test('"Saint" and "St" are the same word', async () => {
  enqueue([{ total: '1' }]);
  enqueue([]);
  await listings.getListings({ search: 'St Luc' });
  assert.ok(calls[0].values.includes('\\y(saint|st)\\y'));
});

test('several communes filter on any of them', async () => {
  enqueue([{ total: '4' }]);
  enqueue([]);
  await listings.getListings({ commune: 'Gombe', communes: ['Gombe', 'Ngaliema'] });
  assert.ok(calls[0].sql.includes('ac.name = ANY('));
  assert.ok(calls[0].values.some((v) => Array.isArray(v) && v.join() === 'Gombe,Ngaliema'));
});

test('without allowRelax an empty search stays empty — alerts and internal readers need the exact answer', async () => {
  const result = await listings.getListings({ commune: 'Kimbanseke', propertyType: 'appartement' });
  assert.equal(result.total, 0);
  assert.equal(result.relaxation, null);
  assert.equal(calls.length, 2, 'one COUNT and one data query, nothing else');
});

test('words no listing contains are dropped, and named', async () => {
  enqueue([{ total: '0' }]); // exact, with the word
  enqueue([{ total: '3' }]); // without it
  enqueue([]); // data
  const result = await listings.getListings({ search: 'meublé', allowRelax: true });

  assert.equal(result.total, 3);
  assert.deepEqual(result.relaxation.keywordsIgnored, ['meuble']);
  const data = calls[calls.length - 1];
  assert.ok(!data.values.includes('\\ymeuble'));
  assert.ok(data.sql.includes(APPROVED));
});

test('a quartier with nothing widens to its commune', async () => {
  enqueue([{ total: '0' }]);
  enqueue([{ total: '5' }]);
  enqueue([]);
  const result = await listings.getListings({ commune: 'Ngaliema', quartier: 'Ma Campagne', allowRelax: true });

  assert.deepEqual(result.relaxation.quartierWidened, { quartier: 'Ma Campagne', commune: 'Ngaliema' });
  const data = calls[calls.length - 1];
  assert.ok(!data.values.includes('Ma Campagne'));
  assert.ok(data.values.includes('Ngaliema'));
});

test('an empty commune falls back to the nearest listings, nearest first, keeping type and purpose', async () => {
  // Positions relative to Kimbanseke's own centre: ~4 km and ~40 km away.
  const origin = KINSHASA_COMMUNE_CENTROIDS.Kimbanseke;
  const masina = { lat: origin.lat + 0.03, lng: origin.lng - 0.02 };
  const gombe = { lat: origin.lat + 0.2, lng: origin.lng - 0.3 };
  enqueue([{ total: '0' }]); // exact count at Kimbanseke
  enqueue([
    // getMapMarkers rows, as its SELECT returns them
    { id: 21, lat: gombe.lat, lng: gombe.lng, commune: 'Gombe' },
    { id: 11, lat: masina.lat, lng: masina.lng, commune: 'Masina' },
  ]);
  enqueue([]); // data

  const result = await listings.getListings({
    commune: 'Kimbanseke',
    propertyType: 'appartement',
    transactionType: 'location',
    allowRelax: true,
  });

  assert.ok(result.relaxation.nearby, 'expected a nearby fallback');
  assert.deepEqual(result.relaxation.nearby.origin, ['Kimbanseke']);
  assert.equal(result.relaxation.nearby.places[0].commune, 'Masina');

  const markers = calls[1];
  assert.ok(markers.sql.includes(APPROVED));
  assert.ok(!markers.values.includes('Kimbanseke'), 'the commune filter gives way to distance');
  assert.ok(markers.values.includes('appartement') && markers.values.includes('rent'), 'type and purpose are never relaxed');

  const data = calls[calls.length - 1];
  assert.ok(data.sql.includes(APPROVED));
  assert.ok(data.sql.includes('array_position('), 'nearest first');
  const ids = data.values[data.values.length - 1];
  assert.equal(ids[0], 11);
  // Beyond the nearby radius: not offered as "proche".
  assert.ok(!ids.includes(21));
});

test('a budget stretch is the last resort, and says by how much', async () => {
  enqueue([{ total: '0' }]); // exact
  enqueue([{ total: '2' }]); // price_max 1150
  enqueue([]);
  const result = await listings.getListings({ priceMax: '1000', allowRelax: true });
  assert.deepEqual(result.relaxation.priceMax, { from: 1000, to: 1150 });
  assert.ok(calls[calls.length - 1].values.includes(1150));
});

test('a reference search is never relaxed — it names one listing', async () => {
  const result = await listings.getListings({ reference: 'LKP-2026-0091', allowRelax: true });
  assert.equal(result.relaxation, null);
  assert.equal(calls.length, 2);
});
