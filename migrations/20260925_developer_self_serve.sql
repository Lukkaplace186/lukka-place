-- Projets, part 2: developers upload their own projects, and a building's
-- units that are ready now become real listings on the main map.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260925_developer_self_serve.sql --write
--
-- ADDITIVE AND IDEMPOTENT. Run BEFORE deploying the web app that reads these
-- columns: getMapMarkers and the listing quota select properties.development_id.
--
-- REVIEW, NOT SELF-PUBLISHING
-- A developer's draft is a developments row with approve_status = 0, exactly
-- like one the team creates. `submitted_at` says "the developer asks us to
-- look at it"; `reviewed_at` / `reviewed_by` / `review_note` record the
-- team's answer (a note with approve_status still 0 = changes requested).
-- `changes_pending` is set when a developer edits something visible on a
-- project that is ALREADY public — the page stays up (a fixed typo must not
-- take a live project offline) and the team sees it in its queue.
--
-- UNITS AS LISTINGS
-- A unit type ticked `ready_now` has individual units (Apt 1A, 1B…), and each
-- is a real `properties` row: its own price, its own page, its own moderation
-- and its own place in search. They share `parent_building_id` =
-- developments.building_uuid, which is what web/lib/buildingGroups.js already
-- groups into ONE map pin. `development_id` / `development_unit_type_id` link
-- them back; ON DELETE SET NULL because a listing is a real record the team
-- may have approved — deleting a project must not silently delete listings.
-- Such a listing keeps its parent_building_id, so it still groups.
--
-- NOTHING IS AGGREGATED. For a ready_now unit type, units available is the
-- COUNT of its linked listings that are still on the market, computed at read
-- time — never copied into units_available, which would be a second record of
-- the same fact.

BEGIN;

ALTER TABLE developments ADD COLUMN IF NOT EXISTS land_mode text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'developments_land_mode_check') THEN
    ALTER TABLE developments ADD CONSTRAINT developments_land_mode_check
      CHECK (land_mode IS NULL OR land_mode IN ('portions', 'lots'));
  END IF;
END $$;

ALTER TABLE developments ADD COLUMN IF NOT EXISTS building_uuid     uuid        NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE developments ADD COLUMN IF NOT EXISTS submitted_at      timestamptz;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS reviewed_at       timestamptz;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS reviewed_by       text;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS review_note       text;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS changes_pending   boolean     NOT NULL DEFAULT false;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS created_by_agent  boolean     NOT NULL DEFAULT false;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS trace_by_team     boolean     NOT NULL DEFAULT false;
ALTER TABLE developments ADD COLUMN IF NOT EXISTS approved_at       timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS developments_building_uuid_idx ON developments (building_uuid);
CREATE INDEX IF NOT EXISTS developments_review_queue_idx ON developments (submitted_at)
  WHERE approve_status = 0 AND submitted_at IS NOT NULL;

-- Unit types: which real category their listings are filed under
-- (Appartement / Villa / …, from property_categories), and whether they have
-- individual units available now.
ALTER TABLE development_unit_types ADD COLUMN IF NOT EXISTS category_id bigint;
ALTER TABLE development_unit_types ADD COLUMN IF NOT EXISTS ready_now   boolean NOT NULL DEFAULT false;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS development_id           bigint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS development_unit_type_id bigint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS unit_label               text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS unit_floor               smallint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_development_id_fkey') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_development_id_fkey
      FOREIGN KEY (development_id) REFERENCES developments (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_development_unit_type_id_fkey') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_development_unit_type_id_fkey
      FOREIGN KEY (development_unit_type_id) REFERENCES development_unit_types (id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS properties_development_idx ON properties (development_id)
  WHERE development_id IS NOT NULL;

COMMIT;
