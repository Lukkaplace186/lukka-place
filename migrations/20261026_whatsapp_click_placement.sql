-- whatsapp_clicks.placement: which WhatsApp button was tapped — a listing
-- card's action ('card': feed, rails, map cards), the listing page's enquiry
-- card ('listing_page') or the phone's bottom bar on a listing page
-- ('listing_mobile_bar'). Read by /admin/dashboard's "Clics WhatsApp — détail".
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261026_whatsapp_click_placement.sql --write
--
-- IDEMPOTENT and additive. Rows written before it stay NULL ("avant le suivi"):
-- nothing recorded which button they came from, so nothing is backfilled.
-- Kept in step with web/lib/leadClicks.js LEAD_CLICK_PLACEMENTS. Until this
-- runs, web's INSERT gets 42703 and retries without the column — no tap is lost.

BEGIN;

ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS placement text;

ALTER TABLE whatsapp_clicks DROP CONSTRAINT IF EXISTS whatsapp_clicks_placement_check;
ALTER TABLE whatsapp_clicks ADD CONSTRAINT whatsapp_clicks_placement_check CHECK (
  placement IS NULL OR placement IN ('card', 'listing_page', 'listing_mobile_bar')
);

COMMIT;
