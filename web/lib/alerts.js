import { getListings } from './listings';
import { parseListingsSearchParams } from './searchQuery';

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
export async function getSavedSearchMatches(searches, { limit = 60 } = {}) {
  return Promise.all(
    searches.map(async (search) => {
      const filters = parseListingsSearchParams(new URLSearchParams(search.query));
      const { data, total } = await getListings({ ...filters, sort: 'newest', limit });
      const since = new Date(search.last_viewed_at || search.created_at);
      const newListings = data.filter((l) => new Date(l.created_at) > since);
      return { search, newListings, newCount: newListings.length, total };
    }),
  );
}
