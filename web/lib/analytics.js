import 'server-only';
import { cache } from 'react';
import { getPool } from './db';

/**
 * listing_stats_daily (engine: services/listingStatsRollup.js) is used for the
 * agent-scoped reads below ONLY when it exists and was refreshed recently.
 * Otherwise every function reads the raw event tables exactly as it always
 * did. So: before the migration runs, or while the engine's job is down, a
 * dashboard is slower — never wrong, and never an error.
 *
 * Memoised per request: one dashboard render asks up to four questions and
 * should pay for the freshness probe once.
 */
export const ROLLUP_MAX_AGE_MINUTES = 30;

export const isRollupFresh = cache(async function isRollupFresh() {
  try {
    const { rows } = await getPool().query(
      `SELECT (max(refreshed_at) > now() - ($1 || ' minutes')::interval) AS fresh FROM listing_stats_daily`,
      [String(ROLLUP_MAX_AGE_MINUTES)],
    );
    return rows[0]?.fresh === true;
  } catch (err) {
    // 42P01 undefined_table: migrations/20260917_agent_dashboard_scale.sql has
    // not been applied yet. Expected during rollout, so not logged.
    if (err?.code !== '42P01') console.error(`[analytics] rollup freshness probe failed: ${err.message}`);
    return false;
  }
});

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

export async function getTotalPageViews({ sinceDays = null } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM page_views
     WHERE $1::int IS NULL OR created_at >= NOW() - make_interval(days => $1::int)`,
    [sinceDays],
  );
  return rows[0].total;
}

export async function getTotalWhatsAppClicks() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT count(*)::int AS total FROM whatsapp_clicks');
  return rows[0].total;
}

/** @returns {Promise<Array<{commune: string, views: number}>>} */
export async function getTopCommunesByViews(limit = 10, { sinceDays = null } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT commune, count(*)::int AS views
     FROM page_views
     WHERE commune IS NOT NULL
       AND ($2::int IS NULL OR created_at >= NOW() - make_interval(days => $2::int))
     GROUP BY commune
     ORDER BY views DESC
     LIMIT $1`,
    [limit, sinceDays],
  );
  return rows;
}

/**
 * Click-to-WhatsApp rate = whatsapp_clicks / page_views on listing detail
 * pages specifically (path LIKE '/listings/%'), not site-wide traffic —
 * a homepage visit was never a candidate to click a listing's WhatsApp CTA.
 * Returns null (not 0) when there's no view data yet, so the UI can show an
 * honest "pas encore de données" instead of a misleading 0%.
 *
 * People on both sides (peopleSql): a crawler's view and the team's own taps
 * used to sit in the denominator and the numerator respectively.
 */
