import 'server-only';
import { cache } from 'react';
import { getPool } from './db';

/**
 * "12 personnes ont consulté ce bien ces 7 derniers jours" (listing page,
 * 2026-11-04). A real count, shown only when it is worth saying.
 *
 * PEOPLE, not page loads: distinct `visitor_id` over the last 7 days, and
 * only rows whose viewer was a visitor — never the listing's own agent, other
 * agents, the team, bots or prefetches (viewer_kind, lib/trackIngest.js). A
 * row with no visitor id (storage refused) is a view but not a person, so it
 * is not counted. Rows from before viewer_kind existed count as visitors
 * unless their device says bot — the same rule lib/analytics.js's dashboard
 * uses for "people".
 *
 * Shown from 1 person, as counted (owner's decision, 2026-11-04: "leave the
 * numbers as they are" — a first version hid anything under 5). Zero renders
 * nothing: "0 personne" is not something worth printing on a listing.
 */

export const INTEREST_WINDOW_DAYS = 7;
export const MIN_INTEREST_SHOWN = 1;

export const LISTING_VIEWERS_SQL = `
  SELECT COUNT(DISTINCT visitor_id)::int AS people
  FROM page_views
  WHERE listing_id = $1
    AND created_at >= NOW() - INTERVAL '${INTEREST_WINDOW_DAYS} days'
    AND visitor_id IS NOT NULL
    AND COALESCE(viewer_kind, 'visitor') = 'visitor'
    AND COALESCE(device, '') <> 'bot'`;

/** The count to show, or null (too few, unknown id, or the query failed). */
export function interestToShow(people) {
  const n = Number(people);
  return Number.isInteger(n) && n >= MIN_INTEREST_SHOWN ? n : null;
}

/**
 * Never throws: a missing column (before migrations/20260929_engagement_tracking.sql,
 * 42703) or any other failure renders nothing rather than breaking the page.
 */
export const getRecentListingViewers = cache(async (listingId) => {
  const id = Number(listingId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const { rows } = await getPool().query(LISTING_VIEWERS_SQL, [id]);
    return interestToShow(rows[0]?.people);
  } catch (err) {
    console.error(`[listing-interest] #${id}: ${err.message}`);
    return null;
  }
});
