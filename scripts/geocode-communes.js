/**
 * Centroids for every city and commune outside Kinshasa (drc_locations.json),
 * fetched live from Google's Geocoding API with GOOGLE_MAPS_SERVER_KEY — the
 * same source Kinshasa's KINSHASA_COMMUNE_CENTROIDS came from. Run on the VPS
 * (the key is IP-restricted to it).
 *
 *   node scripts/geocode-communes.js                 # prints JSON, writes nothing
 *   node scripts/geocode-communes.js --out file.json # also saves it
 *   node scripts/geocode-communes.js --write         # also fills location_communes.latitude/longitude
 *
 * A point is kept only when Google answers with a place of commune / locality
 * level AND it lies within MAX_KM of the city's own geocoded centre — a
 * "Kalamu, Boma" that came back in Kinshasa is dropped and reported, never
 * stored. A commune with no acceptable answer gets null: the map then places
 * its listings at the city centre, flagged approximate, exactly like an
 * unplaceable Kinshasa listing. Nothing is typed in from memory.
 */
require('dotenv').config();

const https = require('https');
const fs = require('fs');
const { CITIES, DEFAULT_CITY, communeLabel } = require('../services/cities');

const KEY = process.env.GOOGLE_MAPS_SERVER_KEY;
const MAX_KM = 30;
const MAX_KM_UNNAMED = 10;
const ACCEPTED_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'sublocality_level_2', 'neighborhood',
  'administrative_area_level_2', 'administrative_area_level_3', 'administrative_area_level_4',
  'political', 'colloquial_area',
]);

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { family: 4, timeout: 15000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function onTimeout() { this.destroy(new Error('timeout')); });
  });
}

function km(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function geocode(query, expectLabel = null) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=cd&key=${encodeURIComponent(KEY)}`;
  const json = await getJson(url);
  if (['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT'].includes(json.status)) {
    throw new Error(`Geocoding refused: ${json.status} ${json.error_message || ''}`);
  }
  const result = json.status === 'OK' ? json.results[0] : null;
  if (!result) return null;
  // A building is accepted only when Google itself ties it to the commune: the
  // commune office, or an address that names "commune <label>".
  const tiedToCommune = expectLabel && (
    (result.types || []).includes('local_government_office')
    || new RegExp(`commune\\s+(de\\s+)?${expectLabel}`, 'i').test(result.formatted_address)
  );
  if (!tiedToCommune && !(result.types || []).some((t) => ACCEPTED_TYPES.has(t))) {
    return { rejected: `type ${result.types.join(',')} — ${result.formatted_address} (${result.geometry.location.lat.toFixed(5)}, ${result.geometry.location.lng.toFixed(5)})` };
  }
  const { lat, lng } = result.geometry.location;
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), address: result.formatted_address, types: result.types };
}

async function main() {
  if (!KEY) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
  const out = {};
  const problems = [];
  for (const [name, city] of Object.entries(CITIES)) {
    if (name === DEFAULT_CITY) continue;
    const center = await geocode(`${name}, RD Congo`);
    if (!center || center.rejected) {
      problems.push(`${name}: city not geocoded (${center?.rejected || 'no result'})`);
      out[name] = { center: null, communes: {} };
      continue;
    }
    out[name] = { center: { lat: center.lat, lng: center.lng }, address: center.address, communes: {} };
    for (const key of Object.keys(city.communes)) {
      const label = communeLabel(key);
      // "Commune de Lubumbashi" names the commune, not the city.
      let point = await geocode(`Commune de ${label}, ${name}, RD Congo`, label);
      if (!point || point.rejected || km(center, point) < 0.05) {
        const second = await geocode(`${label}, ${name}, RD Congo`, label);
        if (second && !second.rejected) point = second;
        else if (!point && second) point = second;
      }
      if (!point || point.rejected) {
        problems.push(`${key} (${name}): ${point?.rejected || 'no result'}`);
        out[name].communes[key] = null;
        continue;
      }
      const distance = km(center, point);
      const sameAsCity = distance < 0.05 && label !== name;
      // An answer whose address does not name the city may be a village of the
      // same name ("Lukonga, RD Congo", 25 km out): it must then be close.
      const namesCity = new RegExp(name.replace('-', '.?'), 'i').test(point.address || '');
      const tooFar = distance > MAX_KM || (!namesCity && distance > MAX_KM_UNNAMED);
      if (tooFar || sameAsCity) {
        problems.push(`${key} (${name}): ${sameAsCity ? 'Google returned the city centre' : `${distance.toFixed(1)} km from the city`} — ${point.address}`);
        out[name].communes[key] = null;
        continue;
      }
      out[name].communes[key] = { lat: point.lat, lng: point.lng, address: point.address };
    }
  }

  console.log(JSON.stringify(out, null, 2));
  console.error(`\n${problems.length} commune(s)/cities without an accepted point:`);
  problems.forEach((p) => console.error(`  - ${p}`));

  const outIdx = process.argv.indexOf('--out');
  if (outIdx > -1 && process.argv[outIdx + 1]) fs.writeFileSync(process.argv[outIdx + 1], JSON.stringify(out, null, 2));

  if (process.argv.includes('--write')) {
    const { Pool } = require('pg');
    const pool = new Pool({
      host: process.env.DB_HOST,
      port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
    let n = 0;
    for (const cityData of Object.values(out)) {
      for (const [key, point] of Object.entries(cityData.communes)) {
        if (!point) continue;
        const { rowCount } = await pool.query(
          'UPDATE location_communes SET latitude = $1, longitude = $2 WHERE name = $3',
          [point.lat, point.lng, key],
        );
        n += rowCount;
      }
    }
    await pool.end();
    console.error(`location_communes: ${n} row(s) updated`);
  }
}

main().catch((err) => {
  console.error('geocode-communes failed:', err.message);
  process.exit(1);
});
