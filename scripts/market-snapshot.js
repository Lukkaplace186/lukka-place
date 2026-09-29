/**
 * Writes (or previews) one month of the market record by hand — the same code
 * the scheduler's `market-snapshot` job runs on the 1st.
 *
 *   node scripts/market-snapshot.js 2026-09            # dry run: computes, counts, writes nothing
 *   node scripts/market-snapshot.js 2026-09 --write    # writes; a month already written is left as it was
 */
require('dotenv').config();
const { runMarketSnapshot } = require('../services/marketSnapshot');
const postgres = require('../services/postgres');

(async () => {
  const month = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}$/.test(arg));
  if (!month) {
    console.error('Usage: node scripts/market-snapshot.js YYYY-MM [--write]');
    process.exit(2);
  }
  const write = process.argv.includes('--write');
  const result = await runMarketSnapshot({ month, dryRun: !write });
  console.log(`${write ? 'WRITTEN' : 'DRY RUN'} ${result.month}: ${result.supplyRows} supply row(s), ${result.demandRows} demand row(s)`);
  await postgres.getPool().end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
