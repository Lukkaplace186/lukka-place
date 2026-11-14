import { NextResponse } from 'next/server';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { publicVille } from '@/lib/publicCities';
import { loadFeedBatch } from '@/lib/listingsFeed';
import { parseFeedCursor } from '@/lib/listingsFeedCursor';
import { landmarkPoint, listingDistanceKm } from '@/lib/landmarks';

/**
 * GET /api/listings/feed?<filters>&cursor=e:12 — the next batch of the
 * endless /listings feed (lib/listingsFeed.js), asked by the browser as the
 * visitor nears the bottom of the list.
 *
 *   → { listings, similar: { listings, places } | null, next }
 *
 * Filters are the exact /listings query params, through the same
 * parseListingsSearchParams the page, the map and the count use, so a batch
 * can never apply a filter differently from the page it extends. Public data
 * behind the same APPROVED_FILTER as every other read.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const cursor = parseFeedCursor(searchParams.get('cursor'));
  if (!cursor) return NextResponse.json({ error: 'invalid-cursor' }, { status: 400 });

  const filters = { ...parseListingsSearchParams(searchParams), sort: searchParams.get('sort') || undefined };
  // Same rule as the page: a city that is not public yet is no city.
  filters.ville = await publicVille(filters.ville);

  try {
    const batch = await loadFeedBatch(filters, cursor);
    // "à 1,2 km de UPN" on each card, from the listing's own point only —
    // the page does the same for the first batch.
    const near = searchParams.get('near');
    const point = landmarkPoint(searchParams.get('commune'), near);
    const withNear = (rows) =>
      point ? rows.map((row) => ({ ...row, near_distance_km: listingDistanceKm(row, point), near_label: near })) : rows;
    return NextResponse.json({
      listings: withNear(batch.listings),
      similar: batch.similar ? { ...batch.similar, listings: withNear(batch.similar.listings) } : null,
      next: batch.next,
    });
  } catch (err) {
    console.error(`[listings-feed] ${err.message}`);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}
