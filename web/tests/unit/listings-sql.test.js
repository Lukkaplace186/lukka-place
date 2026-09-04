import test from 'node:test';
import assert from 'node:assert/strict';
import * as listings from '@/lib/listings';
import { calls, enqueue, reset, normalizeSql } from '../support/fakePool.js';

/**
 * SQL-shape tests for lib/listings.js.
 *
 * `properties` has NO Row Level Security (web/CLAUDE.md). The query-time
 * filter `p.status = 1 AND p.approve_status = 1` is the ONLY thing keeping
 * pending and rejected listings off the public site. A test that compared
 * returned rows would pass just as happily with that filter deleted, as long
 * as the fixture contained no pending rows — so these assert on the emitted
 * SQL, which cannot be fooled that way.
 */

const APPROVED = 'p.status = 1 AND p.approve_status = 1';

/** Every SQL string this module emitted during one call, joined. */
function allSql() {
  return calls.map((c) => c.sql).join('\n');
}

test.beforeEach(() => reset());

test('getListings applies the approved filter to both count and data queries', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({});

  assert.equal(calls.length, 2, 'expected one COUNT and one data query');
  for (const call of calls) {
    assert.ok(call.sql.includes(APPROVED), `missing approved filter in: ${call.sql.slice(0, 120)}`);
  }
});

test('getListingById applies the approved filter — a guessed URL to a pending listing must not render', async () => {
  enqueue([]);
  await listings.getListingById(123);
  assert.ok(allSql().includes(APPROVED));
});

test('getListingsByIds applies the approved filter — /favoris cannot resurrect an unapproved listing', async () => {
  enqueue([]);
  await listings.getListingsByIds([1, 2, 3]);
  assert.ok(allSql().includes(APPROVED));
});

test('getSimilarListings applies the approved filter', async () => {
  enqueue([]);
  await listings.getSimilarListings({ id: 1, embedding: null });
  // No embedding means it may short-circuit; only assert when it queried.
  if (calls.length) assert.ok(allSql().includes(APPROVED));
});

test('getListingsForModeration is the ONE documented exception and must stay admin-only', async () => {
  enqueue([]);
  await listings.getListingsForModeration('pending');
  const sql = allSql();
  assert.ok(!sql.includes(APPROVED), 'moderation query must see unapproved rows by design');
  assert.ok(/approve_status/.test(sql), 'but it must still filter by some approve_status');
});

/**
 * F2 regression. `properties.latitude`/`longitude` are real columns, and the
 * km-radius filter in this same module queries them — but SELECT_FIELDS did
 * not select them, so lib/geocoding.js's `source: 'existing'` branch was
 * dead for every listing on the site and every map view re-geocoded
 * client-side against a billable Google API. Two sources of truth for one
 * location, disagreeing by construction.
 */
test('SELECT_FIELDS selects latitude/longitude so the map can use stored coordinates (F2)', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({});

  const dataQuery = calls[1].sql;
  assert.match(dataQuery, /p\.latitude/, 'SELECT_FIELDS must select p.latitude');
  assert.match(dataQuery, /p\.longitude/, 'SELECT_FIELDS must select p.longitude');
});

test('the radius filter queries the same latitude column the SELECT exposes', async () => {
  // No fixtures: the fake pool answers COUNT queries with a real zero row,
  // so the widening ladder runs to completion without the test having to
  // predict how many rungs it takes.
  await listings.getListings({ commune: 'Gombe', radius: '3' });
  assert.match(allSql(), /latitude/, 'radius filtering relies on the coordinate columns');
});

/**
 * P0-2. The moderation queue must see listings the public site cannot render.
 * A missing property_contents row made #152 invisible — and therefore both
 * un-approvable and un-rejectable — for 47 days, with the pending count in
 * the admin UI quietly one lower than the database's.
 */
test('the moderation queue LEFT JOINs, so a listing with no content row still appears (P0-2)', async () => {
  await listings.getListingsForModeration('pending');
  const sql = allSql();

  assert.ok(
    !/JOIN property_contents/.test(sql.replace(/LEFT JOIN property_contents/g, '')),
    'property_contents must be LEFT JOINed in the moderation query, never INNER',
  );
  assert.match(sql, /LEFT JOIN property_contents/);
  assert.match(sql, /LEFT JOIN property_category_contents/);
  assert.match(sql, /missing_content/, 'the queue must be able to show WHY a listing is broken');
});

test('every moderation status filter is a distinct approve_status', async () => {
  const seen = new Set();
  for (const status of ['pending', 'approved', 'rejected']) {
    reset();
    await listings.getListingsForModeration(status);
    const match = allSql().match(/p\.approve_status = (\d)/);
    assert.ok(match, `${status} must filter on approve_status`);
    seen.add(match[1]);
  }
  assert.equal(seen.size, 3, 'the three tabs must return disjoint sets');
});
