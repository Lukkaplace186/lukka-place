/**
 * Batch geocoder for approved listings missing lat/lng, backing the future
 * kilometer-based radius search (see web/lib/listings.js and the audit that
 * preceded this script). Same convention as scripts/migrate-customer-
 * accounts.js — not wired into build/deploy, run manually.
 *
 * SAFE BY DEFAULT: this script never writes to Postgres unless BOTH of the
 * following are true — (1) it's invoked with --write, and (2)
 * GOOGLE_MAPS_SERVER_KEY is set in .env.local. Without a key it can't call
 * Google at all, so it prints each listing's real address query and stops
 * there — a plain address-only dry run. With a key but no --write flag, it
 * geocodes for real (so you can review real results) but still does not
 * touch the database. Only `--write` performs the actual UPDATE.
 *
 * GOOGLE_MAPS_SERVER_KEY does not exist yet as of this writing —
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (the only key on file) is HTTP-referrer-
 * restricted and Google's Geocoding API refuses it server-side (confirmed
 * live: a direct server call returns REQUEST_DENIED, "API keys with referer
 * restrictions cannot be used with this API"). Provision a *second*,
 * IP-restricted key (see the audit note) before running this with a key.
 *
 * Usage (run from web/):
 *   node scripts/geocode-listings.js            # address-only dry run, no key needed
 *   node scripts/geocode-listings.js --write     # real geocode + real UPDATE (requires GOOGLE_MAPS_SERVER_KEY)
 *
 * Loads DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME and GOOGLE_MAPS_SERVER_KEY
 * from .env.local itself (no `dotenv` dependency in this app, and this script
 * runs outside Next's own env loading).
 *
 * IPv4 forced below: GOOGLE_MAPS_SERVER_KEY is IP-restricted to the VPS's
 * IPv4 address, but this host is dual-stack and Node's default DNS result
 * order (like curl's) prefers IPv6 when both are available — confirmed live,
 * a plain fetch() to the Geocoding API from this host returned REQUEST_DENIED
 * ("not authorized... IP address 2a02:...", an IPv6 address), while `curl -4`
 * against the same key succeeded. Without this, every geocode call here
 * would silently fail the same way.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { Client } = require('pg');

dns.setDefaultResultOrder('ipv4first');

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

// Same content_language_id and commune-amenity convention as
// lib/listings.js's COMMUNE_SUBQUERY/APPROVED_FILTER — duplicated here
// rather than imported, since this CommonJS script runs outside the Next
// app's ESM module graph (matches every other one-off script in this repo).
const CONTENT_LANGUAGE_ID = 20;

async function fetchApprovedListingsMissingCoords(client) {
  const { rows } = await client.query(
    `
    SELECT p.id, pc.address, p.quartier,
      (
        SELECT ac.name FROM property_amenities pa
        JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
        WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
        LIMIT 1
      ) AS commune
    FROM properties p
    JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
    WHERE p.status = 1 AND p.approve_status = 1
      AND (p.latitude IS NULL OR p.longitude IS NULL OR p.latitude = '' OR p.longitude = '')
    ORDER BY p.id
    `,
    [CONTENT_LANGUAGE_ID],
  );
  return rows;
}

/** Real address text only — never fabricates a street address that wasn't
 *  actually given. Same field precedence as web/lib/geocoding.js's
 *  buildGeocodeQuery (the client-side map's version of this exact idea). */
function buildGeocodeQuery(listing) {
  const parts = [listing.address, listing.quartier, listing.commune, 'Kinshasa', 'DRC'].filter(Boolean);
  return parts.join(', ');
}

const RATE_LIMIT_MS = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function geocodeAddress(query, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=cd&key=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK' || !json.results?.[0]) {
    return { ok: false, status: json.status, errorMessage: json.error_message };
  }
  const result = json.results[0];
  const loc = result.geometry.location;
  return { ok: true, lat: loc.lat, lng: loc.lng, locationType: result.geometry.location_type, types: result.types };
}

async function main() {
  loadEnvLocal();
  const write = process.argv.includes('--write');
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;

  if (write && !apiKey) {
    console.error(
      'GOOGLE_MAPS_SERVER_KEY is not set — refusing --write. Provision an IP-restricted server key first (see the audit note / this file\'s header comment).',
    );
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Connected to ${process.env.DB_HOST}/${process.env.DB_NAME}`);

  const listings = await fetchApprovedListingsMissingCoords(client);
  console.log(`\n${listings.length} approved listing(s) missing coordinates.\n`);

  if (!apiKey) {
    console.log('GOOGLE_MAPS_SERVER_KEY not set — ADDRESS-ONLY dry run (no Geocoding API calls made, nothing written).\n');
  } else if (!write) {
    console.log('GOOGLE_MAPS_SERVER_KEY set — geocoding for real, but DRY RUN: nothing will be written without --write.\n');
  } else {
    console.log('GOOGLE_MAPS_SERVER_KEY set and --write passed — this run WILL update Postgres.\n');
  }

  let updated = 0;
  for (const listing of listings) {
    const query = buildGeocodeQuery(listing);
    console.log(`--- Listing #${listing.id} ---`);
    console.log(`Address query : ${query}`);

    if (!apiKey) {
      console.log('Geocode result: (skipped — no GOOGLE_MAPS_SERVER_KEY)');
      console.log(`Would update  : properties.id = ${listing.id} once a real lat/lng is resolved`);
      console.log('');
      continue;
    }

    const result = await geocodeAddress(query, apiKey);
    if (!result.ok) {
      console.log(`Geocode result: FAILED (${result.status}${result.errorMessage ? ` — ${result.errorMessage}` : ''})`);
      console.log('');
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    console.log(`Geocode result: lat=${result.lat}, lng=${result.lng} (location_type=${result.locationType}, types=${result.types.join('|')})`);
    console.log(`SQL payload   : UPDATE properties SET latitude = '${result.lat}', longitude = '${result.lng}' WHERE id = ${listing.id};`);

    if (write) {
      await client.query('UPDATE properties SET latitude = $1, longitude = $2 WHERE id = $3', [
        String(result.lat),
        String(result.lng),
        listing.id,
      ]);
      console.log('  -> WRITTEN to Postgres.');
      updated += 1;
    } else {
      console.log('  -> DRY RUN: not written. Rerun with --write once this log has been reviewed.');
    }
    console.log('');

    await sleep(RATE_LIMIT_MS);
  }

  if (write) console.log(`\nDone. ${updated}/${listings.length} row(s) updated.`);
  else console.log('\nDry run complete. No rows were written.');

  await client.end();
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
