#!/usr/bin/env node
'use strict';

/**
 * Sets market_observations.area from each row's quartier / title
 * (services/marketObservations.js areaOf). Dry run by default.
 *
 *   node scripts/backfill-market-area.js           rows without an area, dry run
 *   node scripts/backfill-market-area.js --all     every row (after the alias file changed)
 *   node scripts/backfill-market-area.js --write   store it
 *
 * Needs migrations/20261112_market_observation_area.sql first.
 */

require('dotenv').config({ quiet: true });
const market = require('../services/marketObservations');
const postgres = require('../services/postgres');

(async () => {
  const write = process.argv.includes('--write');
  const all = process.argv.includes('--all');
  const result = await market.fillAreas({ all, write });
  if (result.skipped) {
    console.log(result.skipped);
    process.exit(1);
  }
  console.log(`MODE: ${write ? 'WRITE' : 'DRY RUN — nothing stored, re-run with --write'}${all ? ' (all rows)' : ''}`);
  console.log(`${result.checked} row(s) read, ${result.changed} would change${write ? `, ${result.written} written` : ''}`);
  const tally = new Map();
  for (const c of result.changes) {
    const key = `${c.commune} | ${c.area ?? '(none)'}${c.before ? ` (was ${c.before})` : ''}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  for (const [key, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(`  ${String(n).padStart(4)}  ${key}`);
  await postgres.getPool().end().catch(() => {});
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
