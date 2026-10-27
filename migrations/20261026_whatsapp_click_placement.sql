-- whatsapp_clicks.placement: which WhatsApp button was tapped — a listing
-- card's action in the feed, rails or list pane ('card'), a card inside the
-- map's card carousel / pin preview ('map_card'), the listing page's enquiry
-- card in the desktop rail ('listing_desktop') or the phone's bottom bar on a
-- listing page ('listing_mobile_bar'). Read by /admin/dashboard's
-- "Clics WhatsApp — détail".
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261026_whatsapp_click_placement.sql --write
--
-- IDEMPOTENT and additive. Rows written before it stay NULL ("avant le suivi"):
-- nothing recorded which button they came from, so nothing is backfilled.
-- Kept in step with web/lib/leadClicks.js LEAD_CLICK_PLACEMENTS. Until this
-- runs, web's INSERT gets 42703 and retries without the column — no tap is lost.
--
-- 2026-10-27: the first version of this file allowed 'listing_page' for the
-- enquiry card. That card renders twice on a listing page (the desktop rail
-- and a phone copy in the page body), so a 'listing_page' row cannot be told
-- apart afterwards and is NOT relabelled: the CHECK keeps accepting it for
-- rows already written, and web no longer writes it. Re-running the file is
-- safe whether or not the first version ran.

BEGIN;

ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS placement text;

ALTER TABLE whatsapp_clicks DROP CONSTRAINT IF EXISTS whatsapp_clicks_placement_check;
ALTER TABLE whatsapp_clicks ADD CONSTRAINT whatsapp_clicks_placement_check CHECK (
  placement IS NULL
  OR placement IN ('card', 'listing_desktop', 'listing_mobile_bar', 'map_card')
  -- legacy, written 2026-10-26 → 2026-10-27 only
  OR placement = 'listing_page'
);

COMMIT;
