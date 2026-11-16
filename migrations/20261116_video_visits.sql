-- "Visite par appel vidéo" (owner, 2026-11-16): a customer abroad visits by
-- WhatsApp video call, the agent filming from the property.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261116_video_visits.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Two changes:
--
--   agent_visit_availability.video_visits  boolean, NOT NULL, default true.
--     The agent's "J'accepte les visites par appel vidéo" switch (web
--     components/AgentVisitAvailability.js). On by default (owner): no row,
--     or a row written before this, means the agent accepts them. Switched
--     off, the listing's visit dialog and WhatsApp chooser stop offering it.
--     Web reads it through to_jsonb(v) ->> 'video_visits', so the storefront
--     works before this runs (every agent accepts, the switch says it cannot
--     be saved yet).
--
--   whatsapp_clicks.intent  gains 'video_visit' (the chooser's "Visiter par
--     appel vidéo"). Before this runs, web keeps such a tap as 'visit'
--     (lib/leadClicks.js retries on 23514): an appointment request either way.
--
-- The visit request itself is in the engine's SQLite
-- (viewing_requests.visit_mode, services/db.js ALTER list), not here.

BEGIN;

ALTER TABLE agent_visit_availability ADD COLUMN IF NOT EXISTS video_visits boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_clicks_intent_check')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'whatsapp_clicks_intent_check'
          AND pg_get_constraintdef(oid) LIKE '%video_visit%'
     ) THEN
    ALTER TABLE whatsapp_clicks DROP CONSTRAINT whatsapp_clicks_intent_check;
  END IF;
  IF to_regclass('public.whatsapp_clicks') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'whatsapp_clicks' AND column_name = 'intent'
     )
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_clicks_intent_check') THEN
    ALTER TABLE whatsapp_clicks
      ADD CONSTRAINT whatsapp_clicks_intent_check
      CHECK (intent IS NULL OR intent IN ('visit', 'video_visit', 'availability', 'question'));
  END IF;
END $$;

COMMIT;
