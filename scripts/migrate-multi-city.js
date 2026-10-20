/**
 * Cities beyond Kinshasa, in the site's Postgres (2026-10-20). Idempotent, and
 * SAFE BY DEFAULT like every other migration here: a plain run does all of it
 * inside a transaction, prints what it inserted, and ROLLS BACK.
 *
 *   node scripts/migrate-multi-city.js            # dry run — prints, writes nothing
 *   node scripts/migrate-multi-city.js --write    # apply
 *
 * What it does, in one transaction:
 *
 *  1. Creates `location_communes` — one row per commune: its amenity id, its
 *     city (property_cities.id), its key (= amenity_contents.name, unique
 *     nationwide — services/cities.js) and its display label. This is what
 *     every "is this amenity a commune?" query reads now, instead of the old
 *     `amenity_id BETWEEN 21 AND 44`, which a 25th commune would have fallen
 *     outside of (45–54 are real equipment). RLS on, no policy, nothing granted
 *     to anon/authenticated — the same lockdown as every table here.
 *  2. Registers Kinshasa's 24 existing commune amenities (21–44) in it.
 *  3. Adds each city of drc_locations.json that the Laravel taxonomy lacks
 *     (property_cities + property_city_contents in English and French, under
 *     its province's existing property_states row).
 *  4. Adds each new commune as an amenity (same icon as Kinshasa's), named by
 *     its key in both languages, and registers it.
 *
 * Laravel's id columns have no default here, so new rows take MAX(id) + 1 under
 * a table lock (the same as migrations/20261019_commercial_spaces.sql), and the
 * owned sequences are moved past the new maximum afterwards.
 *
 * The coordinates columns are filled by scripts/geocode-communes.js, not here.
 * Restart the engine after --write: it caches the taxonomy per process.
 */
require('dotenv').config();

const { Pool } = require('pg');
const { CITIES, DEFAULT_CITY, communeLabel } = require('../services/cities');

const LANG_EN = 20;
const LANG_FR = 26;
const COMMUNE_ICON = 'fas fa-map-marker-alt';

