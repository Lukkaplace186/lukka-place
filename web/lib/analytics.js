import 'server-only';
import { getPool } from './db';

/**
 * Reads against page_views/whatsapp_clicks — new tables this feature
 * introduces (see web/app/api/track/route.js for the write path). No
 * historical data exists before these tables were created; every number
 * here starts at zero and only grows from real traffic. Deliberately not
 * derived from existing listing counts — a "top commune" by listing count
 * is not the same claim as "top commune by page views," and presenting one
 * as the other would be exactly the fabrication web/CLAUDE.md guards
 * against elsewhere in this codebase.
 */

export async function getTotalPageViews() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT count(*)::int AS total FROM page_views');
  return rows[0].total;
}

export async function getTotalWhatsAppClicks() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT count(*)::int AS total FROM whatsapp_clicks');
  return rows[0].total;
}

/** @returns {Promise<Array<{commune: string, views: number}>>} */
export async function getTopCommunesByViews(limit = 10) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT commune, count(*)::int AS views
     FROM page_views
     WHERE commune IS NOT NULL
     GROUP BY commune
     ORDER BY views DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Click-to-WhatsApp rate = whatsapp_clicks / page_views on listing detail
 * pages specifically (path LIKE '/listings/%'), not site-wide traffic —
 * a homepage visit was never a candidate to click a listing's WhatsApp CTA.
 * Returns null (not 0) when there's no view data yet, so the UI can show an
 * honest "pas encore de données" instead of a misleading 0%.
 */
export async function getWhatsAppConversionRate() {
  const pool = getPool();
  const { rows: viewRows } = await pool.query(
    `SELECT count(*)::int AS total FROM page_views WHERE path LIKE '/listings/%'`,
  );
  const listingViews = viewRows[0].total;
  if (listingViews === 0) return null;

  const clicks = await getTotalWhatsAppClicks();
  return clicks / listingViews;
}

// ---------------------------------------------------------------------------
// Agent-scoped (Phase 4D private dashboard) — same tables, filtered to one
// agent's own profile path / listing ids. All start at zero, same as above.
// ---------------------------------------------------------------------------

export async function getAgentProfileViews(agentId) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT count(*)::int AS total FROM page_views WHERE path = $1`, [
    `/agents/${agentId}`,
  ]);
  return rows[0].total;
}

export async function getAgentListingViews(propertyIds) {
  if (!propertyIds?.length) return 0;
  const pool = getPool();
  const paths = propertyIds.map((id) => `/listings/${id}`);
  const { rows } = await pool.query(`SELECT count(*)::int AS total FROM page_views WHERE path = ANY($1::text[])`, [
    paths,
  ]);
  return rows[0].total;
}

export async function getAgentWhatsAppClicks(propertyIds) {
  if (!propertyIds?.length) return 0;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM whatsapp_clicks WHERE listing_id = ANY($1::bigint[])`,
    [propertyIds],
  );
  return rows[0].total;
}

/** customer_favorites — real, already-wired to the live /favoris feature, 0 rows site-wide today. */
export async function getAgentFavoritesCount(propertyIds) {
  if (!propertyIds?.length) return 0;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM customer_favorites WHERE property_id = ANY($1::bigint[])`,
    [propertyIds],
  );
  return rows[0].total;
}

/**
 * Real daily view counts for the agent dashboard's chart (Phase 2.7) — the
 * one place this file groups by date rather than returning a flat total.
 * Always returns a full `days`-length series (today going back `days - 1`
 * days), zero-filled for days with no real views, so the chart never has to
 * invent a shape for missing data — a day with 0 views renders as a real 0
 * bar, not a gap or a fabricated number.
 *
 * @param {number[]} propertyIds
 * @param {number} [days=7]
 * @returns {Promise<Array<{date: string, views: number}>>} `date` is `YYYY-MM-DD`.
 */
export async function getAgentListingViewsByDay(propertyIds, days = 7) {
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (days - 1 - i));
    return { date: date.toISOString().slice(0, 10), views: 0 };
  });

  if (!propertyIds?.length) return series;

  const pool = getPool();
  const paths = propertyIds.map((id) => `/listings/${id}`);
  const { rows } = await pool.query(
    `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS total
     FROM page_views
     WHERE path = ANY($1::text[]) AND created_at > now() - ($2 || ' days')::interval
     GROUP BY day`,
    [paths, days],
  );
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.total]));

  return series.map((d) => ({ ...d, views: byDay.get(d.date) || 0 }));
}

/** Per-listing view/click counts for the performance table — one query each, grouped, not N+1. */
export async function getPerListingStats(propertyIds) {
  if (!propertyIds?.length) return { views: {}, clicks: {} };
  const pool = getPool();

  const { rows: viewRows } = await pool.query(
    `SELECT path, count(*)::int AS total FROM page_views WHERE path = ANY($1::text[]) GROUP BY path`,
    [propertyIds.map((id) => `/listings/${id}`)],
  );
  const views = {};
  for (const row of viewRows) {
    const id = row.path.replace('/listings/', '');
    views[id] = row.total;
  }

  const { rows: clickRows } = await pool.query(
    `SELECT listing_id, count(*)::int AS total FROM whatsapp_clicks WHERE listing_id = ANY($1::bigint[]) GROUP BY listing_id`,
    [propertyIds],
  );
  const clicks = {};
  for (const row of clickRows) {
    clicks[row.listing_id] = row.total;
  }

  return { views, clicks };
}
