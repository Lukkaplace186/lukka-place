import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as listings from '@/lib/listings';
import { cardPromoBadge } from '@/lib/listingView';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * "Nouveau" and "Prix en baisse" on listing cards (2026-10-18). Both must be
 * recorded facts: freshness from the publication time, a price cut from
 * property_price_history. These pin the rules a "simplification" would break.
 */

test.beforeEach(() => reset());

test('a recorded reduction shows its real percentage', () => {
  assert.deepEqual(cardPromoBadge({ price: '900', price_drop_from: '1000', is_fresh: true }), {
    kind: 'priceDrop',
    percent: 10,
  });
});

test('a price cut wins over "Nouveau"; "Nouveau" alone otherwise', () => {
  assert.equal(cardPromoBadge({ price: 900, price_drop_from: null, is_fresh: true }).kind, 'fresh');
  assert.equal(cardPromoBadge({ price: 900, price_drop_from: null, is_fresh: false }), null);
});

test('a reduction above 50 % is read as a corrected typo, not a bargain', () => {
  assert.equal(cardPromoBadge({ price: 1500, price_drop_from: 15000, is_fresh: false }), null);
});

test('no stamp on a listing under offer or let/sold', () => {
  for (const status of ['under_offer', 'closed']) {
    assert.equal(cardPromoBadge({ price: 900, price_drop_from: 1000, is_fresh: true, listing_status: status }), null);
  }
});

test('a "drop_from" not above the current price is never a cut', () => {
  assert.equal(cardPromoBadge({ price: 1000, price_drop_from: 1000, is_fresh: false }), null);
  assert.equal(cardPromoBadge({ price: 1100, price_drop_from: 1000, is_fresh: false }), null);
  assert.equal(cardPromoBadge({ price: 0, price_drop_from: 1000, is_fresh: false }), null);
});

test('both flags are computed in SQL on the database clock, from the price history', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({});
  const sql = calls.map((c) => c.sql).join('\n');
  assert.match(sql, /AS is_fresh/);
  assert.match(sql, /FROM property_price_history h/);
  // Only a change made after the listing went public counts.
  assert.match(sql, /h\.changed_at > GREATEST\(p\.created_at/);
  assert.ok(sql.includes('p.status = 1 AND p.approve_status = 1'));
});

test('the card never decides freshness with the browser clock', () => {
  const source = readFileSync(new URL('../../components/ListingBadges.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now\(\)/);
});
