/**
 * Fills blank `properties.latitude`/`longitude` through the same publish-time
 * geocoder new listings go through (services/geocoding.js) — one definition of
 * "where a listing is", not a second one for old rows.
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js:
 *
 *   node scripts/backfill-listing-coordinates.js           # geocode and print, write nothing
 *   node scripts/backfill-listing-coordinates.js --write   # store what resolved
 *
 * Covers live rows (`status = 1`) that are approved or still pending
 * moderation, so a listing approved tomorrow is already placed. Rows that
 * already carry coordinates are never touched, including ones an admin set by
 * hand. A row that does not resolve at place precision stays blank and the map
 * keeps placing it at its commune centroid — nothing is invented to fill it.
 *
 * Needs GOOGLE_MAPS_SERVER_KEY in .env (IP-restricted to this server; see the
 * header of services/geocoding.js for why the browser key cannot be used).
 */
require('dotenv').config();

const { Pool } = require('pg');
const { buildGeocodeQueries, geocodeListingRow, storeListingCoordinates } = require('../services/geocoding');

const CONTENT_LANGUAGE_ID = 20;
const RATE_LIMIT_MS = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const write = process.argv.includes('--write');
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) {
    console.error('GOOGLE_MAPS_SERVER_KEY is not set — nothing can be geocoded. Add it to .env first.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.quartier, p.reference, p.approve_status,
         (SELECT ac.name FROM property_amenities pa
            JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
           WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
           LIMIT 1) AS commune
       FROM properties p
       WHERE p.status = 1 AND p.approve_status IN (0, 1)
         AND (NULLIF(TRIM(p.latitude), '') IS NULL OR NULLIF(TRIM(p.longitude), '') IS NULL)
       ORDER BY p.id`,
      [CONTENT_LANGUAGE_ID],
    );

    console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);
    console.log(`Mode     : ${write ? 'WRITE' : 'DRY RUN — nothing will be written (re-run with --write)'}`);
    console.log(`${rows.length} live listing(s) without coordinates.\n`);

    const tally = { geocoded: 0, unresolved: 0, noQuery: 0, kept: 0 };
    for (const row of rows) {
      const queries = buildGeocodeQueries(row);
      const label = `#${row.id}${row.approve_status === 1 ? '' : ' (pending)'}`;
      if (queries.length === 0) {
        console.log(`${label}: no quartier, commune or landmark reference — left blank`);
        tally.noQuery += 1;
        continue;
      }

      if (write) {
        const result = await storeListingCoordinates(pool, row.id, row, { apiKey });
        if (result.status === 'geocoded') {
          tally.geocoded += 1;
          console.log(`${label}: WRITTEN (${result.lat}, ${result.lng}) via "${result.query}"`);
        } else if (result.status === 'kept') {
          tally.kept += 1;
          console.log(`${label}: coordinates appeared meanwhile — kept`);
        } else {
          tally.unresolved += 1;
          console.log(`${label}: no place-level match for ${JSON.stringify(queries)} — left blank`);
        }
      } else {
        const point = await geocodeListingRow(row, { apiKey });
        if (point) {
          tally.geocoded += 1;
          console.log(`${label}: would write (${point.lat}, ${point.lng}) via "${point.query}" [${point.locationType}]`);
        } else {
          tally.unresolved += 1;
          console.log(`${label}: no place-level match for ${JSON.stringify(queries)} — would stay blank`);
        }
      }
      await sleep(RATE_LIMIT_MS);
    }

    console.log(
      `\n${write ? 'Done' : 'Dry run done'}: ${tally.geocoded} ${write ? 'written' : 'resolvable'}, ` +
        `${tally.unresolved} unresolved, ${tally.noQuery} with nothing to geocode, ${tally.kept} kept.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
