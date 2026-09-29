-- listing_shares.format gains 'watermarked_photo' ("Photos avec mon logo" in
-- the agent share kit, web/lib/marketing/watermark.js) and 'fiche_neutre' (the
-- technical sheet printed without the agent's identity, ?variant=neutre);
-- channel gains 'wa_command' ("!share 310" typed on WhatsApp).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260929_listing_share_formats.sql --write
--
-- IDEMPOTENT. Both CHECKs were declared inline in 20260922_listing_shares.sql,
-- so Postgres named them listing_shares_channel_check / _format_check; each is
-- dropped and re-created with the full list. Kept in step with
-- web/lib/listingShareRules.js SHARE_FORMATS (tests/unit/listing-shares-print.test.js
-- compares the two). Until this runs, recording a watermarked photo fails the
-- CHECK and records nothing — the share itself is unaffected.

BEGIN;

ALTER TABLE listing_shares DROP CONSTRAINT IF EXISTS listing_shares_channel_check;
ALTER TABLE listing_shares ADD CONSTRAINT listing_shares_channel_check CHECK (channel IN (
  'kit_share', 'kit_download', 'kit_whatsapp', 'kit_copy',
  'menu_whatsapp', 'status_share', 'status_download', 'print', 'wa_command'
));

ALTER TABLE listing_shares DROP CONSTRAINT IF EXISTS listing_shares_format_check;
ALTER TABLE listing_shares ADD CONSTRAINT listing_shares_format_check CHECK (format IS NULL OR format IN (
  'square', 'story', 'landscape', 'text', 'poster', 'fiche', 'fiche_neutre', 'watermarked_photo'
));

COMMIT;