function fold(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function slugify(text) {
  return fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function nextId(client, table) {
  const { rows } = await client.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM ${table}`);
  return Number(rows[0].id);
}

async function main() {
  const write = process.argv.includes('--write');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);
  console.log(`Mode     : ${write ? 'WRITE' : 'DRY RUN (rolled back)'}\n`);

  const client = await pool.connect();
  const report = { citiesAdded: [], communesAdded: [], kinshasaRegistered: 0 };
  try {
    await client.query('BEGIN');
    // Statement-scoped timeouts only — never a session SET through the pooler.
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(
      'LOCK TABLE amenities, amenity_contents, property_cities, property_city_contents IN SHARE ROW EXCLUSIVE MODE',
    );

    // 1. The table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS location_communes (
        amenity_id  bigint PRIMARY KEY REFERENCES amenities(id) ON DELETE CASCADE,
        city_id     bigint NOT NULL REFERENCES property_cities(id),
        name        text   NOT NULL UNIQUE,
        label       text   NOT NULL,
        latitude    double precision,
        longitude   double precision,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await client.query('CREATE INDEX IF NOT EXISTS location_communes_city_idx ON location_communes (city_id)');
    await client.query('ALTER TABLE location_communes ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON location_communes FROM anon, authenticated');

    // City ids by folded name, either language.
    const { rows: cityRows } = await client.query('SELECT city_id, name FROM property_city_contents');
    const cityIds = new Map(cityRows.map((r) => [fold(r.name), Number(r.city_id)]));
    const { rows: stateRows } = await client.query('SELECT state_id, name FROM property_state_contents');
    const stateIds = new Map(stateRows.map((r) => [fold(r.name), Number(r.state_id)]));
    const { rows: countryRows } = await client.query(
      "SELECT country_id FROM property_country_contents WHERE name ILIKE '%Congo%' LIMIT 1",
    );
    const countryId = Number(countryRows[0].country_id);
    const { rows: known } = await client.query('SELECT name FROM location_communes');
    const registered = new Set(known.map((r) => r.name));

    // 2. Kinshasa's existing 24.
    const kinshasaCityId = cityIds.get(fold(DEFAULT_CITY));
    if (!kinshasaCityId) throw new Error('No property_cities row for Kinshasa');
    for (const key of Object.keys(CITIES[DEFAULT_CITY].communes)) {
      if (registered.has(key)) continue;
      const { rows } = await client.query(
        `SELECT amenity_id FROM amenity_contents WHERE language_id = $1 AND name = $2 AND amenity_id BETWEEN 21 AND 44`,
        [LANG_FR, key],
      );
      if (!rows.length) throw new Error(`Kinshasa commune "${key}" has no amenity between 21 and 44`);
      await client.query(
        'INSERT INTO location_communes (amenity_id, city_id, name, label) VALUES ($1, $2, $3, $4)',
        [rows[0].amenity_id, kinshasaCityId, key, key],
      );
      registered.add(key);
      report.kinshasaRegistered += 1;
    }

    let serial = Number((await client.query('SELECT COALESCE(MAX(serial_number), 0) AS s FROM amenities WHERE icon = $1', [COMMUNE_ICON])).rows[0].s);

    for (const [name, city] of Object.entries(CITIES)) {
      if (name === DEFAULT_CITY) continue;

      // 3. The city.
      let cityId = cityIds.get(fold(name));
      if (!cityId) {
        const stateId = stateIds.get(fold(city.province));
        if (!stateId) throw new Error(`No property_states row for province "${city.province}" (${name})`);
        cityId = await nextId(client, 'property_cities');
        const { rows: s } = await client.query('SELECT COALESCE(MAX(serial_number), 0) + 1 AS s FROM property_cities');
        await client.query(
          `INSERT INTO property_cities (id, country_id, state_id, image, status, serial_number, featured, created_at, updated_at)
           VALUES ($1, $2, $3, '', 1, $4, 0, NOW(), NOW())`,
          [cityId, countryId, stateId, s[0].s],
        );
        for (const lang of [LANG_EN, LANG_FR]) {
          await client.query(
            `INSERT INTO property_city_contents (id, city_id, language_id, name, slug, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [await nextId(client, 'property_city_contents'), cityId, lang, name, slugify(name)],
          );
        }
        cityIds.set(fold(name), cityId);
        report.citiesAdded.push(`${name} (#${cityId}, ${city.province})`);
      }

      // 4. Its communes.
      for (const key of Object.keys(city.communes)) {
        if (registered.has(key)) continue;
        const amenityId = await nextId(client, 'amenities');
        serial += 1;
        await client.query(
          'INSERT INTO amenities (id, icon, status, serial_number, created_at, updated_at) VALUES ($1, $2, 1, $3, NOW(), NOW())',
          [amenityId, COMMUNE_ICON, serial],
        );
        for (const lang of [LANG_EN, LANG_FR]) {
          await client.query(
            'INSERT INTO amenity_contents (id, amenity_id, language_id, name, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())',
            [await nextId(client, 'amenity_contents'), amenityId, lang, key],
          );
        }
        await client.query(
          'INSERT INTO location_communes (amenity_id, city_id, name, label) VALUES ($1, $2, $3, $4)',
          [amenityId, cityId, key, communeLabel(key)],
        );
        registered.add(key);
        report.communesAdded.push(`${key} → amenity #${amenityId}, ${name}`);
      }
    }

    // Keep each owned sequence ahead of the ids just taken by hand.
    for (const table of ['amenities', 'amenity_contents', 'property_cities', 'property_city_contents']) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))
          WHERE pg_get_serial_sequence($1, 'id') IS NOT NULL`,
        [table],
      );
    }

    console.log(`Kinshasa communes registered : ${report.kinshasaRegistered}`);
    console.log(`Cities added                 : ${report.citiesAdded.length}`);
    report.citiesAdded.forEach((c) => console.log(`  + ${c}`));
    console.log(`Communes added               : ${report.communesAdded.length}`);
    report.communesAdded.forEach((c) => console.log(`  + ${c}`));

    if (write) {
      await client.query('COMMIT');
      console.log('\nCommitted. Restart the engine (pm2 restart lukka-place-engine) so it reloads the taxonomy.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — rolled back. Re-run with --write to apply.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
