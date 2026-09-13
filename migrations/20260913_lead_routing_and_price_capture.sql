-- migrations/20260913_lead_routing_and_price_capture.sql
--
-- Direct-to-agent lead routing, WhatsApp price capture, agent performance.
-- Run with: node scripts/run-sql-migration.js migrations/20260913_lead_routing_and_price_capture.sql [--write]
--
-- ADAPTED TO THE REAL SCHEMA, deliberately not the literal spec:
--
--  * properties.sold_price / sold_at ALREADY EXIST (numeric / date) and are
--    what markPropertySold, web's markListingSoldAction, lib/dataExport.js and
--    lib/marketBenchmarks.js all read and write. A second `sold_price_usd`
--    column would split one fact across two places, and `ADD COLUMN sold_at`
--    would collide. Only the missing fact — WHERE the figure came from — is
--    added.
--  * price_delta_usd / price_delta_pct are NOT stored. They are derived at
--    read time from sold_price and price, exactly as dataExport.js already
--    does, so an asking price corrected after the close can never leave a
--    stale delta behind.
--  * agents.id and properties.id are BIGINT, not UUID — the foreign keys
--    below match. ON DELETE CASCADE because an agent can delete their own
--    listing from the web dashboard (web/lib/agentListings.js); a performance
--    log must never block that.
--  * viewing_requests lives in the engine's SQLite, not Postgres. Its new
--    columns (agent_id, routing_type, decline_reason_code, COMPLETED status)
--    are added by services/db.js's idempotent migrateViewingRequests.
--
-- Idempotent: every statement is IF NOT EXISTS or guarded, so a re-run is a
-- no-op. One transaction, so a failure leaves nothing half-applied.

BEGIN;

-- 1. Provenance of properties.sold_price -----------------------------------
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_source varchar(50);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_price_source_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_price_source_check
      CHECK (price_source IS NULL OR price_source IN ('WHATSAPP_AGENT_REPLY', 'ADMIN_DASHBOARD', 'DIRECT_INPUT'));
  END IF;
END $$;

-- 2. The admin switch behind direct wa.me routing ---------------------------
-- Direct routing requires BOTH agents.phone_verified_at (the agent proved they
-- hold the number) AND this flag. The flag cannot stand in for the proof: an
-- admin can switch a verified agent off, never switch an unproven number on.
-- DEFAULT true so every already-verified agent keeps the direct contact the
-- storefront shows them today.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS direct_routing_enabled boolean NOT NULL DEFAULT true;

-- 3. Agent performance -----------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_performance_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                  bigint NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
  listing_id                bigint NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  -- The engine's SQLite viewing_requests.id. No FK is possible across the two
  -- databases; the partial unique index below is what makes one log per request.
  viewing_request_id        integer,
  lead_timestamp            timestamptz NOT NULL DEFAULT NOW(),
  first_response_timestamp  timestamptz,
  response_latency_seconds  integer,
  outcome_status            varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (outcome_status IN ('PENDING', 'CONFIRMED', 'RESCHEDULED', 'DECLINED', 'COMPLETED')),
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_performance_logs_viewing_request_uidx
  ON agent_performance_logs (viewing_request_id) WHERE viewing_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_performance_logs_agent_lead_idx
  ON agent_performance_logs (agent_id, lead_timestamp);

-- 4. Which way a storefront WhatsApp tap actually went ----------------------
-- Nullable: every click recorded before this has no routing type, and
-- inventing one would be fabricated history.
ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS agent_id bigint;
ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS routing_type varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_clicks_routing_type_check') THEN
    ALTER TABLE whatsapp_clicks ADD CONSTRAINT whatsapp_clicks_routing_type_check
      CHECK (routing_type IS NULL OR routing_type IN ('DIRECT_WA', 'CENTRAL_FALLBACK'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_clicks_created_at_idx ON whatsapp_clicks (created_at);

COMMIT;
