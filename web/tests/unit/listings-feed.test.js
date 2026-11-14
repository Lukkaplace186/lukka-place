import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as listings from '@/lib/listings';
import { completeExactBatch } from '@/lib/listingsFeed';
import { feedCursor, parseFeedCursor, pageForCursor, FEED_PAGE_SIZE } from '@/lib/listingsFeedCursor';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { calls, enqueue, reset, normalizeSql } from '../support/fakePool.js';

/**
 * The endless /listings feed (2026-11-14, owner decision): exact results
 * first, ranked by what was asked then by freshness, and only then the same
 * search in the nearby communes, nearest commune first.
 */

const GATE = 'p.status = 1 AND p.approve_status = 1';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test.beforeEach(() => reset());

test('the default order leads with the exact bedroom count, then up to date, photo, most recent', () => {
  const order = listings.orderByFor({ bedsMin: '2' });
  assert.ok(order.startsWith('(CASE WHEN p.beds = 2 THEN 0 ELSE 1 END) ASC'));
  const at = (needle) => order.indexOf(needle);
  assert.ok(at('availability_confirmed_at') > 0, 'up-to-date tier');
  assert.ok(at('noimage') > at('CASE WHEN p.beds'), 'photo after rooms');
  assert.ok(at(`${listings.LAST_ACTIVITY_SQL} DESC`) > at('noimage'), 'most recent after photo');
  assert.ok(order.endsWith('p.id DESC'), 'a total order, so OFFSET batches never repeat or skip');
});

test('a chosen sort is kept as asked, with a stable tie-break, and no rooms boost', () => {
  assert.equal(listings.orderByFor({ sort: 'price_asc', bedsMin: '2' }), 'p.price ASC, p.id DESC');
  assert.equal(listings.orderByFor({ sort: 'newest' }), 'p.created_at DESC, p.id DESC');
  assert.ok(!listings.orderByFor({ bedsMin: 'abc' }).includes('p.beds ='), 'only a real number is inlined');
});

test('getListings orders by the same rule', async () => {
  enqueue([{ total: '1' }]);
  enqueue([{ id: 1 }]);
  await listings.getListings({ commune: 'Kintambo', bedsMin: '2' });
  assert.ok(normalizeSql(calls[1].sql).includes('ORDER BY (CASE WHEN p.beds = 2 THEN 0 ELSE 1 END) ASC'));
});

test('nearby continuation: every exact match first, then commune by commune, nearest first', async () => {
  const c = KINSHASA_COMMUNE_CENTROIDS;
  // Map markers for the same filters without the place: two in Kintambo
  // (one of them is an exact result), then Ngaliema and Lingwala.
  enqueue([
    { id: 1, lat: c.Kintambo.lat, lng: c.Kintambo.lng, commune: 'Kintambo' },
    { id: 9, lat: c.Kintambo.lat, lng: c.Kintambo.lng, commune: 'Kintambo' },
    { id: 4, lat: c.Lingwala.lat, lng: c.Lingwala.lng, commune: 'Lingwala' },
    { id: 3, lat: c.Ngaliema.lat, lng: c.Ngaliema.lng, commune: 'Ngaliema' },
  ]);
  enqueue([{ id: 1 }]); // the exact search's ids
  enqueue([{ id: 9 }, { id: 3 }]);

  const cont = await listings.getNearbyContinuation({ commune: 'Kintambo', bedsMin: '2', transactionType: 'location' });

  const [, , page] = calls;
  const sql = normalizeSql(page.sql);
  assert.ok(sql.includes(GATE), 'public gate on the continuation read');
  assert.ok(sql.includes('array_position'), 'commune groups lead the order');
  const n = page.values.length;
  const ids = page.values[n - 3];
  const ranks = page.values[n - 4];
  assert.ok(!ids.includes(1), 'an exact result is never repeated');
  assert.equal(ids[0], 9, 'the searched commune (a quartier search) comes first');
  const km = (name) => Math.hypot(c[name].lat - c.Kintambo.lat, c[name].lng - c.Kintambo.lng);
  const expected = km('Ngaliema') < km('Lingwala') ? [9, 3, 4] : [9, 4, 3];
  assert.deepEqual(ids, expected, 'nearest commune first');
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'ranks follow the ids');
  assert.equal(cont.total, 3);
  assert.ok(cont.places.every((p) => p.commune !== 'Kintambo'), 'the heading names the other communes');
});

test('no continuation for a map area, a fallback, a radius or a search without a place', () => {
  assert.equal(listings.canContinueNearby({}, {}), false);
  assert.equal(listings.canContinueNearby({ commune: 'Gombe' }, {}), true);
  assert.equal(listings.canContinueNearby({ commune: 'Gombe' }, { mapArea: {} }), false);
  assert.equal(listings.canContinueNearby({ commune: 'Gombe' }, { relaxation: {} }), false);
  assert.equal(listings.canContinueNearby({ commune: 'Gombe', radius: '3' }, {}), false);
  assert.equal(listings.canContinueNearby({ commune: 'Gombe', ids: [1] }, {}), false);
});

test('a batch says where the next one starts', async () => {
  const exactLeft = await completeExactBatch({ commune: 'Gombe' }, { total: 30, count: 12 }, 0);
  assert.equal(exactLeft.next, 'e:12');
  const exactDoneFull = await completeExactBatch({ commune: 'Gombe' }, { total: 24, count: 12 }, 12);
  assert.equal(exactDoneFull.next, 's:0', 'a full last exact batch hands over to the nearby part');
  const noPlace = await completeExactBatch({}, { total: 5, count: 5 }, 0);
  assert.equal(noPlace.next, null, 'without a place, the feed ends with the exact results');
  assert.equal(calls.length, 0);
});

test('cursors are strict, and an exact cursor maps back to a ?page= link', () => {
  assert.deepEqual(parseFeedCursor('e:12'), { phase: 'e', offset: 12 });
  assert.deepEqual(parseFeedCursor(feedCursor('s', 24)), { phase: 's', offset: 24 });
  for (const bad of ['', 'x:1', 'e:-1', 'e:1;DROP', 'e:99999', null]) assert.equal(parseFeedCursor(bad), null);
  assert.equal(pageForCursor(`e:${FEED_PAGE_SIZE * 2}`), 3);
  assert.equal(pageForCursor('s:12'), null);
});

test('/listings has no page counter any more, and the feed API keeps the public filters', () => {
  assert.doesNotMatch(read('components/ListingsSplitView.js'), /Page \{page\} \/ \{totalPages\}/);
  const route = read('app/api/listings/feed/route.js');
  assert.match(route, /parseListingsSearchParams\(searchParams\)/);
  assert.match(route, /publicVille/);
});
