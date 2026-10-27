-- listing_shares.format gains 'feed': the 4:5 "Carte feed social" (1080×1350)
-- an agent shares or downloads from Mes biens' "Partager sur WhatsApp" dialog
-- (web/components/ListingQuickShare.js, web/lib/marketing/layout.js).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261026_listing_share_feed_format.sql --write
--
-- IDEMPOTENT. Drops and re-creates both CHECKs with the full lists, as
-- 20260929_listing_share_formats.sql did; the channel list is unchanged.
-- Kept in step with web/lib/listingShareRules.js (tests/unit/listing-shares-print.test.js
-- compares the two). Until this runs, recording a feed share fails the CHECK
-- and records nothing — the share itself is unaffected.

BEGIN;

ALTER TABLE listing_shares DROP CONSTRAINT IF EXISTS listing_shares_channel_check;
ALTER TABLE listing_shares ADD CONSTRAINT listing_shares_channel_check CHECK (channel IN (
  'kit_share', 'kit_download', 'kit_whatsapp', 'kit_copy',
  'menu_whatsapp', 'status_share', 'status_download', 'print', 'wa_command'
));

ALTER TABLE listing_shares DROP CONSTRAINT IF EXISTS listing_shares_format_check;
ALTER TABLE listing_shares ADD CONSTRAINT listing_shares_format_check CHECK (format IS NULL OR format IN (
  'square', 'story', 'landscape', 'text', 'poster', 'fiche', 'fiche_neutre', 'watermarked_photo', 'feed'
));

COMMIT;
