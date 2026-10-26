-- Practical listing details and four more property types (2026-10-22).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261022_listing_details.sql --write
--
-- ADDITIVE AND IDEMPOTENT.
--
-- 1. Four categories, ids MAX + 1 under a lock (no sequence on these
--    Laravel-born tables), each inserted only when no French category of that
--    name exists:
--      Studio                    residential  (WhatsApp "studio" was filed under Appartement)
--      Chambre / Annexe          residential  (a room, annexe or dépendance let on its own)
--      Salle de fête             commercial   (event halls, often let by the day)
--      Ferme / Terrain agricole  residential  (Maluku, Mont-Ngafula, Kasangulu)
--    Listings already filed under Appartement / Terrain are not moved: which
--    of them is "really" a studio or a farm is not something a query knows.
--
-- 2. Ten nullable columns on `properties` (services/listingDetails.js, engine;
--    web/lib/listingDetails.js). NULL = not stated, never "no". Nothing is
--    backfilled. `furnished` was extracted on WhatsApp since launch but had no
--    column here, so it never reached the storefront.
--
-- The engine writes them on a listing's first sync only (the agent's editor
-- owns them after), in a SAVEPOINT that tolerates their absence. The web reads
-- them through to_jsonb, so nothing 42703s before this runs. Restart the
-- engine afterwards (category cache).

BEGIN;

LOCK TABLE property_categories, property_category_contents IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  wanted RECORD;
  new_category_id BIGINT;
  next_content_id BIGINT;
  next_serial INTEGER;
BEGIN
  FOR wanted IN
    SELECT * FROM (VALUES
      ('Studio',                   'studio',         'Studio',           'studio',     'residential'),
      ('Chambre / Annexe',         'chambre-annexe', 'Room / Annex',     'room-annex', 'residential'),
      ('Salle de fête',            'salle-de-fete',  'Event Hall',       'event-hall', 'commercial'),
      ('Ferme / Terrain agricole', 'ferme',          'Farm / Farmland',  'farm',       'residential')
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

ALTER TABLE properties ADD COLUMN IF NOT EXISTS furnished              BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS households_count       SMALLINT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS landlord_on_site       BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS toilet_location        TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS shower_location        TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS electricity_meter      TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS plot_dimensions        TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS plot_area_m2           NUMERIC(14, 2);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS installments_available BOOLEAN;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS installment_terms      TEXT;

-- Same bounds and vocabularies as services/listingDetails.js.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_households_count_range') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_households_count_range
      CHECK (households_count IS NULL OR households_count BETWEEN 1 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_toilet_location_values') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_toilet_location_values
      CHECK (toilet_location IS NULL OR toilet_location IN ('interieur', 'exterieur'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_shower_location_values') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_shower_location_values
      CHECK (shower_location IS NULL OR shower_location IN ('interieur', 'exterieur'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_electricity_meter_values') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_electricity_meter_values
      CHECK (electricity_meter IS NULL OR electricity_meter IN ('prepaye', 'individuel', 'partage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_plot_dimensions_length') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_plot_dimensions_length
      CHECK (plot_dimensions IS NULL OR char_length(plot_dimensions) <= 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_plot_area_range') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_plot_area_range
      CHECK (plot_area_m2 IS NULL OR (plot_area_m2 >= 1 AND plot_area_m2 <= 100000000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_installment_terms_length') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_installment_terms_length
      CHECK (installment_terms IS NULL OR char_length(installment_terms) <= 300);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS properties_plot_area_m2_idx ON properties (plot_area_m2) WHERE plot_area_m2 IS NOT NULL;

COMMIT;
