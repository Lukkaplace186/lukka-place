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
  const { total } = await getListings({ ...filters, limit: 1 });
  return NextResponse.json({ total });
}
