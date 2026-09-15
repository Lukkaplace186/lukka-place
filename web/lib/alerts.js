import { getListings } from './listings';
import { parseListingsSearchParams } from './searchQuery';

/**
 * How many saved searches are re-run at once. Each is one to three queries
 * (getListings' COUNT plus its widening ladder), and all of them used to
 * start together: a customer with 20 alerts opened the tab and put up to 60
 * simultaneous queries on a pool every visitor shares.
 */
export const MATCH_CONCURRENCY = 4;

/**
 * `fn` over `items` with at most `limit` in flight, results in input order.
 * Exported for the unit tier.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Re-runs each saved search through the real, unmodified getListings() and
 * counts listings created since the search was last viewed (or since it was
 * saved, if never viewed) — extracted out of /compte/alertes/page.js so
 * /compte's account overview can show the same honest "new matches" count
 * without a second, drifting copy of this mapping.
 *
 * Callers decide if/when to call touchSavedSearchesViewed — this function
 * never marks anything viewed itself, so a page that merely surfaces a
 * summary count (the overview) doesn't silently zero out the counter the
 * dedicated alerts page is about to show.
 */
export async function getSavedSearchMatches(searches, { limit = 60, concurrency = MATCH_CONCURRENCY } = {}) {
  return mapWithConcurrency(searches, concurrency, async (search) => {
    const filters = parseListingsSearchParams(new URLSearchParams(search.query));
    const { data, total } = await getListings({ ...filters, sort: 'newest', limit });
    const since = new Date(search.last_viewed_at || search.created_at);
    const newListings = data.filter((l) => new Date(l.created_at) > since);
    return { search, newListings, newCount: newListings.length, total };
  });
}
