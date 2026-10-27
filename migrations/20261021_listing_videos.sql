-- Listing videos (2026-10-21).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261021_listing_videos.sql --write
--
-- ADDITIVE AND IDEMPOTENT.
--
-- `properties.videos` jsonb: [{ "url": "https://…/whatsapp_<hash>.mp4",
-- "poster": "https://…/whatsapp_<hash>_poster.jpg" | null }], in the order the
-- agent sent them. Written by the engine's syncListingToPostgres when a
-- WhatsApp listing carries videos (services/listingMedia.js); NULL otherwise.
--
-- Deliberately not the Laravel template's `video_url` / `video_image`: those
-- hold ONE link the back-office renders its own way, and agents send several
-- clips. They are left untouched.
--
-- DEPLOY ORDER: any order. The engine logs and carries on without the column
-- (42703), and the web reads it through to_jsonb(p), which never fails on a
-- missing key.

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS videos jsonb;

COMMENT ON COLUMN properties.videos IS
  'Listing videos, [{url, poster}] — engine services/listingMedia.js. NULL = none.';

COMMIT;
