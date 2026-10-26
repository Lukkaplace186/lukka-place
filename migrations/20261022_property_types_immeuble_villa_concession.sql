-- Property types: "Bâtiment" becomes "Immeuble"; "Villa" and "Concession" added (2026-10-22).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261022_property_types_immeuble_villa_concession.sql --write
--
-- IDEMPOTENT. Property types are rows of property_categories (+ one content
-- row per language), not an ENUM: every dropdown, facet and filter on the
-- web reads them from here, so renaming the row renames it everywhere.
--
-- 1. Category 38 (commercial, "Bâtiment" / "Building") is renamed
--    "Immeuble" / slug "immeuble" in French; English stays "Building".
--    Its id does not change, so every listing filed under it (none on
--    2026-10-22) moves with it — no UPDATE on properties is needed.
-- 2. "Villa" (residential) — engine intake already reads villas but filed
--    them under Maison for want of a category.
-- 3. "Concession" / "Compound" (residential) — a walled plot, often several
--    buildings and a large garden, sold or let whole. Distinct from Terrain
--    (bare land) and Maison (one house).
--
-- Neither table has an id sequence (rows came from the Laravel back-office),
-- so ids are MAX + 1 inside a lock, as in 20261019_commercial_spaces.sql.
-- `image` is NOT NULL there; no icon was drawn for the new categories.
--
-- DEPLOY ORDER: run before or with the engine and web deploys. Both accept
-- the old name too ("batiment" → Immeuble). The engine caches categories per
-- process: restart it after.

BEGIN;

LOCK TABLE property_categories, property_category_contents IN SHARE ROW EXCLUSIVE MODE;

UPDATE property_category_contents
   SET name = 'Immeuble', slug = 'immeuble', updated_at = NOW()
 WHERE language_id = 26 AND lower(name) IN ('bâtiment', 'batiment');

DO $$
DECLARE
  wanted RECORD;
  new_category_id BIGINT;
  next_content_id BIGINT;
  next_serial INTEGER;
BEGIN
  FOR wanted IN
    SELECT * FROM (VALUES
      ('Villa',      'villa',      'Villa',    'villa',    'residential'),
      ('Concession', 'concession', 'Compound', 'compound', 'residential')
    ) AS t(fr_name, fr_slug, en_name, en_slug, kind)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM property_category_contents
      WHERE language_id = 26 AND lower(name) = lower(wanted.fr_name)
    ) THEN
      SELECT COALESCE(MAX(id), 0) + 1 INTO new_category_id FROM property_categories;
      SELECT COALESCE(MAX(serial_number), 0) + 1 INTO next_serial FROM property_categories;
      SELECT COALESCE(MAX(id), 0) + 1 INTO next_content_id FROM property_category_contents;

      INSERT INTO property_categories (id, type, image, status, serial_number, featured, created_at, updated_at)
      VALUES (new_category_id, wanted.kind, '', 1, next_serial, 0, NOW(), NOW());

      INSERT INTO property_category_contents (id, category_id, language_id, name, slug, created_at, updated_at)
      VALUES
        (next_content_id,     new_category_id, 20, wanted.en_name, wanted.en_slug, NOW(), NOW()),
        (next_content_id + 1, new_category_id, 26, wanted.fr_name, wanted.fr_slug, NOW(), NOW());
    END IF;
  END LOOP;
END $$;

COMMIT;
