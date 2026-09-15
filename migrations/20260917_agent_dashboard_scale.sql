-- The agent dashboard at 1,000 → 30,000 agents: the indexes its reads were
-- missing, and a daily rollup so month/year trends stop scanning raw events.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260917_agent_dashboard_scale.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Three indexes and one new table; nothing existing
-- is altered. Safe to deploy the code before or after this runs: web's
-- lib/analytics.js reads the rollup only when it exists AND is fresh, and
-- falls back to the raw tables otherwise.

BEGIN;

-- 1. Per-agent event reads ------------------------------------------------
-- Every agent-dashboard view count is `path = ANY($paths) [AND created_at >= …]`
-- (lib/analytics.js). page_views had indexes on created_at, device, source and
-- commune — none on path — so each dashboard load was a scan of the whole
-- table filtered in memory. Fine at 508 rows; at 30k agents' traffic it is
-- the single most expensive thing a dashboard does. (path, created_at) serves
-- both the all-time equality and the windowed range.
CREATE INDEX IF NOT EXISTS page_views_path_created_idx ON page_views (path, created_at);

-- Same shape for taps. whatsapp_clicks was indexed on created_at (twice) and
-- commune, never on listing_id, which every per-listing count filters on.
CREATE INDEX IF NOT EXISTS whatsapp_clicks_listing_created_idx ON whatsapp_clicks (listing_id, created_at);

CREATE INDEX IF NOT EXISTS listing_events_listing_created_idx ON listing_events (listing_id, created_at);

-- 2. Daily rollup ----------------------------------------------------------
-- One row per listing per UTC day. Written ONLY by the engine's
-- `listing-stats-rollup` scheduler job (services/listingStatsRollup.js), which
-- recounts whole days from the raw tables rather than incrementing — so a
-- re-run, a missed tick or a late event can never double-count; the next run
-- simply rewrites the day.
--
-- UTC days, deliberately: every existing analytics bucket (lib/analytics.js's
-- date_trunc) is UTC, and a rollup on Kinshasa days would make the 12-month
-- chart and the 30-day card disagree by an hour at each boundary.
--
-- `saves` counts `listing_saved` events (gross). Unsaves are not netted out:
-- "saved then changed their mind" is still a save that happened.
CREATE TABLE IF NOT EXISTS listing_stats_daily (
  listing_id       bigint      NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  day              date        NOT NULL,
  views            integer     NOT NULL DEFAULT 0,
  whatsapp_clicks  integer     NOT NULL DEFAULT 0,
  saves            integer     NOT NULL DEFAULT 0,
  refreshed_at     timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (listing_id, day)
);

CREATE INDEX IF NOT EXISTS listing_stats_daily_day_idx ON listing_stats_daily (day);
CREATE INDEX IF NOT EXISTS listing_stats_daily_refreshed_idx ON listing_stats_daily (refreshed_at);

-- Supabase grants anon/authenticated on new public tables by default; nothing
-- reads this over the REST API. Same posture as the console_* tables.
REVOKE ALL ON listing_stats_daily FROM anon, authenticated;

COMMIT;
