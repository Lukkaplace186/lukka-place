import test from 'node:test';
import assert from 'node:assert/strict';
import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * SQL-shape tests for the viewport map's reads (lib/listings.js getMapMarkers
 * / getMapExtent), in the same spirit as listings-sql.test.js: the approval
 * gate is asserted on the emitted SQL, because a row fixture with no pending
 * rows would pass just as happily with it deleted.
 */

const APPROVED = 'p.status = 1 AND p.approve_status = 1';
const KINSHASA = { south: -4.5, west: 15.1, north: -4.2, east: 15.5 };

test.beforeEach(() => reset());

test('getMapMarkers keeps the approval gate, uses the box, and is not paginated to 12', async () => {
  enqueue([]);
  await listings.getMapMarkers({ bedsMin: '2' }, KINSHASA);

  assert.equal(calls.length, 1);
  const [{ sql, values }] = calls;
  assert.ok(sql.includes(APPROVED), 'the map must never show an unapproved listing');
  assert.ok(sql.includes(`${listings.LAT_EXPR} BETWEEN`), 'bounding box must filter on the indexed expression');
  assert.ok(sql.includes('p.beds >='), 'non-location filters still apply inside the box');
  assert.equal(values.at(-1), listings.MAP_MARKERS_MAX + 1, 'the only limit is the map ceiling, not a page size');
  assert.ok(!/LIMIT 12\b/.test(sql));
});

test('with a box, the commune filter gives way to the viewport; without one it still applies', async () => {
  enqueue([]);
  await listings.getMapMarkers({ commune: 'Bandalungwa', quartier: 'Lingwala', bedsMin: '2' }, KINSHASA);
  assert.ok(!calls[0].values.includes('Bandalungwa'), 'panning out of Bandal must load listings beyond it');
  assert.ok(!calls[0].values.includes('Lingwala'));

  reset();
  enqueue([]);
  await listings.getMapMarkers({ commune: 'Bandalungwa' }, null);
  assert.ok(calls[0].values.includes('Bandalungwa'));
});

test('getMapMarkers places, counts and filters rows honestly', async () => {
  enqueue([
    { id: 1, lat: -4.33, lng: 15.31, commune: 'Gombe', price: '500', purpose: 'rent' },
    { id: 2, lat: null, lng: null, commune: 'Gombe', price: '900', purpose: 'rent' },
    { id: 3, lat: null, lng: null, commune: null, address: 'Kin', price: '100', purpose: 'rent' },
    { id: 4, lat: 5.1, lng: 10.2, commune: null, price: '100', purpose: 'sale' },
    { id: 5, lat: null, lng: null, commune: 'Maluku', price: '100', purpose: 'sale' },
  ]);
  const result = await listings.getMapMarkers({}, { south: -4.35, west: 15.28, north: -4.29, east: 15.34 });

  assert.deepEqual(result.markers.map((m) => m.id), [1, 2]);
  assert.equal(result.markers[0].approximate, false);
  assert.equal(result.markers[1].approximate, true, 'no stored coordinates: commune centroid, flagged');
  assert.equal(result.approximate, 1);
  assert.equal(result.unlocated, 1, 'no coordinates and no commune: counted, never plotted at a made-up point');
  assert.deepEqual(result.unlocatedIds, [3]);
  assert.equal(result.truncated, false);
  assert.equal('description' in result.markers[0], false, 'markers stay lightweight');
});

test('getMapMarkers flags a response over the ceiling as truncated', async () => {
  const rows = Array.from({ length: listings.MAP_MARKERS_MAX + 1 }, (_, i) => ({ id: i, lat: -4.3, lng: 15.3 }));
  enqueue(rows);
  const result = await listings.getMapMarkers({}, KINSHASA);
  assert.equal(result.truncated, true);
  assert.equal(result.markers.length, listings.MAP_MARKERS_MAX);
});

test('getMapExtent gates both reads and widens the stored box with commune centroids', async () => {
  enqueue([{ south: '-4.40', north: '-4.30', west: '15.20', east: '15.30', total: '3' }]);
  enqueue([{ commune: 'Nsele' }, { commune: null }]);
  const { extent, total } = await listings.getMapExtent({ bedsMin: '2' });

  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(call.sql.includes(APPROVED));
  assert.equal(total, 3);
  assert.equal(extent.north, -4.3);
  assert.equal(extent.west, 15.2);
  // Nsele's centroid (-4.4257, 15.3848) lies south-east of the stored box.
  assert.ok(extent.south < -4.42 && extent.east > 15.38, 'a listing placed at the Nsele centroid must be inside the opening view');
});

test('getMapExtent is null when nothing matching can be placed', async () => {
  enqueue([{ south: null, north: null, west: null, east: null, total: '2' }]);
  enqueue([{ commune: null }]);
  const { extent, total } = await listings.getMapExtent({});
  assert.equal(extent, null);
  assert.equal(total, 2);
});
