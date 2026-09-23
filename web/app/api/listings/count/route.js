import { NextResponse } from 'next/server';
import { getListings } from '@/lib/listings';
import { parseListingsSearchParams } from '@/lib/searchQuery';

/**
 * GET /api/listings/count?transaction_type=...&price_min=... — backs the
 * live "Voir N biens" count on FilterBar's Prix popover and the "Plus de
 * filtres" drawer (FilterBar.js/FiltersDrawer.js), so those CTAs reflect
 * the real result count for the filters currently staged, not just a
 * generic "Appliquer"/"Voir les résultats" label.
 *
 * Reuses parseListingsSearchParams (same mapping /listings' own page.js
 * uses) and getListings() — same query, same APPROVED_FILTER, no second
 * count implementation. `limit: 1` keeps the row payload minimal; the COUNT
 * query getListings() runs internally is unaffected by limit.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const filters = parseListingsSearchParams(searchParams);
  // allowRelax, like the page itself: `total` stays the EXACT count, and
  // `suggested` says how many alternatives the page would show instead when
  // that is zero (lib/listings.js relaxSearch). The hero button can then say
  // "12 suggestions" rather than a flat "0 bien" for a search that will
  // land on real, labelled results.
  const { total, relaxation } = await getListings({ ...filters, limit: 1, allowRelax: true });
  if (relaxation) return NextResponse.json({ total: 0, suggested: total });
  return NextResponse.json({ total, suggested: 0 });
}
