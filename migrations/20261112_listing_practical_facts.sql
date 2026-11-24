-- Fiche pratique: power, water, rainy-season access, visit fee (2026-11-12).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261112_listing_practical_facts.sql --write
--
-- ADDITIVE AND IDEMPOTENT.
--
-- Five nullable columns on `properties`, the agent's one-tap answers on
-- WhatsApp after "OK" (engine services/practicalFacts.js; web
-- lib/practicalFacts.js). NULL = not answered, never "no". Nothing is
-- backfilled: an answer nobody gave is not something a query can know.
--
-- The value lists are DUPLICATED in services/practicalFacts.js and
-- web/lib/practicalFacts.js (web/tests/unit/practical-facts.test.js compares
-- all three). The engine writes in a SAVEPOINT that tolerates the columns'
-- absence; the web reads them through to_jsonb, so nothing 42703s before this
-- runs. `properties` keeps RLS on with no policy; nothing to grant.

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS power_supply text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS water_supply text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS rainy_access text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS visit_fee boolean;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS practical_answered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_power_supply_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_power_supply_check
      CHECK (power_supply IS NULL OR power_supply IN ('snel', 'snel_groupe', 'snel_solaire'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_water_supply_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_water_supply_check
      CHECK (water_supply IS NULL OR water_supply IN ('regideso', 'regideso_citerne', 'forage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_rainy_access_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_rainy_access_check
      CHECK (rainy_access IS NULL OR rainy_access IN ('bon', 'difficile', 'inonde'));
  END IF;
END $$;

COMMIT;
