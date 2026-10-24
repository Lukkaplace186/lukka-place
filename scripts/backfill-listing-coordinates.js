/**
 * Fills blank `properties.latitude`/`longitude` through the same publish-time
 * geocoder new listings go through (services/geocoding.js) — one definition of
 * "where a listing is", not a second one for old rows.
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js:
 *
 *   node scripts/backfill-listing-coordinates.js           # geocode and print, write nothing
 *   node scripts/backfill-listing-coordinates.js --write   # store what resolved
 *   node scripts/backfill-listing-coordinates.js --recompute [--write] [--ids=387,301]
 *       # re-resolve rows that ALREADY have coordinates through today's
 *       # name-checked lookup and print how far each would move; --write
 *       # replaces those that moved more than --min-km (default 0.3) to a
 *       # point whose NAME was checked (Places), on a row with a commune.
 *       # An unchecked Geocoding answer never replaces a stored point.
 *       # Never touches a project unit (exact building point) or a row whose
 *       # coordinates an admin edited (console audit log).
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
const { buildGeocodeQueries, geocodeListingRow, storeListingCoordinates, distanceKm } = require('../services/geocoding');

const CONTENT_LANGUAGE_ID = 20;
const RATE_LIMIT_MS = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const write = process.argv.includes('--write');
  if (process.argv.includes('--recompute')) return recompute(write);
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
           WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
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

function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function recompute(write) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
  const minKm = Number.parseFloat(argValue('min-km') ?? '0.3');
  const ids = (argValue('ids') || '').split(',').map((v) => Number.parseInt(v, 10)).filter(Number.isFinite);
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
      `SELECT p.id, p.quartier, p.reference, p.approve_status, p.latitude, p.longitude,
         (to_jsonb(p) ->> 'development_id') AS development_id,
         (SELECT ac.name FROM property_amenities pa
            JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
           WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
           LIMIT 1) AS commune
       FROM properties p
       WHERE p.status = 1 AND p.approve_status IN (0, 1)
         AND NULLIF(TRIM(p.latitude), '') IS NOT NULL AND NULLIF(TRIM(p.longitude), '') IS NOT NULL
         AND ($2::bigint[] IS NULL OR p.id = ANY($2::bigint[]))
       ORDER BY p.id`,
      [CONTENT_LANGUAGE_ID, ids.length ? ids : null],
    );
    let adminEdited = new Set();
    try {
      const audit = await pool.query(
        `SELECT DISTINCT entity_id::text AS id FROM console_admin_audit_log
          WHERE entity_type = 'listing' AND details::text ~* 'latitude|longitude'`,
      );
      adminEdited = new Set(audit.rows.map((r) => r.id));
    } catch (err) {
      console.log(`(audit log not readable: ${err.message} — no row is treated as admin-set)`);
    }

    console.log(`Mode: RECOMPUTE ${write ? `WRITE (moves > ${minKm} km)` : 'DRY RUN'} — ${rows.length} row(s)
`);
    const tally = { moved: 0, same: 0, unresolved: 0, skipped: 0, written: 0 };
    for (const row of rows) {
      const label = `#${row.id} [${row.quartier || '—'} | ${row.reference || '—'} | ${row.commune || '—'}]`;
      if (row.development_id || adminEdited.has(String(row.id))) {
        tally.skipped += 1;
        console.log(`${label}: kept (${row.development_id ? 'project unit' : 'admin-set'})`);
        continue;
      }
      const old = { lat: Number.parseFloat(row.latitude), lng: Number.parseFloat(row.longitude) };
      const point = await geocodeListingRow(row, { apiKey });
      if (!point) {
        tally.unresolved += 1;
        console.log(`${label}: no checked match — current point kept (${old.lat}, ${old.lng})`);
        continue;
      }
      const km = distanceKm(old, point);
      const how = `${point.how}${point.term ? ` "${point.term}"` : ''}${point.matched ? ` → "${point.matched}"` : ''}`;
      if (km <= minKm) {
        tally.same += 1;
        console.log(`${label}: same place (${km.toFixed(2)} km) via ${how}`);
        continue;
      }
      if (point.how === 'geocoded' || !row.commune) {
        tally.unresolved += 1;
        console.log(`${label}: unchecked answer ${km.toFixed(2)} km away (${point.how}${row.commune ? '' : ', no commune'}) — current point kept`);
        continue;
      }
      tally.moved += 1;
      console.log(`${label}: MOVES ${km.toFixed(2)} km (${old.lat.toFixed(5)}, ${old.lng.toFixed(5)}) -> (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}) via ${how}`);
      if (write) {
        const res = await pool.query(
          'UPDATE properties SET latitude = $1, longitude = $2 WHERE id = $3 AND latitude = $4 AND longitude = $5',
          [String(point.lat), String(point.lng), row.id, row.latitude, row.longitude],
        );
        tally.written += res.rowCount;
      }
      await sleep(RATE_LIMIT_MS);
    }
    console.log(`
Done: ${tally.moved} would move${write ? ` (${tally.written} written)` : ''}, ${tally.same} unchanged, ${tally.unresolved} unresolved (kept), ${tally.skipped} kept by rule.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
