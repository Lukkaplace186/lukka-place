/**
 * One-off migration for three features that previously had no data behind
 * them: authoring a price in FC, structured property amenities, and a
 * monthly pitch allowance.
 *
 * Same convention as scripts/migrate-password-reset.js: `IF NOT EXISTS`
 * throughout, safe to re-run, not wired into build or deploy.
 *
 *   node scripts/migrate-currency-amenities-pitch.js
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT — what this deliberately does NOT do
 * ---------------------------------------------------------------------------
 * The brief asked to "create `amenities` and `property_amenities` tables".
 * Both already exist and are live, verified directly against production:
 *
 *   amenities           24 rows, ids 21-44, every one a Kinshasa commune
 *   property_amenities  19 rows, all 19 of them commune tags
 *   amenity_contents    the per-language name table (names are NOT a column
 *                       on `amenities`, same shape as property_contents)
 *
 * `property_amenities` is how a listing's commune is stored at all — there is
 * no commune column (see CLAUDE.md). A CREATE TABLE here would have errored;
 * a CREATE TABLE IF NOT EXISTS would have silently done nothing while
 * reporting success; and a DROP + CREATE would have destroyed the commune of
 * every listing on the site, breaking the commune filter, the map's
 * centroid fallback, the agent demand feed's commune matching and every
 * location line on the storefront.
 *
 * So this SEEDS the existing structure instead. Feature amenities take ids
 * from the live sequence (last_value 44, so they start at 45) and therefore
 * never collide with the 21-44 commune block that CLAUDE.md's contract and
 * lib/agentListings.js's COMMUNE_AMENITY_IDS both depend on. Adding a `name`
 * column to `amenities` was likewise avoided: it would fork the source of
 * truth for a name that `amenity_contents` already owns.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const FRENCH_LANGUAGE_ID = 20;

/**
 * The structured amenity vocabulary, deliberately the SAME set as
 * lib/constants.js's AMENITY_GROUPS/AMENITY_KEYWORDS. Those keys already
 * drive the public "Plus de filtres" checkboxes by text-matching the
 * description; seeding the same concepts here means the structured data and
 * the existing text-matched filter describe one world rather than two
 * competing ones. `key` is not stored — it exists so the app can resolve a
 * row by a stable identifier instead of hardcoding an id.
 *
 * `icon` holds a lucide-react icon name (kebab-case), matching how the rest
 * of this app names icons; the column already exists on `amenities`.
 */
const FEATURE_AMENITIES = [
  { key: 'water_247', name: 'Eau courante 24h/24', icon: 'droplet' },
  { key: 'generator', name: 'Groupe électrogène', icon: 'zap' },
  { key: 'solar', name: 'Panneaux solaires / Inverseur', icon: 'sun' },
  { key: 'borehole', name: "Forage / Citerne d'eau", icon: 'waves' },
  { key: 'security', name: 'Clôture / Gardiennage', icon: 'shield-check' },
  { key: 'parking', name: 'Parking intérieur', icon: 'car' },
  { key: 'paved_road', name: 'Route asphaltée / pavée', icon: 'route' },
  { key: 'ac', name: 'Climatisation', icon: 'snowflake' },
  { key: 'furnished', name: 'Meublé', icon: 'sofa' },
  { key: 'elevator', name: 'Ascenseur', icon: 'chevrons-up' },
];

const STATEMENTS = [
  // --- 1a. Dual-column currency -------------------------------------------
  // `price` stays the canonical USD figure every filter, sort, MAX() and the
  // engine's budgetScore already compare against — untouched on purpose.
  // `price_original` + `currency` record what the agent actually authored, so
  // an FC price can be displayed verbatim instead of being round-tripped
  // through a rate that moves.
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD'`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS price_original NUMERIC`,
  // Backfill: every existing listing was authored in USD, so its original
  // price is its price. Idempotent — only fills rows not already set.
  `UPDATE properties SET price_original = price WHERE price_original IS NULL`,
  // Guard the vocabulary at the database, not just in the action: a bad
  // currency code here would silently mis-price a listing everywhere.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_currency_check') THEN
       ALTER TABLE properties ADD CONSTRAINT properties_currency_check CHECK (currency IN ('USD','CDF'));
     END IF;
   END $$`,

  // --- 1c. Monthly pitch allowance ----------------------------------------
  // On `packages`, beside number_of_property: a pitch allowance is a plan
  // entitlement, exactly like the listing cap, and `packages` is what
  // memberships -> agents.vendor_id already resolves to (lib/agents.js's
  // AGENT_FIELDS). Putting it on `agents` would have made it a per-agent
  // override with no plan to inherit from.
  `ALTER TABLE packages ADD COLUMN IF NOT EXISTS monthly_pitch_limit INTEGER NOT NULL DEFAULT 10`,
];

async function seedFeatureAmenities(client) {
  const results = [];
  for (const { name, icon } of FEATURE_AMENITIES) {
    // Resolve by name through amenity_contents (the real name table), so a
    // re-run updates the icon rather than inserting a duplicate concept.
    const { rows: existing } = await client.query(
      `SELECT a.id FROM amenities a
       JOIN amenity_contents ac ON ac.amenity_id = a.id AND ac.language_id = $1
       WHERE ac.name = $2 AND a.id NOT BETWEEN 21 AND 44`,
      [FRENCH_LANGUAGE_ID, name],
    );

    if (existing.length) {
      await client.query('UPDATE amenities SET icon = $1, updated_at = NOW() WHERE id = $2', [icon, existing[0].id]);
      results.push(`  = ${String(existing[0].id).padStart(3)}  ${name} (already present, icon refreshed)`);
      continue;
    }

    // id comes from the live identity sequence (last_value 44), so the first
    // feature amenity lands on 45 — safely past the commune block.
    const { rows: created } = await client.query(
      `INSERT INTO amenities (icon, status, serial_number, created_at, updated_at)
       VALUES ($1, 1, 0, NOW(), NOW()) RETURNING id`,
      [icon],
    );
    const id = created[0].id;
    if (Number(id) >= 21 && Number(id) <= 44) {
      throw new Error(
        `Refusing to seed amenity "${name}" at id ${id}: that id is inside the 21-44 commune block. ` +
          'The amenities identity sequence is behind the commune rows — reset it above 44 first.',
      );
    }
    await client.query(
      `INSERT INTO amenity_contents (amenity_id, language_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, FRENCH_LANGUAGE_ID, name],
    );
    results.push(`  + ${String(id).padStart(3)}  ${name}`);
  }
  return results;
}

async function main() {
  loadEnvLocal();
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('BEGIN');

    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log(`ok: ${sql.split('\n')[0].trim().slice(0, 92)}`);
    }

    console.log('\nseeding feature amenities into the existing amenities/amenity_contents tables:');
    for (const line of await seedFeatureAmenities(client)) console.log(line);

    // Prove the commune contract survived, before committing anything.
    const { rows: check } = await client.query(
      `SELECT (SELECT count(*) FROM property_amenities WHERE amenity_id BETWEEN 21 AND 44)::int AS commune_tags,
              (SELECT count(*) FROM amenities WHERE id BETWEEN 21 AND 44)::int AS commune_amenities`,
    );
    console.log(`\ncommune tags intact: ${check[0].commune_tags} property tags, ${check[0].commune_amenities} commune amenities`);
    if (check[0].commune_amenities !== 24) {
      throw new Error(`Expected 24 commune amenities (21-44), found ${check[0].commune_amenities} — rolling back.`);
    }

    await client.query('COMMIT');
    console.log('\nMigration committed.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nMigration FAILED and was rolled back: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
