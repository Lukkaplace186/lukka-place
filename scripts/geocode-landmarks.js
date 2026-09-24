/**
 * One-off: geocode every landmark in web's gazetteer (web/lib/data/
 * kinshasa-gazetteer.json) through the same precision-checked geocoder the
 * publish path uses (services/geocoding.js geocodeQuery — a commune outline
 * or a city-level answer is refused, never kept).
 *
 * Prints `{ "<commune>|<landmark>": {lat, lng, locationType} | null }` to
 * stdout. Needs GOOGLE_MAPS_SERVER_KEY (IP-restricted to the VPS, so run it
 * there). web/scripts/build-landmark-points.mjs then keeps only points that
 * lie near their own commune and writes web/lib/data/landmark-points.json.
 *
 *   node scripts/geocode-landmarks.js /var/www/lukka-place-web/lib/data/kinshasa-gazetteer.json > landmarks.json
 */
require('dotenv').config();
const path = require('path');
const { geocodeQuery } = require('../services/geocoding');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node scripts/geocode-landmarks.js <kinshasa-gazetteer.json>');
  const apiKey = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!apiKey) throw new Error('GOOGLE_MAPS_SERVER_KEY is not set');

  const gazetteer = require(path.resolve(file));
  const out = {};
  for (const { commune, landmarks } of gazetteer) {
    for (const landmark of landmarks) {
      const query = `${landmark}, ${commune}, Kinshasa, RD Congo`;
      out[`${commune}|${landmark}`] = await geocodeQuery(query, { apiKey });
      await sleep(80);
    }
  }
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
}

main().catch((err) => {
  console.error(`[geocode-landmarks] ${err.message}`);
  process.exit(1);
});
