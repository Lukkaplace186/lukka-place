import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getListings, getRecentListingIds } from '@/lib/listings';
import { countInstantMatchesToday, getAppCustomerSearches, getNotifiedPropertyIds, recordNotifiedProperties } from '@/lib/searchAlerts';
import { pushToAccount } from '@/lib/adminApi';
import { INSTANT_LOOKBACK_MINUTES, runInstantMatchSweep } from '@/lib/instantMatchSweep';
import { runFollowedAgentListings } from '@/lib/portalDigests';

/**
 * C1 — instant matches for customers with the Lukka Place app
 * (lib/instantMatchSweep.js). Called by the engine's scheduler (job
 * `instant-alerts`, every 10 minutes). Secret-protected like
 * /api/cron/search-alerts; nothing else should call it.
 */
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await runInstantMatchSweep({
    deps: {
      getRecentListings: getRecentListingIds,
      getAppSearches: () => getAppCustomerSearches(),
      getListings,
      getNotified: getNotifiedPropertyIds,
      countToday: countInstantMatchesToday,
      push: pushToAccount,
      recordNotified: recordNotifiedProperties,
    },
  });
  for (const { savedSearchId, error } of result.errors) {
    console.error(`[instant-alerts] saved search #${savedSearchId} failed: ${error}`);
  }
  // C4: new listings from agencies the customer follows.
  let followed = null;
  try {
    const recent = await getRecentListingIds({ since: new Date(Date.now() - INSTANT_LOOKBACK_MINUTES * 60 * 1000) });
    followed = await runFollowedAgentListings({ recentIds: recent.map((l) => l.id), push: pushToAccount });
  } catch (err) {
    console.error(`[instant-alerts] followed agencies failed: ${err.message}`);
    followed = { error: err.message };
  }
  return NextResponse.json({ ok: true, ...result, followed });
}
