-- whatsapp_clicks.routing_type 'VIA_LUKKA' (2026-11-09, owner decision): a
-- verified agent's listing whose WhatsApp button now opens the Lukka Place
-- number first (web/lib/leadRouting.js), so the engine records the customer
-- and a lead and hands them the agent's WhatsApp. 'DIRECT_WA' stays valid for
-- the rows written before, and for NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=on.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261109_whatsapp_via_lukka.sql --write
--
-- IDEMPOTENT. Until it runs, web stores a VIA_LUKKA tap with no routing type
-- (lib/leadClicks.js retries on 23514) — no tap is lost. Nothing is backfilled.

BEGIN;

ALTER TABLE whatsapp_clicks DROP CONSTRAINT IF EXISTS whatsapp_clicks_routing_type_check;
ALTER TABLE whatsapp_clicks ADD CONSTRAINT whatsapp_clicks_routing_type_check
  CHECK (routing_type IS NULL OR routing_type IN ('DIRECT_WA', 'CENTRAL_FALLBACK', 'VIA_LUKKA'));

COMMIT;
