-- Currency (dual-column), structured amenities, monthly pitch allowance.
-- Paste-able into the Supabase SQL editor. Identical effect to
-- scripts/migrate-currency-amenities-pitch.js (which is the runnable
-- version, and the one that also verifies the commune contract before
-- committing). Idempotent — safe to re-run.
--
-- READ THIS BEFORE EDITING -------------------------------------------------
-- `amenities`, `amenity_contents` and `property_amenities` ALREADY EXIST and
-- are live. Verified against production: `amenities` holds 24 rows, ids
-- 21-44, every one a Kinshasa commune, and all 19 `property_amenities` rows
-- are commune tags. `property_amenities` is the ONLY place a listing's
-- commune is stored — there is no commune column (see CLAUDE.md).
--
-- So this file seeds those tables; it does not create them. Dropping and
-- recreating either one would erase the commune of every listing on the
-- site. Names live in `amenity_contents` (per-language), not as a column on
-- `amenities` — do not add one, it would fork the source of truth.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1a. Dual-column currency ---------------------------------------------------
-- `price` remains the canonical USD figure that every WHERE price >= / <= ,
-- ORDER BY price, MAX(price) and the engine's budgetScore already compare
-- against. It is deliberately left untouched. `price_original` + `currency`
-- record what the agent actually typed, so an FC price can be shown verbatim
-- rather than round-tripped through a rate that moves.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_original NUMERIC;

-- Backfill: every listing that exists today was authored in USD.
UPDATE properties SET price_original = price WHERE price_original IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_currency_check') THEN
    ALTER TABLE properties ADD CONSTRAINT properties_currency_check CHECK (currency IN ('USD','CDF'));
  END IF;
END $$;

-- 1c. Monthly pitch allowance ------------------------------------------------
-- On `packages`, beside number_of_property: a pitch allowance is a plan
-- entitlement exactly like the listing cap, and packages is what
-- memberships -> agents.vendor_id already resolves to.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS monthly_pitch_limit INTEGER NOT NULL DEFAULT 10;

-- 1b. Structured amenities: SEED the existing tables -------------------------
-- Ids come from the live identity sequence (last_value 44), so these land on
-- 45+ and never collide with the 21-44 commune block. Resolution is by name
-- through amenity_contents so a re-run refreshes the icon instead of
-- inserting a duplicate concept.
--
-- The vocabulary is deliberately the same set as lib/constants.js's
-- AMENITY_GROUPS, which already drives the public "Plus de filtres"
-- checkboxes by text-matching descriptions — one world, not two.
WITH wanted (name, icon) AS (
  VALUES
    ('Eau courante 24h/24',            'droplet'),
    ('Groupe électrogène',             'zap'),
    ('Panneaux solaires / Inverseur',  'sun'),
    ('Forage / Citerne d''eau',        'waves'),
    ('Clôture / Gardiennage',          'shield-check'),
    ('Parking intérieur',              'car'),
    ('Route asphaltée / pavée',        'route'),
    ('Climatisation',                  'snowflake'),
    ('Meublé',                         'sofa'),
    ('Ascenseur',                      'chevrons-up')
),
missing AS (
  SELECT w.name, w.icon FROM wanted w
  WHERE NOT EXISTS (
    SELECT 1 FROM amenity_contents ac
    JOIN amenities a ON a.id = ac.amenity_id
    WHERE ac.language_id = 20 AND ac.name = w.name AND a.id NOT BETWEEN 21 AND 44
  )
),
created AS (
  INSERT INTO amenities (icon, status, serial_number, created_at, updated_at)
  SELECT m.icon, 1, 0, NOW(), NOW() FROM missing m
  RETURNING id, icon
)
INSERT INTO amenity_contents (amenity_id, language_id, name, created_at, updated_at)
SELECT c.id, 20, m.name, NOW(), NOW()
FROM (SELECT id, icon, row_number() OVER (ORDER BY id) rn FROM created) c
JOIN (SELECT name, icon, row_number() OVER () rn FROM missing) m ON m.rn = c.rn;

-- Refresh icons on any that were already present.
UPDATE amenities a SET icon = w.icon, updated_at = NOW()
FROM (
  VALUES
    ('Eau courante 24h/24',            'droplet'),
    ('Groupe électrogène',             'zap'),
    ('Panneaux solaires / Inverseur',  'sun'),
    ('Forage / Citerne d''eau',        'waves'),
    ('Clôture / Gardiennage',          'shield-check'),
    ('Parking intérieur',              'car'),
    ('Route asphaltée / pavée',        'route'),
    ('Climatisation',                  'snowflake'),
    ('Meublé',                         'sofa'),
    ('Ascenseur',                      'chevrons-up')
) AS w(name, icon)
JOIN amenity_contents ac ON ac.name = w.name AND ac.language_id = 20
WHERE a.id = ac.amenity_id AND a.id NOT BETWEEN 21 AND 44;

-- Safety net: the commune block must be exactly as it was.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM amenities WHERE id BETWEEN 21 AND 44;
  IF n <> 24 THEN
    RAISE EXCEPTION 'Commune amenities (21-44) count is %, expected 24 — aborting.', n;
  END IF;
END $$;

COMMIT;
