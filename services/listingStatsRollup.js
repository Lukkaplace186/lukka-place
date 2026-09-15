'use strict';

/**
 * listing_stats_daily — one row per listing per UTC day (views, WhatsApp
 * taps, saves), so the agent dashboard's trend chart, month-over-month deltas
 * and per-listing totals read a few hundred rollup rows instead of scanning
 * page_views / whatsapp_clicks / listing_events for every page load.
 *
 * Schema: migrations/20260917_agent_dashboard_scale.sql.
 *
 * WHY THE ENGINE RUNS IT
 * Same reason the weekly search-alert sweep lives here (root CLAUDE.md,
 * "Scheduled Jobs"): this is the only always-on, single-instance process, and
 * it already holds a Postgres pool (services/postgres.js).
 *
 * WHY A RECOUNT, NOT AN INCREMENT
 * Every run recounts whole days, from the day before the newest rolled-up day
 * up to now, and overwrites them. A re-run, a missed tick, an engine that was
 * down for a week, or an event that arrived late can therefore never
 * double-count — the next run just rewrites those days with the true totals.
 * The first run on an empty table covers all history, which IS the backfill.
 *
 * WHAT THE READER DOES WITH IT
 * web/lib/analytics.js uses the rollup only when it exists and was refreshed
 * within ROLLUP_MAX_AGE (30 min); otherwise it reads the raw tables exactly as
 * before. So this job being late makes a dashboard slower, never wrong.
 */

const postgres = require('./postgres');

const LISTING_STATS_ROLLUP_JOB = 'listing-stats-rollup';
const ROLLUP_INTERVAL_MS = 10 * 60 * 1000;

// `/listings/<id>` exactly — a query string or a slug never reaches page_views
// (the tracker posts the pathname), and anything else is not a listing view.
// 1..18 digits so the ::bigint cast can never overflow on a junk path.
const LISTING_PATH_PATTERN = '^/listings/[0-9]{1,18}$';

/**
 * $1 = the first UTC day to recount (a DATE). The window lower bound is that
 * day's UTC midnight, stated explicitly rather than left to the session's
 * TimeZone setting, which is what a bare `created_at >= $1::date` would use.
 *
 * `JOIN properties` drops events for listings that no longer exist — the FK
 * would otherwise reject the whole statement over one deleted listing.
 */
const ROLLUP_SQL = `
  WITH bounds AS (
    SELECT ($1::date)::timestamp AT TIME ZONE 'UTC' AS since
  ),
  views AS (
    SELECT substring(pv.path FROM 11)::bigint AS listing_id,
           (pv.created_at AT TIME ZONE 'UTC')::date AS day,
           count(*)::int AS n
      FROM page_views pv, bounds
     WHERE pv.created_at >= bounds.since
       AND pv.path ~ '${LISTING_PATH_PATTERN}'
     GROUP BY 1, 2
  ),
  clicks AS (
    SELECT wc.listing_id, (wc.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
      FROM whatsapp_clicks wc, bounds
     WHERE wc.created_at >= bounds.since AND wc.listing_id IS NOT NULL
     GROUP BY 1, 2
  ),
  saves AS (
    SELECT le.listing_id, (le.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n
      FROM listing_events le, bounds
     WHERE le.created_at >= bounds.since AND le.event = 'listing_saved'
     GROUP BY 1, 2
  ),
  keys AS (
    SELECT listing_id, day FROM views
    UNION SELECT listing_id, day FROM clicks
    UNION SELECT listing_id, day FROM saves
  )
  INSERT INTO listing_stats_daily (listing_id, day, views, whatsapp_clicks, saves, refreshed_at)
  SELECT k.listing_id, k.day, COALESCE(v.n, 0), COALESCE(c.n, 0), COALESCE(s.n, 0), NOW()
    FROM keys k
    JOIN properties p ON p.id = k.listing_id
    LEFT JOIN views  v ON v.listing_id = k.listing_id AND v.day = k.day
    LEFT JOIN clicks c ON c.listing_id = k.listing_id AND c.day = k.day
    LEFT JOIN saves  s ON s.listing_id = k.listing_id AND s.day = k.day
  ON CONFLICT (listing_id, day) DO UPDATE
     SET views = EXCLUDED.views,
         whatsapp_clicks = EXCLUDED.whatsapp_clicks,
         saves = EXCLUDED.saves,
         refreshed_at = NOW()
`;

/**
 * The day before the newest rolled-up day — one day of overlap, so events
 * written just after the previous run's snapshot on a day boundary are
 * recounted. An empty table starts at the epoch: that is the backfill.
 */
const WINDOW_START_SQL = `
  SELECT to_char(COALESCE(max(day) - 1, DATE '1970-01-01'), 'YYYY-MM-DD') AS since
    FROM listing_stats_daily
`;

async function runListingStatsRollup({ pool = postgres.getPool() } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // A rollup that has to scan a large backlog must not hold a connection
    // forever; one that times out simply retries on the next tick, and the
    // dashboard reads raw tables meanwhile.
    await client.query("SET LOCAL statement_timeout = '120s'");
    const { rows } = await client.query(WINDOW_START_SQL);
    const since = rows[0]?.since || '1970-01-01';
    const result = await client.query(ROLLUP_SQL, [since]);
    await client.query('COMMIT');
    return { since, rows: result.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let lastRunAt = 0;

const listingStatsRollupJob = {
  name: LISTING_STATS_ROLLUP_JOB,
  shouldRun: (now = new Date()) =>
    postgres.isConfigured() && now.getTime() - lastRunAt >= ROLLUP_INTERVAL_MS,
  run: async () => {
    // Stamped before the work, like opsAlerts: a failing run retries on the
    // next interval, not on every one-minute tick.
    lastRunAt = Date.now();
    const result = await runListingStatsRollup();
    console.log(`[scheduler] ${LISTING_STATS_ROLLUP_JOB} done — ${result.rows} jour(s)×bien(s) depuis ${result.since}`);
    return result;
  },
};

module.exports = {
  LISTING_STATS_ROLLUP_JOB,
  ROLLUP_INTERVAL_MS,
  LISTING_PATH_PATTERN,
  ROLLUP_SQL,
  WINDOW_START_SQL,
  runListingStatsRollup,
  listingStatsRollupJob,
};
