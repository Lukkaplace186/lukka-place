import { NextResponse } from 'next/server';
import { getListings, getRecentListingIds } from '@/lib/listings';

/**
 * GET /api/listings/new-since?since=<ms> — "N nouveaux biens depuis votre
 * dernière visite" (components/NewSinceLastVisit.js, 2026-11-03).
 *
 * "New" is the alert sweep's own definition (getRecentListingIds: public, and
 * published — the later of creation and approval — after `since`), and the
 * count goes back through getListings with those ids, so it is exactly what
 * the returned link (/listings?ids=…) will show: same public gate, same
 * default city. `since` is clamped to the last 30 days; nothing personal is
 * sent or stored.
 */
const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LINK_IDS = 48;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const since = Number(searchParams.get('since'));
  const now = Date.now();
  if (!Number.isFinite(since) || since <= 0 || since > now) {
    return NextResponse.json({ error: 'invalid since' }, { status: 400 });
  }
  // Rounded to the minute so nearby visits share a cache entry.
  const from = new Date(Math.floor(Math.max(since, now - MAX_LOOKBACK_MS) / 60000) * 60000);

  const recent = await getRecentListingIds({ since: from, limit: 500 });
  if (recent.length === 0) return NextResponse.json({ count: 0, ids: [] }, { headers: CACHE });

  const { total, data } = await getListings({ ids: recent.map((r) => r.id), sort: 'newest', limit: MAX_LINK_IDS });
  return NextResponse.json({ count: total, ids: (data || []).map((l) => Number(l.id)) }, { headers: CACHE });
}

const CACHE = { 'Cache-Control': 'public, max-age=60, s-maxage=60' };
