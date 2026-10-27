-- Listing equipment in; toilet / shower and "Salle de fête" out (2026-10-22, owner review).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261022_listing_equipment.sql --write
--
-- IDEMPOTENT. Follows migrations/20261022_listing_details.sql the same day.
--
-- 1. Four nullable booleans (services/listingDetails.js): has_generator,
--    has_pool, has_gym, has_solar. true = the agent said so; NULL = not
--    stated. Never false: an unticked box is "not stated".
-- 2. toilet_location / shower_location are dropped (with their CHECKs).
--    They existed for a few hours; no row ever held a value (checked below —
--    the migration refuses to drop a column that has data).
-- 3. The "Salle de fête" category (added this morning) is deleted, both
--    content rows with it — only when nothing references it.
--
-- The engine and web read and write these through to_jsonb / SAVEPOINTs that
-- tolerate a missing column, so the order against the code deploy does not
-- matter. Restart the engine afterwards (category cache).

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_generator BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_pool      BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_gym       BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_solar     BOOLEAN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'properties' AND column_name = 'toilet_location') THEN
    IF EXISTS (SELECT 1 FROM properties WHERE toilet_location IS NOT NULL OR shower_location IS NOT NULL) THEN
      RAISE EXCEPTION 'toilet_location / shower_location hold data — not dropped';
    END IF;
    ALTER TABLE properties DROP COLUMN toilet_location;
    ALTER TABLE properties DROP COLUMN shower_location;
  END IF;
END $$;

LOCK TABLE property_categories, property_category_contents IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  hall_id BIGINT;
BEGIN
  SELECT category_id INTO hall_id FROM property_category_contents
   WHERE language_id = 26 AND lower(name) = lower('Salle de fête') LIMIT 1;
  IF hall_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM properties WHERE category_id = hall_id)
     OR EXISTS (SELECT 1 FROM development_unit_types WHERE category_id = hall_id)
     OR EXISTS (SELECT 1 FROM market_snapshots_monthly WHERE category_id = hall_id)
     OR EXISTS (SELECT 1 FROM bot_sessions WHERE draft_category_id = hall_id) THEN
    RAISE NOTICE 'Salle de fête (%) is in use — kept', hall_id;
    RETURN;
  END IF;
  DELETE FROM property_category_contents WHERE category_id = hall_id;
  DELETE FROM property_categories WHERE id = hall_id;
END $$;

COMMIT;
