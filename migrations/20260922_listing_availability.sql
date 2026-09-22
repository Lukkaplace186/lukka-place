-- "Toujours disponible ?" — the weekly one-tap availability check.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260922_listing_availability.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Safe before or after the web deploy that reads it:
--   - web/lib/listings.js reads the column through to_jsonb(p), so a public
--     listing page never fails on it (a missing column is just NULL: no badge);
--   - web/lib/listingAvailability.js catches 42703 and shows no prompts.
--
-- NO BACKFILL. NULL means "never confirmed", and that is the truth for every
-- existing listing: nobody has confirmed anything yet. Stamping created_at or
-- updated_at here would publish "Disponibilité confirmée le …" on listings no
-- agent ever looked at — the badge would be worth nothing from day one.
--
-- WHY A TIMESTAMP, NOT A BOOLEAN
-- Same reason as verified_at / phone_verified_at / sold_at: the only useful
-- question is "when", and the badge prints the date.
--
-- WHY NO HISTORY TABLE (listing_availability_checks)
-- Nothing reads one. The badge and the agent's to-do list need only the last
-- confirmation; "Loué / vendu" is already recorded by listing_status/sold_at/
-- sold_price, and "Prix modifié" writes the new price to the listing itself.
-- A table of taps with no reader is a second copy of facts that live on the
-- row. Add it the day a report actually needs "confirmed N times".
--
-- The engine's syncListingToPostgres never names this column (its UPDATE is
-- built from buildPropertyValues' keys), so a WhatsApp re-sync keeps it —
-- pinned by scripts/verify-pipeline.js.

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS availability_confirmed_at timestamptz;

COMMENT ON COLUMN properties.availability_confirmed_at IS
  'Last time the listing''s agent confirmed it is still available (web agent dashboard). NULL = never confirmed. Never backfilled.';

COMMIT;
