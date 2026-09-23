import test from 'node:test';
import assert from 'node:assert/strict';
import * as listings from '@/lib/listings';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { calls, enqueue, reset } from '../support/fakePool.js';
import { readFileSync } from 'node:fs';

/**
 * The list follows the map: once a visitor has moved the /listings map, the
 * URL carries its visible area (sw_lat…) and the list must show exactly the
 * listings the map counts "dans cette zone". Reported: zooming in to 10 pins
 * and tapping "Liste" still listed the whole search.
 */

test.beforeEach(() => reset());

const AREA = { sw_lat: '-4.34', sw_lng: '15.29', ne_lat: '-4.30', ne_lng: '15.33' };

test('the four bounds params parse into a box; a partial box is ignored, not widened', () => {
  assert.deepEqual(parseListingsSearchParams(AREA).bounds, { south: -4.34, west: 15.29, north: -4.3, east: 15.33 });
  assert.equal(parseListingsSearchParams({ sw_lat: '-4.34' }).bounds, null);
  assert.equal(parseListingsSearchParams({}).bounds, null);
});

test('with an area, the list is the map\'s own markers — same box, commune dropped', async () => {
  // 1: getMapMarkers' read (padded by nothing here): #7 is in the box, #9 is
  // outside it and must not reach the list.
  enqueue([
    { id: 7, lat: -4.32, lng: 15.31, price: 500, commune: 'Kinshasa' },
    { id: 9, lat: -4.40, lng: 15.40, price: 900 },
  ]);
  enqueue([{ total: '1' }]);
  enqueue([{ id: 7 }]);

  const result = await listings.getListings({
    ...parseListingsSearchParams({ ...AREA, commune: 'Bandalungwa', beds_min: '2' }),
    limit: 12,
  });

  assert.deepEqual(result.mapArea, { truncated: false });
  const [markerQuery, countQuery, dataQuery] = calls.map((c) => c.sql);
  assert.match(markerQuery, /BETWEEN/, 'the marker read is bounded by the box');
  for (const sql of [countQuery, dataQuery]) {
    assert.match(sql, /p\.id = ANY/, 'the list is restricted to the ids the map placed in view');
    assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  }
  assert.deepEqual(calls[1].values.find(Array.isArray), [7], 'only the in-view id reaches the list');
  assert.ok(!calls[1].values.includes('Bandalungwa'), 'the commune gives way to the area, as on the map');
  assert.ok(calls[1].values.includes(2), 'every other filter still applies');
});

test('an empty area lists nothing — never the whole city', async () => {
  enqueue([]);
  enqueue([{ total: '0' }]);
  enqueue([]);
  const result = await listings.getListings({ ...parseListingsSearchParams(AREA), limit: 12 });
  assert.equal(result.total, 0);
  assert.deepEqual(calls[1].values.find(Array.isArray), []);
});

test('without an area nothing changes: no marker read, mapArea null', async () => {
  const result = await listings.getListings({ ...parseListingsSearchParams({ commune: 'Gombe' }), limit: 12 });
  assert.equal(result.mapArea, null);
  assert.equal(calls.length, 2, 'one COUNT and one data query, as before');
  assert.ok(calls.every((c) => !/p\.id = ANY/.test(c.sql)));
});

test('the map reports only a view the visitor chose, and the phone list does not re-render per pan', () => {
  const map = readFileSync(new URL('../../components/ListingsMap.js', import.meta.url), 'utf8');
  assert.match(map, /onAreaChange\?\.\(toBounds\(latLngBounds\)\)/);
  assert.match(map, /area\.baseline === null/, 'the first settled view after positioning is the baseline, not a move');
  const split = readFileSync(new URL('../../components/ListingsSplitView.js', import.meta.url), 'utf8');
  assert.match(split, /router\.replace\(url, \{ scroll: false \}\)/);
  assert.match(split, /window\.history\.replaceState\(null, '', url\)/);
});