export async function getWhatsAppConversionRate({ sinceDays = null } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM page_views v
        WHERE v.path LIKE '/listings/%' AND ${peopleSql('v')}
          AND ($1::int IS NULL OR v.created_at >= NOW() - make_interval(days => $1::int))) AS views,
       (SELECT count(*)::int FROM whatsapp_clicks w
        WHERE ${peopleSql('w')}
          AND ($1::int IS NULL OR w.created_at >= NOW() - make_interval(days => $1::int))) AS clicks`,
    [sinceDays],
  );
  const { views, clicks } = rows[0];
  if (views === 0) return null;
  return clicks / views;
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
  if (await isRollupFresh()) {
    const { rows } = await pool.query(
      `SELECT COALESCE(sum(whatsapp_clicks), 0)::int AS total FROM listing_stats_daily WHERE listing_id = ANY($1::bigint[])`,
      [propertyIds],
    );
    return rows[0].total;
  }
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
// '30d' is 30 DAILY bars (2026-10-05). It was five ISO weeks, which reach back
// 29 to 35 days depending on the weekday, so the bars never added up to the
// "Vues · 30 jours" figure above them (183 drawn under a headline of 198).
// Thirty whole UTC days is exactly getAgentWindowStats' window.
export const VIEW_RANGES = {
  '7d': { label: '7 derniers jours', caption: '7 derniers jours, par jour', unit: 'day', buckets: 7 },
  '30d': { label: '30 derniers jours', caption: '30 derniers jours, par jour', unit: 'day', buckets: 30 },
  '12m': { label: '12 derniers mois', caption: '12 derniers mois, par mois', unit: 'month', buckets: 12 },
};

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
// The bar's own date, for its tooltip and the axis ends of a dense chart.
const DAY_FULL_LABEL = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_FULL_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

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
    let fullLabel;
    if (unit === 'day') {
      label = DAY_LABEL.format(start);
      fullLabel = DAY_FULL_LABEL.format(start);
    } else if (unit === 'month') {
      label = MONTH_LABEL.format(start);
      fullLabel = MONTH_FULL_LABEL.format(start);
    } else {
      label = `S${i + 1}`;
      fullLabel = label;
    }
    return { key, label, fullLabel, views: 0 };
  });

  if (!propertyIds?.length) return series;

  const pool = getPool();

  // The rollup is day-grained on UTC days, and every bucket here (day, ISO
  // week, month) is a whole number of UTC days — so it answers every range
  // exactly, not approximately. date_trunc('week') on a timestamp starts on
  // Monday, the same as the raw query below.
  if (await isRollupFresh()) {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc($2, day::timestamp), 'YYYY-MM-DD') AS bucket, sum(views)::int AS total
       FROM listing_stats_daily
       WHERE listing_id = ANY($1::bigint[]) AND day >= $3::date
       GROUP BY bucket`,
      [propertyIds, unit, series[0].key],
    );
    const byBucket = new Map(rows.map((r) => [r.bucket, r.total]));
    return series.map((b) => ({ ...b, views: byBucket.get(b.key) || 0 }));
  }

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
 * The first UTC day (`YYYY-MM-DD`) of a window of `days` whole UTC days that
 * ends today. getAgentWindowStats and the chart's '30d' series both start
 * here, which is what makes the bars add up to the headline figure.
 */
export function windowStartKey(days, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Percentage change, or null when there is nothing honest to show: no
 * previous figure (a change from zero is not a number) or an unreadable one.
 */
export function trendPercent(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * The overview's figures, each over the same window: the last `days` whole
 * UTC days, compared with the `days` before them.
 *
 * Replaced getAgentMonthlyDeltas (2026-10-05), which compared the month so far
 * with the whole previous month: on the 5th of a month that is five days
 * against thirty, so a normal week read "−100 %". The views and clicks figures
 * also came from different windows than their trends (a rolling 720 hours, and
 * clicks were ALL-TIME under a "30 jours" label).
 *
 * `newListings` counts this agent's listings created in the window.
 *
 * @returns {Promise<{start: string, views: number, viewsPrev: number, clicks: number, clicksPrev: number, newListings: number}>}
 */
export async function getAgentWindowStats({ agentId, propertyIds, days = 30 }) {
  const start = windowStartKey(days);
  const prevStart = windowStartKey(days * 2);
  const pool = getPool();

  const listingsQuery = Number.isFinite(Number(agentId))
    ? pool.query(
        `SELECT count(*)::int AS total FROM properties WHERE agent_id = $1 AND created_at >= $2::date`,
        [agentId, start],
      )
    : Promise.resolve({ rows: [{ total: 0 }] });

  if (!propertyIds?.length) {
    const { rows } = await listingsQuery;
    return { start, views: 0, viewsPrev: 0, clicks: 0, clicksPrev: 0, newListings: rows[0]?.total ?? 0 };
  }

  if (await isRollupFresh()) {
    const [{ rows }, { rows: listingRows }] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE(sum(views) FILTER (WHERE day >= $2::date), 0)::int AS views,
           COALESCE(sum(views) FILTER (WHERE day < $2::date), 0)::int AS views_prev,
           COALESCE(sum(whatsapp_clicks) FILTER (WHERE day >= $2::date), 0)::int AS clicks,
           COALESCE(sum(whatsapp_clicks) FILTER (WHERE day < $2::date), 0)::int AS clicks_prev
         FROM listing_stats_daily
         WHERE listing_id = ANY($1::bigint[]) AND day >= $3::date`,
        [propertyIds, start, prevStart],
      ),
      listingsQuery,
    ]);
    const r = rows[0] || {};
    return {
      start,
      views: r.views ?? 0,
      viewsPrev: r.views_prev ?? 0,
      clicks: r.clicks ?? 0,
      clicksPrev: r.clicks_prev ?? 0,
      newListings: listingRows[0]?.total ?? 0,
    };
  }

  const paths = propertyIds.map((id) => `/listings/${id}`);
  const [{ rows: viewRows }, { rows: clickRows }, { rows: listingRows }] = await Promise.all([
    pool.query(
      `SELECT
         count(*) FILTER (WHERE created_at >= $2::date)::int AS current,
         count(*) FILTER (WHERE created_at < $2::date)::int AS previous
       FROM page_views WHERE path = ANY($1::text[]) AND created_at >= $3::date`,
      [paths, start, prevStart],
    ),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE created_at >= $2::date)::int AS current,
         count(*) FILTER (WHERE created_at < $2::date)::int AS previous
       FROM whatsapp_clicks WHERE listing_id = ANY($1::bigint[]) AND created_at >= $3::date`,
      [propertyIds, start, prevStart],
    ),
    listingsQuery,
  ]);

  return {
    start,
    views: viewRows[0].current,
    viewsPrev: viewRows[0].previous,
    clicks: clickRows[0].current,
    clicksPrev: clickRows[0].previous,
    newListings: listingRows[0]?.total ?? 0,
  };
}

