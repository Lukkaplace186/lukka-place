-- The neighbourhood an advert names, for neighbourhood price figures
-- (owner, 2026-11-12: a commune figure mixes Macampagne villas with Binza
-- flats, or Boulevard du 24 Novembre new builds with older homes).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261112_market_observation_area.sql --write
-- Then:      node scripts/backfill-market-area.js [--write]
--
-- ADDITIVE AND IDEMPOTENT. `area` is an official quartier of the row's
-- commune, or a name agents use that kinshasa_quartier_aliases.json records
-- with a source (services/marketObservations.js areaOf). NULL = not stated or
-- not a name we can vouch for. `quartier` keeps the source's own text.

BEGIN;

ALTER TABLE market_observations ADD COLUMN IF NOT EXISTS area text;

CREATE INDEX IF NOT EXISTS market_observations_commune_area_idx
  ON market_observations (commune, area) WHERE area IS NOT NULL;

COMMIT;
