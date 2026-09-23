import 'server-only';
import { memo } from './memo';
import {
  getCommuneShowcase,
  getListings,
  getPopularCommunes,
  getPriceRange,
  getPropertyTypeFacets,
  getSeoFacets,
} from './listings';

/**
 * 60-second copies of the public reads that every homepage and /listings
 * visit repeated: commune counts, type facets, the price ceiling, the
 * commune showcase, the hero's opening count and the featured cards. See
 * lib/memo.js for why in-process and why short.
 *
 * Kept in their own module rather than inside lib/listings.js: the SQL tests
 * (tests/unit/listings-sql.test.js) call those functions against a recording
 * fake pool, and a cache there would answer the second test from the first.
 * Search results themselves (getListings with filters) are never cached —
 * they must reflect an approval or a price change on the next request.
 */
const TTL_MS = 60_000;

export const cachedPropertyTypeFacets = () => memo('facets', TTL_MS, () => getPropertyTypeFacets());

export const cachedPopularCommunes = (limit = 6) => memo(`communes:${limit}`, TTL_MS, () => getPopularCommunes(limit));

export const cachedPriceRange = () => memo('price-range', TTL_MS, () => getPriceRange());

export const cachedCommuneShowcase = (limit = 6) => memo(`showcase:${limit}`, TTL_MS, () => getCommuneShowcase(limit));

/** The hero button's first-paint count for one transaction type. */
export const cachedListingsTotal = (transactionType) =>
  memo(`total:${transactionType || ''}`, TTL_MS, async () => {
    const { total } = await getListings({ limit: 1, transactionType });
    return { total };
  });

/** "Sélection de la semaine" — the eight newest-by-default-sort public cards. */
export const cachedFeaturedListings = () =>
  memo('featured:8', TTL_MS, async () => {
    const { data, count } = await getListings({ limit: 8 });
    return { data, count };
  });

/** Landing-page link graph, footer and sitemap: counts only, a minute old at most. */
export const cachedSeoFacets = () => memo('seo-facets', TTL_MS, () => getSeoFacets());
