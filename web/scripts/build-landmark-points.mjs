/**
 * Turns the engine's raw landmark geocodes (scripts/geocode-landmarks.js,
 * run on the VPS) into web/lib/data/landmark-points.json.
 *
 * A geocode is kept only when it lies within MAX_KM of its own commune's
 * verified centroid (KINSHASA_COMMUNE_CENTROIDS). Google answering "St Luc"
 * with a church in another city is a match on the words, not the place, and
 * a wrong point is worse than none: the map then opens on the commune, and no
 * distance is printed. Nothing is typed by hand.
 *
 *   node web/scripts/build-landmark-points.mjs landmarks-raw.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_KM = 5;
const here = path.dirname(fileURLToPath(import.meta.url));

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// lib/geocoding.js is ESM with an `@/` import graph; read the centroid table
// out of its source rather than importing the module.
const geocodingSource = fs.readFileSync(path.join(here, '../lib/geocoding.js'), 'utf8');
const table = geocodingSource.match(/KINSHASA_COMMUNE_CENTROIDS\s*=\s*(\{[\s\S]*?\n\});/);
if (!table) throw new Error('KINSHASA_COMMUNE_CENTROIDS not found in lib/geocoding.js');
// eslint-disable-next-line no-new-func
const centroids = new Function(`return ${table[1]}`)();

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
let kept = 0;
let refused = 0;
for (const [key, point] of Object.entries(raw)) {
  if (!point) continue;
  const commune = key.split('|')[0];
  const centroid = centroids[commune];
  if (!centroid) continue;
  const km = distanceKm(point, centroid);
  if (km > MAX_KM) {
    refused += 1;
    console.error(`refused ${key}: ${km.toFixed(1)} km from ${commune}`);
    continue;
  }
  out[key] = { lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) };
  kept += 1;
}

const target = path.join(here, '../lib/data/landmark-points.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.error(`kept ${kept}, refused ${refused} -> ${target}`);
