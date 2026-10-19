-- Commercial spaces — offices, shops, warehouses (2026-10-19).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261019_commercial_spaces.sql --write
--
-- ADDITIVE AND IDEMPOTENT.
--
-- 1. A "Bureau" / "Office" category. property_categories already had the
--    commercial types Boutique (40), Entrepôt (43) and Bâtiment (38), all
--    `type = 'commercial'`, but no office — the engine filed a WhatsApp
--    "bureaux à louer" under Bâtiment and an agent on the web could not pick
--    it at all. Neither table has an id sequence (rows came from the Laravel
--    back-office), so ids are MAX + 1, inside a lock. Inserted only when no
--    French category is already named Bureau, so a second run adds nothing.
--
-- 2. Four nullable specs on `properties` (services/commercial.js, engine;
--    web/lib/commercialSpaces.js). NULL = not stated, never "no". Written only
--    for a commercial listing; nothing is backfilled, since no listing has
--    stated them anywhere we could read back.
--
-- DEPLOY ORDER: run this BEFORE deploying the web code — the storefront's
-- listing queries name the four columns. The engine tolerates their absence
-- (SAVEPOINT on 42703), and caches categories per process: restart it after.

BEGIN;

LOCK TABLE property_categories, property_category_contents IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  new_category_id BIGINT;
  next_content_id BIGINT;
  next_serial INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM property_category_contents
    WHERE language_id = 26 AND lower(name) = 'bureau'
  ) THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO new_category_id FROM property_categories;
    SELECT COALESCE(MAX(serial_number), 0) + 1 INTO next_serial FROM property_categories;
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_content_id FROM property_category_contents;

    -- `image` is NOT NULL in the back-office schema; no icon was drawn for
    -- this category, and borrowing another category's would be a lie.
    INSERT INTO property_categories (id, type, image, status, serial_number, featured, created_at, updated_at)
    VALUES (new_category_id, 'commercial', '', 1, next_serial, 0, NOW(), NOW());

    INSERT INTO property_category_contents (id, category_id, language_id, name, slug, created_at, updated_at)
    VALUES
      (next_content_id,     new_category_id, 20, 'Office', 'office', NOW(), NOW()),
      (next_content_id + 1, new_category_id, 26, 'Bureau', 'bureau', NOW(), NOW());
  END IF;
END $$;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS office_count  SMALLINT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS floor_level   SMALLINT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS road_frontage BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS truck_access  BOOLEAN;

-- Same bounds as services/commercial.js's normaliseCommercialSpecs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_office_count_range') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_office_count_range
      CHECK (office_count IS NULL OR office_count BETWEEN 0 AND 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_floor_level_range') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_floor_level_range
      CHECK (floor_level IS NULL OR floor_level BETWEEN -3 AND 60);
  END IF;
END $$;

COMMIT;