/** Per-listing view/click counts for the performance table — one query each, grouped, not N+1. */
export async function getPerListingStats(propertyIds) {
  if (!propertyIds?.length) return { views: {}, clicks: {} };
  const pool = getPool();

  // All-time totals are the query that grows without bound on raw tables —
  // every event a listing ever drew. On the rollup it is at most one row per
  // listing per day it had any traffic.
  if (await isRollupFresh()) {
    const { rows } = await pool.query(
      `SELECT listing_id, sum(views)::int AS views, sum(whatsapp_clicks)::int AS clicks
       FROM listing_stats_daily WHERE listing_id = ANY($1::bigint[]) GROUP BY listing_id`,
      [propertyIds],
    );
    const views = {};
    const clicks = {};
    for (const row of rows) {
      views[row.listing_id] = row.views;
      clicks[row.listing_id] = row.clicks;
    }
    return { views, clicks };
  }

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

/**
 * Traffic split by device — the "web or mobile?" question the dashboard
 * could not answer before web/scripts/setup-analytics-dimensions.js added
 * the column.
 *
 * Rows written before that migration have `device IS NULL` and are reported
 * as 'inconnu' rather than folded into a real bucket: they genuinely predate
 * the measurement, and quietly counting them as desktop would overstate the
 * one number this exists to get right.
 *
 * Bots are a real bucket, not filtered out here — the caller decides whether
 * to show them. They matter for reading the totals honestly, since crawler
 * traffic is not audience.
 *
 * @returns {Promise<Array<{device: string, views: number}>>}
 */
export async function getViewsByDevice({ sinceDays } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COALESCE(device, 'inconnu') AS device, count(*)::int AS views
     FROM page_views
     WHERE $1::int IS NULL OR created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY 1
     ORDER BY views DESC`,
    [sinceDays ?? null],
  );
  return rows;
}

/**
 * Where visitors came from — a utm_source campaign label when one was
 * present, otherwise the referrer's bare host, otherwise 'direct'.
 * Self-referrals are recorded as 'direct' at write time (lib/requestContext.js),
 * so internal navigation never appears here as a source.
 *
 * @returns {Promise<Array<{source: string, views: number}>>}
 */
export async function getViewsBySource({ sinceDays, limit = 10 } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COALESCE(source, 'inconnu') AS source, count(*)::int AS views
     FROM page_views
     WHERE $1::int IS NULL OR created_at >= NOW() - ($1 || ' days')::interval
     GROUP BY 1
     ORDER BY views DESC
     LIMIT $2`,
    [sinceDays ?? null, limit],
  );
  return rows;
}

/**
 * WhatsApp conversion split by device — which device actually produces
 * enquiries, not just views. This is the pair of numbers that answers
 * "should we invest in the mobile experience?", which neither figure alone
 * does: mobile can dominate views and still convert worse.
 *
 * @returns {Promise<Array<{device: string, views: number, clicks: number, rate: number|null}>>}
 */
