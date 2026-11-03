import 'server-only';
import { getPool } from './db';

/**
 * An agent's "firsts" (2026-11-03): when their listings were first seen by a
 * visitor, first got a WhatsApp tap, first got a visit request, and when they
 * first closed a deal. Read for the dashboard's celebration card
 * (components/AgentMilestoneCelebration.js), which celebrates a first only
 * while it is recent — so an agent who passed it long ago is not congratulated
 * today, and nothing here is stored.
 *
 * Real events only: page views and taps counted from visitors (the engagement
 * tracking's `viewer_kind`, NULL on rows from before it existed), visit
 * requests from the stats rollup (the engine's own SQLite counts), deals from
 * a listing actually marked let / sold. Never throws: the card is
 * decoration, and the overview must render without it.
 *
 * @param {number[]} propertyIds the agent's own listing ids
 * @returns {Promise<Array<{key: 'firstView'|'firstTap'|'firstVisit'|'firstDeal', at: string}>>}
 */
export async function getAgentMilestones(propertyIds) {
  const ids = (propertyIds || []).map(Number).filter(Number.isFinite);
  if (ids.length === 0) return [];
  try {
    const { rows } = await getPool().query(
      `SELECT
         (SELECT MIN(created_at) FROM page_views
           WHERE listing_id = ANY($1::bigint[]) AND COALESCE(viewer_kind, 'visitor') = 'visitor') AS first_view_at,
         (SELECT MIN(created_at) FROM whatsapp_clicks
           WHERE listing_id = ANY($1::bigint[]) AND COALESCE(viewer_kind, 'visitor') = 'visitor') AS first_tap_at,
         (SELECT MIN(day) FROM listing_stats_daily
           WHERE listing_id = ANY($1::bigint[]) AND visit_requests > 0) AS first_visit_day,
         (SELECT MIN(COALESCE(sold_at::timestamptz, updated_at)) FROM properties
           WHERE id = ANY($1::bigint[]) AND listing_status = 'closed') AS first_deal_at`,
      [ids],
    );
    const row = rows[0] || {};
    const iso = (value) => {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return [
      { key: 'firstView', at: iso(row.first_view_at) },
      { key: 'firstTap', at: iso(row.first_tap_at) },
      { key: 'firstVisit', at: iso(row.first_visit_day) },
      { key: 'firstDeal', at: iso(row.first_deal_at) },
    ].filter((m) => m.at);
  } catch (err) {
    console.warn(`[agent-milestones] read failed: ${err.message}`);
    return [];
  }
}
