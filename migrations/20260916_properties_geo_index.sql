-- Bounding-box reads for the /listings viewport map.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260916_properties_geo_index.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One index; nothing existing is altered.
--
-- WHY AN EXPRESSION INDEX, NOT (latitude, longitude, approve_status)
-- `latitude`/`longitude` are TEXT on this table (Laravel's schema), so a
-- composite index on the raw columns would order "-4.3" as a string and could
-- not serve `BETWEEN -4.40 AND -4.30`. web/lib/listings.js reads them through
-- LAT_EXPR/LNG_EXPR, which cast a well-formed decimal and NULL anything else;
-- this indexes exactly those expressions. The planner only matches an
-- expression index against an IDENTICAL expression — web's
-- tests/unit/map-viewport.test.js compares the two texts, so change both
-- together.
--
-- WHY PARTIAL
-- Every public read carries `status = 1 AND approve_status = 1` (CLAUDE.md,
-- "Public listing filter"), so the index holds only rows a public map can ever
-- return — pending, rejected, archived and sold rows cost it nothing. This
-- replaces the brief's `approve_status` key column, which would have indexed
-- every row to then filter most of them out.
--
-- WHY NOT POSTGIS
-- Not enabled on this database, and enabling an extension on the shared
-- Supabase project is a decision beyond a map deploy. A B-tree range on
-- latitude plus a longitude filter is ample for rectangles over tens of
-- thousands of rows; GiST is the upgrade path if radius/polygon search lands.
--
-- Not CONCURRENTLY: that cannot run inside the transaction below, and at this
-- table's size the build takes milliseconds.

BEGIN;

CREATE INDEX IF NOT EXISTS properties_public_lat_lng_idx
  ON properties (
    (CASE WHEN latitude ~ '^-?[0-9]+([.][0-9]+)?$' THEN latitude::double precision END),
    (CASE WHEN longitude ~ '^-?[0-9]+([.][0-9]+)?$' THEN longitude::double precision END)
  )
  WHERE status = 1 AND approve_status = 1;

COMMIT;

ANALYZE properties;
