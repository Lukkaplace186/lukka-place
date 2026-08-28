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

/**
 * @param {number[]} propertyIds
 * @param {number} [sinceDays] Restrict to the last N days — the design's stat
 *   strip labels this cell "Vues sur 30 jours", a windowed figure, not the
 *   all-time total. Omit for the all-time count.
 */
export async function getAgentListingViews(propertyIds, sinceDays) {
  if (!propertyIds?.length) return 0;
  const pool = getPool();
  const paths = propertyIds.map((id) => `/listings/${id}`);
  const windowClause = sinceDays ? ` AND created_at > now() - ($2 || ' days')::interval` : '';
  const params = sinceDays ? [paths, String(sinceDays)] : [paths];
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM page_views WHERE path = ANY($1::text[])${windowClause}`,
    params,
  );
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

/**
 * The design's chart carries a real range selector (7 jours / 30 jours /
 * 12 mois), so the series has to be genuinely re-bucketed per range rather
 * than always being 7 daily points. Buckets are chosen so each range reads
 * at a sensible density — daily for a week, weekly for a month, monthly for
 * a year — and every bucket in the window is emitted even when it has no
 * views, so a quiet stretch renders as a real zero bar rather than a gap.
 *
 * @param {number[]} propertyIds
 * @param {'7d'|'30d'|'12m'} [range='7d']
 * @returns {Promise<Array<{key: string, label: string, views: number}>>}
 */
export const VIEW_RANGES = {
  '7d': { label: '7 derniers jours', caption: '7 derniers jours, par jour', unit: 'day', buckets: 7 },
  '30d': { label: '30 derniers jours', caption: '30 derniers jours, par semaine', unit: 'week', buckets: 5 },
  '12m': { label: '12 derniers mois', caption: '12 derniers mois, par mois', unit: 'month', buckets: 12 },
};

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

function bucketStart(date, unit) {
  const d = new Date(date);
  if (unit === 'day') d.setUTCHours(0, 0, 0, 0);
  if (unit === 'week') {
    d.setUTCHours(0, 0, 0, 0);
    // ISO week start (Monday), matching date_trunc('week') in Postgres.
    const weekday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - weekday);
  }
  if (unit === 'month') {
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(1);
  }
  return d;
}

function shiftBuckets(date, unit, amount) {
  const d = new Date(date);
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + amount);
  if (unit === 'week') d.setUTCDate(d.getUTCDate() + amount * 7);
  if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + amount);
  return d;
}

export async function getAgentListingViewsSeries(propertyIds, range = '7d') {
  const { unit, buckets } = VIEW_RANGES[range] || VIEW_RANGES['7d'];

  const now = bucketStart(new Date(), unit);
  const series = Array.from({ length: buckets }, (_, i) => {
    const start = shiftBuckets(now, unit, -(buckets - 1 - i));
    const key = start.toISOString().slice(0, 10);
    let label;
    if (unit === 'day') label = DAY_LABEL.format(start);
    else if (unit === 'month') label = MONTH_LABEL.format(start);
    else label = `S${i + 1}`;
    return { key, label, views: 0 };
  });

  if (!propertyIds?.length) return series;

  const pool = getPool();
  const paths = propertyIds.map((id) => `/listings/${id}`);
  // to_char, not ::date — a Postgres `date` comes back through node-pg as a
  // JS Date at LOCAL midnight, so `toISOString().slice(0,10)` shifts it a day
  // in any timezone west of UTC and the bucket keys silently stop matching
  // the ones built above. That produced a chart reading "pas encore de vues"
  // while the stat card beside it counted 19 over the same window. Comparing
  // strings on both sides removes the round-trip entirely.
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc($2, created_at), 'YYYY-MM-DD') AS bucket, count(*)::int AS total
     FROM page_views
     WHERE path = ANY($1::text[]) AND created_at >= $3::date
     GROUP BY bucket`,
    [paths, unit, series[0].key],
  );
  const byBucket = new Map(rows.map((r) => [r.bucket, r.total]));

  return series.map((b) => ({ ...b, views: byBucket.get(b.key) || 0 }));
}

/**
 * Real month-over-month movement for the dashboard's stat cards — the
 * design puts a delta line under every number, and this is the only honest
 * way to fill it. Returns `null` for any metric whose previous month was
 * zero: a percentage change from nothing is not a real number, and the UI
 * renders nothing at all rather than a fabricated "+100 %". `listings` is a
 * plain count of this agent's own properties created this month (not a
 * percentage) — matching the design's own "+2 ce mois" phrasing.
 *
 * @returns {Promise<{views: number|null, clicks: number|null, listings: number}>}
 */
export async function getAgentMonthlyDeltas(agentId, propertyIds) {
  const pool = getPool();

  const { rows: listingRows } = await pool.query(
    `SELECT count(*)::int AS total FROM properties
     WHERE agent_id = $1 AND created_at >= date_trunc('month', now())`,
    [agentId],
  );
  const listings = listingRows[0].total;

  if (!propertyIds?.length) return { views: null, clicks: null, listings };

  const paths = propertyIds.map((id) => `/listings/${id}`);
  const pctChange = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

  const [{ rows: viewRows }, { rows: clickRows }] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS current,
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month'
                            AND created_at <  date_trunc('month', now()))::int AS previous
       FROM page_views WHERE path = ANY($1::text[])`,
      [paths],
    ),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS current,
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month'
                            AND created_at <  date_trunc('month', now()))::int AS previous
       FROM whatsapp_clicks WHERE listing_id = ANY($1::bigint[])`,
      [propertyIds],
    ),
  ]);

  return {
    views: pctChange(viewRows[0].current, viewRows[0].previous),
    clicks: pctChange(clickRows[0].current, clickRows[0].previous),
    listings,
  };
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