export async function getConversionByDevice({ sinceDays } = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH v AS (
       SELECT COALESCE(device, 'inconnu') AS device, count(*)::int AS views
       FROM page_views
       WHERE $1::int IS NULL OR created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY 1
     ), c AS (
       SELECT COALESCE(device, 'inconnu') AS device, count(*)::int AS clicks
       FROM whatsapp_clicks
       WHERE $1::int IS NULL OR created_at >= NOW() - ($1 || ' days')::interval
       GROUP BY 1
     )
     SELECT COALESCE(v.device, c.device) AS device,
            COALESCE(v.views, 0) AS views,
            COALESCE(c.clicks, 0) AS clicks
     FROM v FULL OUTER JOIN c ON c.device = v.device
     ORDER BY views DESC`,
    [sinceDays ?? null],
  );
  // Rate computed here, not in SQL: a device with zero views has no rate at
  // all, and 0 would read as "nobody converts" rather than "nobody visited".
  return rows.map((r) => ({ ...r, rate: r.views > 0 ? r.clicks / r.views : null }));
}

// ---------------------------------------------------------------------------
// WhatsApp clicks, split — the admin dashboard's "Clics WhatsApp — détail".
//
// Headline figures count PEOPLE only. Every tap is stored with its viewer_kind
// (lib/trackIngest.js): the team, an agent on their own listing, bots and
// link-preview fetches included. Counting those as audience is the first
// thing an investor would discount, so they are shown as their own bucket
// (the "Audience" split) and left out of every other split.
//
// viewer_kind, visitor_id and routing_type are read through to_jsonb(row), the
// listing reads' posture: before their migrations the columns do not exist and
// every row counts as a person, never a 42703. A row older than viewer_kind
// ('avant_suivi') counts as a person unless its device says bot.
// ---------------------------------------------------------------------------

const CLICK_CONTENT_LANGUAGE_ID = 20;
const CLICK_CATEGORY_LANGUAGE_ID = 26;

/** Periods offered on the dashboard. `null` days = since tracking began. */
export const CLICK_PERIODS = [
  { key: '7', days: 7 },
  { key: '30', days: 30 },
  { key: '90', days: 90 },
  { key: 'tout', days: null },
];
export const DEFAULT_CLICK_PERIOD = '30';

/** `?periode=` → one of CLICK_PERIODS (anything else → the default). */
export function parseClickPeriod(value) {
  const key = Array.isArray(value) ? value[0] : value;
  return CLICK_PERIODS.find((p) => p.key === key) || CLICK_PERIODS.find((p) => p.key === DEFAULT_CLICK_PERIOD);
}

/**
 * A row of an event table counts as a person: a visitor (or pre-tracking),
 * not a crawler, and not referred by `localhost` — a local dev server writes
 * to the production database, and its testing is not audience.
 */
export function peopleSql(alias) {
  return `(COALESCE(to_jsonb(${alias}) ->> 'viewer_kind', 'visitor') = 'visitor' AND COALESCE(${alias}.device, '') <> 'bot' AND COALESCE(${alias}.source, '') <> 'localhost')`;
}

/** `$1` = days, or NULL for all time. */
function periodSql(alias) {
  return `($1::int IS NULL OR ${alias}.created_at >= NOW() - make_interval(days => $1::int))`;
}

/**
 * Every click in the period with its audience bucket, routing and visitor id.
 * `kind` is 'avant_suivi' for a row older than viewer_kind, 'bot' for any row
 * whose device is a crawler, and 'staff' for one referred by localhost (local
 * testing against the production database).
 */
export const CLICK_BASE_CTE = `
  WITH c AS (
    SELECT w.listing_id, w.commune, w.source, w.price, w.created_at,
           CASE WHEN COALESCE(w.device, '') = 'bot' THEN 'bot'
                WHEN COALESCE(w.source, '') = 'localhost' THEN 'staff'
                ELSE COALESCE(to_jsonb(w) ->> 'viewer_kind', 'avant_suivi') END AS kind,
           to_jsonb(w) ->> 'routing_type' AS routing,
           to_jsonb(w) ->> 'placement' AS placement,
           to_jsonb(w) ->> 'visitor_id' AS visitor
    FROM whatsapp_clicks w
    WHERE ${periodSql('w')}
  )`;

/** The CLICK_BASE_CTE buckets counted as people. */
export const PEOPLE_KINDS_SQL = `c.kind IN ('visitor', 'avant_suivi')`;

/**
 * @param {{ sinceDays?: number|null }} opts
 * @returns {Promise<{ all: number, people: number, excluded: number,
 *   uniqueVisitors: number|null, previous: number|null }>}
 *   `uniqueVisitors` is null when no person's click in the period carries a
 *   visitor id (all of them predate 2026-09-29); `previous` is the people
 *   count of the same-length window before, null for "since the start".
 */
export async function getWhatsAppClickTotals({ sinceDays = null } = {}) {
  const pool = getPool();
  const current = pool.query(
    `${CLICK_BASE_CTE}
     SELECT count(*)::int AS all_clicks,
            count(*) FILTER (WHERE ${PEOPLE_KINDS_SQL})::int AS people,
            count(DISTINCT c.visitor) FILTER (WHERE ${PEOPLE_KINDS_SQL})::int AS unique_visitors,
            count(*) FILTER (WHERE ${PEOPLE_KINDS_SQL} AND c.visitor IS NOT NULL)::int AS identified
     FROM c`,
    [sinceDays],
  );
  const previous = sinceDays
    ? pool.query(
        `SELECT count(*)::int AS people FROM whatsapp_clicks w
         WHERE ${peopleSql('w')}
           AND w.created_at >= NOW() - make_interval(days => $1::int * 2)
           AND w.created_at < NOW() - make_interval(days => $1::int)`,
        [sinceDays],
      )
    : null;
  const [{ rows }, prev] = await Promise.all([current, previous]);
  const row = rows[0] || {};
  const all = row.all_clicks ?? 0;
  const people = row.people ?? 0;
  return {
    all,
    people,
    excluded: all - people,
    uniqueVisitors: row.identified > 0 ? row.unique_visitors : null,
    previous: prev ? (prev.rows[0]?.people ?? 0) : null,
  };
}

/** Price bands, in display order. Rent is per month (a yearly rent ÷ 12). USD only. */
export const PRICE_BANDS = [
  'rent_lt300', 'rent_300_600', 'rent_600_1000', 'rent_1000_2000', 'rent_gte2000', 'rent_short',
  'sale_lt25k', 'sale_25_50k', 'sale_50_100k', 'sale_100_250k', 'sale_gte250k',
  'unknown',
];

const MONTHLY_RENT = `(CASE WHEN p.price_period = 'an' THEN c.price / 12 ELSE c.price END)`;

const PRICE_BAND_SQL = `
  CASE
    WHEN p.id IS NULL OR c.price IS NULL OR c.price <= 0
         OR UPPER(COALESCE(p.currency, 'USD')) <> 'USD' THEN 'unknown'
    WHEN p.purpose = 'sale' THEN
      CASE WHEN c.price < 25000 THEN 'sale_lt25k'
           WHEN c.price < 50000 THEN 'sale_25_50k'
           WHEN c.price < 100000 THEN 'sale_50_100k'
           WHEN c.price < 250000 THEN 'sale_100_250k'
           ELSE 'sale_gte250k' END
    WHEN p.price_period IN ('jour', 'semaine') THEN 'rent_short'
    WHEN ${MONTHLY_RENT} < 300 THEN 'rent_lt300'
    WHEN ${MONTHLY_RENT} < 600 THEN 'rent_300_600'
    WHEN ${MONTHLY_RENT} < 1000 THEN 'rent_600_1000'
    WHEN ${MONTHLY_RENT} < 2000 THEN 'rent_1000_2000'
    ELSE 'rent_gte2000'
  END`;

const COUNT_COLUMNS = `count(*)::int AS clicks, count(DISTINCT c.visitor)::int AS people`;

/** Listing views in the same period, people only, for a per-listing conversion. */
const LISTING_VIEWS_SQL = `
  (SELECT count(*)::int FROM page_views v
   WHERE v.path = '/listings/' || c.listing_id::text
     AND ${periodSql('v')} AND ${peopleSql('v')})`;

/**
 * Every split of the period's clicks. Each row is `{ key, clicks, people }`
 * (`people` = distinct visitor ids, 0 before 2026-09-29). Every split except
 * `audience` counts people only.
 *
 * @param {{ sinceDays?: number|null, limit?: number }} opts
 */
export async function getWhatsAppClickBreakdown({ sinceDays = null, limit = 10 } = {}) {
  const pool = getPool();
  const q = (sql, extra = []) => pool.query(`${CLICK_BASE_CTE} ${sql}`, [sinceDays, ...extra]).then((r) => r.rows);

  const [audience, routing, placement, source, commune, propertyType, priceBand, topListings, weekly] = await Promise.all([
    q(`SELECT c.kind AS key, ${COUNT_COLUMNS} FROM c GROUP BY 1 ORDER BY clicks DESC`),
    q(`SELECT COALESCE(c.routing, 'inconnu') AS key, ${COUNT_COLUMNS}
       FROM c WHERE ${PEOPLE_KINDS_SQL} GROUP BY 1 ORDER BY clicks DESC`),
    q(`SELECT COALESCE(c.placement, 'inconnu') AS key, ${COUNT_COLUMNS}
       FROM c WHERE ${PEOPLE_KINDS_SQL} GROUP BY 1 ORDER BY clicks DESC`),
    q(`SELECT COALESCE(c.source, 'inconnu') AS key, ${COUNT_COLUMNS}
       FROM c WHERE ${PEOPLE_KINDS_SQL} GROUP BY 1 ORDER BY clicks DESC LIMIT $2`, [limit]),
    q(`SELECT COALESCE(NULLIF(c.commune, ''), 'inconnu') AS key, ${COUNT_COLUMNS}
       FROM c WHERE ${PEOPLE_KINDS_SQL} GROUP BY 1 ORDER BY clicks DESC LIMIT $2`, [limit]),
    q(`SELECT COALESCE(catc.name, 'inconnu') AS key, COALESCE(p.purpose, 'inconnu') AS purpose, ${COUNT_COLUMNS}
       FROM c
       LEFT JOIN properties p ON p.id = c.listing_id
       LEFT JOIN property_category_contents catc
         ON catc.category_id = p.category_id AND catc.language_id = ${CLICK_CATEGORY_LANGUAGE_ID}
       WHERE ${PEOPLE_KINDS_SQL}
       GROUP BY 1, 2 ORDER BY clicks DESC LIMIT $2`, [limit]),
    q(`SELECT ${PRICE_BAND_SQL} AS key, ${COUNT_COLUMNS}
       FROM c LEFT JOIN properties p ON p.id = c.listing_id
       WHERE ${PEOPLE_KINDS_SQL} GROUP BY 1`),
    q(`SELECT c.listing_id AS key, max(pc.title) AS title, max(c.commune) AS commune,
              ${COUNT_COLUMNS}, max(${LISTING_VIEWS_SQL}) AS views
       FROM c
       LEFT JOIN property_contents pc
         ON pc.property_id = c.listing_id AND pc.language_id = ${CLICK_CONTENT_LANGUAGE_ID}
       WHERE ${PEOPLE_KINDS_SQL} AND c.listing_id IS NOT NULL
       GROUP BY c.listing_id ORDER BY clicks DESC LIMIT $2`, [limit]),
    getWeeklyWhatsAppClicks(),
  ]);

  const bandIndex = (key) => PRICE_BANDS.indexOf(key);
  return {
    audience,
    routing,
    placement,
    source,
    commune,
    propertyType,
    priceBand: [...priceBand].sort((a, b) => bandIndex(a.key) - bandIndex(b.key)),
    topListings: topListings.map((r) => ({ ...r, rate: r.views > 0 ? r.clicks / r.views : null })),
    weekly,
  };
}

/**
 * People's clicks for each of the last `weeks` weeks (Monday-starting, UTC),
 * the current week last, empty weeks as 0. Independent of the period picker:
 * a trend needs its own window.
 *
 * @returns {Promise<Array<{ week: string, clicks: number }>>} week = 'YYYY-MM-DD'
 */
export async function getWeeklyWhatsAppClicks({ weeks = 12 } = {}) {
  const { rows } = await getPool().query(
    `WITH w AS (
       SELECT generate_series(
         date_trunc('week', NOW()) - make_interval(weeks => $1::int - 1),
         date_trunc('week', NOW()),
         interval '1 week'
       ) AS week
     )
     SELECT to_char(w.week, 'YYYY-MM-DD') AS week, count(x.created_at)::int AS clicks
     FROM w
     LEFT JOIN whatsapp_clicks x
       ON date_trunc('week', x.created_at) = w.week AND ${peopleSql('x')}
     GROUP BY w.week ORDER BY w.week`,
    [weeks],
  );
  return rows;
}
