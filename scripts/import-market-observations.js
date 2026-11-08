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
 *
 * Optional columns (2026-11-08, one paste = prices AND agents, like the
 * console's "Coller des annonces"):
 *   purpose  'rent' (default) or 'sale' — a sale's price is the total in $;
 *   phone    the poster's number as written in the advert (0812…, +243…);
 *   name     the poster's name, agency  their agency, url  the post's link.
 * A row with a phone puts its poster on the agent list (market_prospects,
 * /admin/market-data/prospects) in the SAME transaction as the prices: one
 * row per number, a name/agency the team already has is never overwritten,
 * only adverts new to this import are counted. Phones never reach
 * market_observations. A phone that is not a number is an error, not a skip:
 * the file was typed from the advert and must be fixed.
 */
require('dotenv').config();

const fs = require('fs');
const market = require('../services/marketObservations');
const prospects = require('../services/marketProspects');
const postgres = require('../services/postgres');

const SOURCE_URLS = {
  zwandako: (slug) => `https://zwandako.com/immobilier/${slug}/`,
};

function readFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!market.MANUAL_SOURCES.includes(data.source)) throw new Error(`'${data.source}' is not a hand-entered source (${market.MANUAL_SOURCES.join(', ')})`);
  const entered = new Date(`${data.entered}T12:00:00Z`);
  if (Number.isNaN(entered.getTime())) throw new Error(`bad "entered" date '${data.entered}'`);
  const index = Object.fromEntries(data.columns.map((name, i) => [name, i]));
  for (const name of ['slug', 'kind', 'price', 'beds', 'commune', 'quartier', 'daysAgo']) {
    if (!(name in index)) throw new Error(`column '${name}' missing`);
  }
  return { data, entered, index };
}

function rowsFromFile(file) {
  const { data, entered, index } = readFile(file);
  const seen = new Set();
  return data.rows.map((row) => {
    const get = (name) => row[index[name]];
    const slug = String(get('slug'));
    if (seen.has(slug)) throw new Error(`duplicate slug ${slug}`);
    seen.add(slug);
    const purpose = 'purpose' in index && get('purpose') === 'sale' ? 'sale' : 'rent';
    // An advert copied without its date (a portal page, a shared post) has
    // daysAgo null: posted_at stays NULL rather than becoming the entry day.
    const daysAgo = get('daysAgo');
    const undated = daysAgo === null || daysAgo === undefined || daysAgo === '';
    return market.normaliseObservation({
      source: data.source,
      source_ref: slug,
      source_url: SOURCE_URLS[data.source] ? SOURCE_URLS[data.source](slug) : (('url' in index && get('url')) || null),
      posted_at: undated ? null : new Date(entered.getTime() - Number(daysAgo) * 24 * 3600 * 1000),
      purpose,
      property_kind: get('kind'),
      beds: get('beds'),
      price: get('price'),
      currency: 'USD',
      price_period: purpose === 'sale' ? 'total' : 'mois',
      commune_key: get('commune') || null,
      quartier: get('quartier') || null,
      // Optional column: true when the advert says furnished ("meublé"), false
      // when it says empty ("vide", "non meublé"); anything else is not stated.
      furnished: 'furnished' in index && typeof get('furnished') === 'boolean' ? get('furnished') : null,
      title: null,
    });
  });
}

/** The posters of a file's adverts: `[{ ref, phone, name, agency, url }]` (rows with a phone only). */
function prospectsFromFile(file) {
  const { data, index } = readFile(file);
  if (!('phone' in index)) return [];
  const out = [];
  for (const row of data.rows) {
    const get = (name) => (name in index ? row[index[name]] : null);
    const written = get('phone');
    if (written === null || written === undefined || String(written).trim() === '') continue;
    const phone = prospects.prospectPhone(written);
    if (!phone) throw new Error(`slug ${get('slug')}: '${written}' is not a phone number`);
    out.push({ ref: String(get('slug')), phone, name: get('name'), agency: get('agency'), url: get('url') || null });
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/import-market-observations.js <file.json> [--write]');
    process.exit(2);
  }
  const write = process.argv.includes('--write');
  const rows = rowsFromFile(file);
  const posters = prospectsFromFile(file);
  const counted = rows.filter((r) => !r.excluded_reason && r.commune && r.beds >= 1 && r.beds <= 5 && market.RESIDENTIAL_KINDS.includes(r.property_kind));
  const byCommune = {};
  for (const r of counted) byCommune[r.commune] = (byCommune[r.commune] || 0) + 1;
  console.log(`MODE: ${write ? 'WRITE' : 'DRY RUN — nothing stored, re-run with --write'}`);
  console.log(`${rows.length} row(s), ${counted.length} usable in the rent guide (home, commune, 1–5 bedrooms):`, byCommune);
  for (const r of rows.filter((x) => !counted.includes(x))) {
    console.log(`  not counted: ${r.source_ref} — ${r.excluded_reason || (!r.commune ? 'no commune' : `beds ${r.beds}, kind ${r.property_kind}`)}`);
  }
  const grouped = prospects.groupProspects(posters, new Set(posters.map((p) => p.ref)));
  console.log(`${grouped.length} agent(s) for the prospects list (${posters.length} advert(s) with a number):`);
  for (const p of grouped) console.log(`  +${p.phone} ${p.name || '(sans nom)'}${p.agency ? ` — ${p.agency}` : ''} · ${p.refs.length} annonce(s)`);
  if (!write) return;
  const source = rows[0]?.source;
  const client = await postgres.getPool().connect();
  try {
    await client.query('BEGIN');
    // Known before this import: only the adverts it adds count for a poster.
    const known = rows.length ? await market.knownRefs(source, { pool: client }) : new Set();
    const stored = await market.storeObservations(rows, { pool: client });
    const newRefs = new Set(rows.map((r) => r.source_ref).filter((ref) => !known.has(ref)));
    const saved = await prospects.saveProspects(client, prospects.groupProspects(posters, newRefs), { source });
    await client.query('COMMIT');
    console.log('stored', stored, 'prospects', saved);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { rowsFromFile, prospectsFromFile };
