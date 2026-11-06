/**
 * Loads hand-collected market observations from a JSON file into
 * market_observations — for a batch the team copied from a source whose
 * terms forbid robots (Zwandako, Facebook), too long to type one by one into
 * /admin/market-data/marche. Same cleaning as every collector
 * (normaliseObservation), same upsert (a row already there is refreshed, a
 * team member's manual exclusion is kept).
 *
 * SAFE BY DEFAULT: prints what it would store; --write stores.
 *
 *   node scripts/import-market-observations.js scripts/data/zwandako-2026-11-05.json
 *   node scripts/import-market-observations.js scripts/data/zwandako-2026-11-05.json --write
 *
 * File: { source, entered: 'YYYY-MM-DD', columns: [...], rows: [[...]] } with
 * columns slug, kind, price, beds, commune, quartier, daysAgo (rent per month
 * in dollars). posted_at = entered − daysAgo. The rows count as still online
 * from the import (last_seen_at) and leave the guide STILL_LISTED_DAYS later
 * unless imported again — nobody re-checks them.
 */
require('dotenv').config();

const fs = require('fs');
const market = require('../services/marketObservations');

const SOURCE_URLS = {
  zwandako: (slug) => `https://zwandako.com/immobilier/${slug}/`,
};

function rowsFromFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!market.MANUAL_SOURCES.includes(data.source)) throw new Error(`'${data.source}' is not a hand-entered source (${market.MANUAL_SOURCES.join(', ')})`);
  const entered = new Date(`${data.entered}T12:00:00Z`);
  if (Number.isNaN(entered.getTime())) throw new Error(`bad "entered" date '${data.entered}'`);
  const index = Object.fromEntries(data.columns.map((name, i) => [name, i]));
  for (const name of ['slug', 'kind', 'price', 'beds', 'commune', 'quartier', 'daysAgo']) {
    if (!(name in index)) throw new Error(`column '${name}' missing`);
  }
  const seen = new Set();
  return data.rows.map((row) => {
    const get = (name) => row[index[name]];
    const slug = String(get('slug'));
    if (seen.has(slug)) throw new Error(`duplicate slug ${slug}`);
    seen.add(slug);
    return market.normaliseObservation({
      source: data.source,
      source_ref: slug,
      source_url: SOURCE_URLS[data.source] ? SOURCE_URLS[data.source](slug) : null,
      posted_at: new Date(entered.getTime() - Number(get('daysAgo')) * 24 * 3600 * 1000),
      purpose: 'rent',
      property_kind: get('kind'),
      beds: get('beds'),
      price: get('price'),
      currency: 'USD',
      price_period: 'mois',
      commune_key: get('commune') || null,
      quartier: get('quartier') || null,
      // Optional column: true only when the advert says furnished ("meublé").
      furnished: 'furnished' in index ? get('furnished') === true : null,
      title: null,
    });
  });
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-market-observations.js <file.json> [--write]');
    process.exit(2);
  }
  const write = process.argv.includes('--write');
  const rows = rowsFromFile(file);
  const counted = rows.filter((r) => !r.excluded_reason && r.commune && r.beds >= 1 && r.beds <= 5 && market.RESIDENTIAL_KINDS.includes(r.property_kind));
  const byCommune = {};
  for (const r of counted) byCommune[r.commune] = (byCommune[r.commune] || 0) + 1;
  console.log(`MODE: ${write ? 'WRITE' : 'DRY RUN — nothing stored, re-run with --write'}`);
  console.log(`${rows.length} row(s), ${counted.length} usable in the rent guide (home, commune, 1–5 bedrooms):`, byCommune);
  for (const r of rows.filter((x) => !counted.includes(x))) {
    console.log(`  not counted: ${r.source_ref} — ${r.excluded_reason || (!r.commune ? 'no commune' : `beds ${r.beds}, kind ${r.property_kind}`)}`);
  }
  if (!write) return;
  const stored = await market.storeObservations(rows);
  console.log('stored', stored);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { rowsFromFile };
