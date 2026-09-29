-- Kinshasa utility tags on properties: what the agent states about SNEL power,
-- water, security and access, as fixed codes.
--
-- Run with:  node scripts/run-sql-migration.js migrations/20260929_listing_utilities.sql --write
--
-- ADDITIVE AND IDEMPOTENT. One nullable text[] column, a CHECK that it only
-- ever holds known codes (services/utilities.js / web/lib/utilityTags.js —
-- change all three together), and a GIN index for the `&&` filter.
--
-- Nothing is backfilled here. scripts/backfill-listing-utilities.js re-reads
-- each live listing's original message with the extraction (it spends one
-- model call per listing — run it deliberately, dry run first).
--
-- Deploy order: web reads the column through to_jsonb(p), and the engine
-- writes it inside a SAVEPOINT, so neither breaks before this runs; the web
-- editor's save of the tags fails soft (the rest of the edit is kept).

BEGIN;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS utilities text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_utilities_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_utilities_check CHECK (
      utilities IS NULL OR utilities <@ ARRAY[
        'snel_stable', 'groupe', 'solaire', 'regideso', 'citerne', 'forage',
        'gardiennage', 'cloture', 'route_asphaltee', 'acces_facile'
      ]::text[]
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS properties_utilities_gin_idx ON properties USING gin (utilities);

COMMIT;
