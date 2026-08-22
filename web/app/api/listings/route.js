import { NextResponse } from 'next/server';
import { getListingsByIds } from '@/lib/listings';

/**
 * GET /api/listings?ids=1,2,3 — the only client-reachable read path into
 * `properties`, used by the local-only /favoris page (see lib/favorites.js)
 * to turn browser-stored favorite ids back into real listing data. Reuses
 * getListingsByIds, which applies the same status=1/approve_status=1 filter
 * as every other read — a favorited listing that's since been unpublished
 * just drops out, never partially exposed.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ids = (searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const data = await getListingsByIds(ids);
  return NextResponse.json({ data });
}
