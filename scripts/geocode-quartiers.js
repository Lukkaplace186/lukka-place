/**
 * Builds kinshasa_quartier_points.json: one checked point per Kinshasa
 * quartier and alias, through the same lookup the publish path uses
 * (services/geocoding.js lookupPlaceTerm — a neighbourhood whose NAME matches,
 * or the median of ≥3 name-matching places that agree within 1.5 km, always
 * inside the commune's own box). A name with neither is stored as null:
 * "looked, nothing found", so publishing does not ask again. Nothing is typed
 * by hand.
 *
 * Needs GOOGLE_MAPS_SERVER_KEY (IP-restricted to the VPS, so run it there);
 * about one Places text search per name.
 *
 *   node scripts/geocode-quartiers.js > /tmp/quartier-points.json
 *   node scripts/geocode-quartiers.js --only=Ngaliema   # one commune
 *   node scripts/geocode-quartiers.js --recheck=old.json # re-apply the commune
 *       check (services/geocoding.js pointInCommune) to a built file without
 *       paying for the Places searches again
 *
 * Then copy the file to kinshasa_quartier_points.json (engine root) AND
 * web/lib/data/quartier-points.json (web's client-side fallback).
 */
require('dotenv').config({ quiet: true });
const cities = require('../services/cities');
const { LOCATIONS } = require('../services/locations');
const fs = require('fs');
const { lookupPlaceTerm, areaBox, pointKey, pointInCommune } = require('../services/geocoding');
const aliasData = require('../kinshasa_quartier_aliases.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');
  const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
  const recheck = (process.argv.find((a) => a.startsWith('--recheck=')) || '').slice(10) || null;
  if (recheck) return recheckFile(recheck, apiKey);

  const names = new Map(); // key -> {commune, name}
  for (const commune of cities.communesOfCity(cities.DEFAULT_CITY)) {
    if (only && commune !== only) continue;
    for (const quartier of LOCATIONS[commune] || []) names.set(pointKey(commune, quartier), { commune, name: quartier });
  }
  for (const alias of aliasData.aliases) {
    for (const commune of alias.communes) {
      if (commune === 'Kinshasa' && alias.communes.length > 1) continue;
      if (only && commune !== only) continue;
      if (!LOCATIONS[commune]) continue;
      names.set(pointKey(commune, alias.name), { commune, name: alias.name });
    }
  }

  const points = {};
  const tally = { neighborhood: 0, cluster: 0, none: 0 };
  for (const [key, { commune, name }] of names) {
    const row = { commune, quartier: name };
    const box = await areaBox(row, { apiKey });
    const hit = await lookupPlaceTerm(name, row, { apiKey }, box);
    points[key] = hit
      ? { lat: Number(hit.lat.toFixed(6)), lng: Number(hit.lng.toFixed(6)), how: hit.how, ...(hit.size ? { size: hit.size } : {}) }
      : null;
    tally[hit ? hit.how : 'none'] += 1;
    console.error(`${key}: ${hit ? `${hit.how}${hit.size ? ` ×${hit.size}` : ''} (${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)})` : '—'}`);
    await sleep(60);
  }

  const out = {
    _about: 'Checked points for Kinshasa quartiers and aliases, keyed "<commune>|<placeKey(name)>". Built by scripts/geocode-quartiers.js through services/geocoding.js lookupPlaceTerm (Places API: a name-matching neighbourhood, or the median of >=3 name-matching places within 1.5 km, inside the commune). null = looked, nothing trustworthy. Never edit by hand; web/lib/data/quartier-points.json is a copy.',
    built_at: new Date().toISOString().slice(0, 10),
    points,
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  console.error(`\n${names.size} names: ${tally.neighborhood} neighbourhood, ${tally.cluster} cluster, ${tally.none} none`);
}

async function recheckFile(file, apiKey) {
  const built = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^[^{]*/, ''));
  let dropped = 0;
  for (const [key, point] of Object.entries(built.points)) {
    if (!point) continue;
    const commune = key.split('|')[0];
    if (await pointInCommune(point, { commune }, { apiKey })) continue;
    console.error(`${key}: (${point.lat}, ${point.lng}) is not in ${commune} — dropped`);
    built.points[key] = null;
    dropped += 1;
    await sleep(40);
  }
  built.checked_at = new Date().toISOString().slice(0, 10);
  process.stdout.write(`${JSON.stringify(built, null, 1)}
`);
  console.error(`${dropped} point(s) dropped`);
}

main().catch((err) => {
  console.error(`[geocode-quartiers] ${err.message}`);
  process.exit(1);
});
