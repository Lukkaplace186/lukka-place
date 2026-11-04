/**
 * Collects market observations now (services/marketObservations.js), outside
 * the nightly job — for the first backfill and for checking one source.
 *
 * SAFE BY DEFAULT: a plain run reads the sources and prints what it would
 * store, writing nothing.
 *
 *   node scripts/collect-market-observations.js                         # dry run, every collected source
 *   node scripts/collect-market-observations.js --source imcongo        # one source
 *   node scripts/collect-market-observations.js --write                 # store
 *   node scripts/collect-market-observations.js --write --max 1200      # first SmartImmo backfill in one go
 *
 * Run the migration first (migrations/20261104_market_observations.sql).
 * On the VPS, from the engine dir, so .env (DB_PATH, Postgres) is loaded.
 */
require('dotenv').config();

const market = require('../services/marketObservations');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const write = process.argv.includes('--write');
  const sources = arg('source') ? arg('source').split(',').map((s) => s.trim()) : market.COLLECTED_SOURCES;
  for (const source of sources) {
    if (!market.COLLECTED_SOURCES.includes(source)) {
      console.error(`Unknown or hand-entered source '${source}'. Collected: ${market.COLLECTED_SOURCES.join(', ')}`);
      process.exit(2);
    }
  }
  const maxDetailFetches = Number.parseInt(arg('max'), 10) || undefined;
  console.log(`MODE: ${write ? 'WRITE' : 'DRY RUN — nothing stored, re-run with --write'}; sources: ${sources.join(', ')}`);
  const summary = await market.runCollection({ sources, write, ...(maxDetailFetches ? { maxDetailFetches } : {}) });
  if (!write) {
    for (const [source, result] of Object.entries(summary)) {
      for (const row of result.sample || []) {
        console.log(`  ${source} #${row.source_ref}: ${row.purpose} ${row.property_kind || '?'} ${row.beds ?? '?'} ch, ${row.monthly_usd ?? row.price_usd ?? '?'} $, ${row.commune || 'commune ?'}${row.furnished ? ', meublé' : ''}${row.excluded_reason ? ` — exclu: ${row.excluded_reason}` : ''}`);
      }
    }
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { ...v, sample: undefined }])), null, 2));
  process.exit(Object.values(summary).some((s) => s.error) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
