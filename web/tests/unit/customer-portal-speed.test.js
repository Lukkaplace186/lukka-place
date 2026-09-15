import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as customers from '@/lib/customers';
import { mapWithConcurrency, MATCH_CONCURRENCY } from '@/lib/alerts';
import { MAX_FAVORITES, MAX_SAVED_SEARCHES } from '@/lib/accountLimits';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Espace Client speed and scale (Phase 1 of the customer account audit).
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

test.beforeEach(() => reset());

test('a favourite past the ceiling is refused in SQL and reported as the limit', async () => {
  enqueue([]); // the guarded INSERT wrote nothing
  enqueue([]); // and the row did not already exist
  assert.equal(await customers.addFavorite(7, 301), 'limit');
  assert.match(calls[0].sql, /WHERE \(SELECT COUNT\(\*\) FROM customer_favorites WHERE customer_id = \$1\) < \$3/);
  assert.equal(calls[0].values[2], MAX_FAVORITES);
});

test('a favourite that is already saved is not mistaken for the limit', async () => {
  enqueue([]);
  enqueue([{ '?column?': 1 }]);
  assert.equal(await customers.addFavorite(7, 301), 'exists');
});

test('a saved search under the ceiling is added', async () => {
  enqueue([{ id: 55 }]);
  assert.equal(await customers.addSavedSearch(7, { query: 'commune=Gombe', label: 'Gombe' }), 'added');
  assert.equal(calls[0].values[3], MAX_SAVED_SEARCHES);
});

test('merging a device\'s favourites on login respects the ceiling too', async () => {
  await customers.mergeAnonymousData(7, { favoriteIds: ['1', '2'], savedSearches: [] });
  assert.match(calls[0].sql, /LIMIT GREATEST\(\$3 - \(SELECT COUNT\(\*\) FROM customer_favorites WHERE customer_id = \$1\), 0\)/);
});

test('saved searches are re-run a few at a time, in order', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], MATCH_CONCURRENCY, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  assert.ok(peak <= MATCH_CONCURRENCY, `peak ${peak} exceeded ${MATCH_CONCURRENCY}`);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test('the tab bar counts do not fetch the whole inquiry history', () => {
  const source = read('lib/customerPortal.js');
  assert.ok(!source.includes('getCustomerInquiries('), 'getPortalCounts runs on every tab; it must use the count endpoint');
  assert.match(source, /getLeadCountsByWaIds\(/);
});

test('portal reads shared by the layout and page are memoised per request', () => {
  assert.match(read('lib/customerPortal.js'), /export const getPortalCustomer = cache\(/);
  assert.match(read('lib/customerInquiries.js'), /export const getCustomerInquiries = cache\(/);
  const customersSource = read('lib/customers.js');
  for (const fn of ['getCustomerById', 'listFavoriteIds', 'listSavedSearches', 'getCurrentCustomerId']) {
    assert.match(customersSource, new RegExp(`export const ${fn} = cache\\(`), `${fn} must be cache()-wrapped`);
  }
});

test('every portal tab has a loading state', () => {
  for (const segment of ['', '/messages', '/demandes', '/parametres']) {
    const file = `app/(site)/compte/client${segment}/loading.js`;
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is missing`);
  }
});

test('removing a favourite or an alert no longer waits on a form post', () => {
  assert.ok(!read('app/(site)/compte/client/favoris/FavoritesBoard.js').includes('<form action={removeAction}'));
  assert.ok(!read('app/(site)/compte/client/alertes/AlertsBoard.js').includes('<form action={removeSavedSearchAction}'));
});
