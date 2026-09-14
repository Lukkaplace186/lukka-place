import { NextResponse } from 'next/server';
import { getMapExtent, getMapMarkers } from '@/lib/listings';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { parseBounds } from '@/lib/mapViewport';

/**
 * GET /api/listings/map — the /listings map's own read path, decoupled from
 * the list pane's 12-per-page pagination.
 *
 *   ?<filters>&sw_lat=&sw_lng=&ne_lat=&ne_lng=
 *       → { markers, approximate, unlocated, unlocatedIds, truncated }
 *         Every approved listing matching the filters inside the box, as
 *         lightweight markers (lib/listings.js getMapMarkers). The location
 *         filters are replaced by the box; everything else still applies.
 *   ?<filters>&extent=1
 *       → { extent, total }
 *         The box around everything matching, for the map's opening view.
 *
 * Filters are the exact /listings query params, through the same
 * parseListingsSearchParams the page and /api/listings/count use, so the map
 * can never apply a filter differently from the list beside it.
 *
 * Public data behind the same APPROVED_FILTER as every other read, so this is
 * safe to call from the browser.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filters = parseListingsSearchParams(searchParams);

  if (searchParams.get('extent') === '1') {
    return NextResponse.json(await getMapExtent(filters));
  }

  const { bounds, error } = parseBounds(searchParams);
  if (error) return NextResponse.json({ error }, { status: 400 });

  return NextResponse.json(await getMapMarkers(filters, bounds));
}
