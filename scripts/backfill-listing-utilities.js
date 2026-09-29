#!/usr/bin/env node
/**
 * scripts/backfill-listing-utilities.js
 *
 * Fills `properties.utilities` (Kinshasa utility codes, services/utilities.js)
 * for live listings that have none, by re-running THE SAME extraction over each
 * listing's stored original WhatsApp message — the reasoning of
 * scripts/backfill-listing-features.js, which this mirrors: one definition of
 * "the message says SNEL 5/5", not a second regex that drifts from it.
 *
 * SAFETY
 *   - Only fills a blank: a row that already has codes (the agent's editor, a
 *     sync, an earlier run) is never overwritten. Safe to re-run.
 *   - Writes SQLite AND Postgres, SQLite first (the listing row is where a
 *     later re-sync would read from; the sync itself writes utilities on
 *     INSERT only, but the SQLite row is still the intake record).
 *   - Codes are re-filtered by normaliseUtilities; a model failure is counted
 *     and skipped.
 *   - Requires migrations/20260929_listing_utilities.sql.
 *
 * Usage:
 *   node scripts/backfill-listing-utilities.js --dry-run            # calls the model, writes nothing
 *   node scripts/backfill-listing-utilities.js --dry-run --limit 3
 *   node scripts/backfill-listing-utilities.js                      # write them all
 *
 * --dry-run still spends the API calls: the printed codes are what you review.
 */

require('dotenv').config();

const dbService = require('../services/db');
const postgresService = require('../services/postgres');
const openaiService = require('../services/openai');
const { normaliseUtilities } = require('../services/utilities');

async function propertiesNeedingUtilities(postgres) {
  const { rows } = await postgres.getPool().query(
    `SELECT id FROM properties
      WHERE status = 1 AND approve_status = 1
        AND (utilities IS NULL OR cardinality(utilities) = 0)
      ORDER BY id`,
  );
  return rows.map((r) => Number(r.id));
}

async function runBackfill({
  dryRun = false,
  limit,
  db = dbService,
  postgres = postgresService,
  parse = openaiService.parseMessage,
} = {}) {
  const needing = new Set(await propertiesNeedingUtilities(postgres));
  const rows = db.db
    .prepare("SELECT * FROM listings WHERE status = 'published' AND remote_property_id IS NOT NULL")
    .all()
    .map(db.parseRow)
    .filter((row) => needing.has(Number(row.remote_property_id)));
  const targets = limit ? rows.slice(0, limit) : rows;
  const result = { needing: needing.size, attempted: 0, written: 0, empty: 0, failed: 0, changes: [] };
  const pool = postgres.getPool();

  for (const row of targets) {
    if (!row.raw_text || !String(row.raw_text).trim()) {
      result.empty += 1;
      continue;
    }
    result.attempted += 1;
    let extracted;
    try {
      ({ extracted_data: extracted } = await parse(row.raw_text, { senderPhone: row.wa_id }));
    } catch (err) {
      result.failed += 1;
      console.error(`[utilities] listing #${row.id}: ${err.message}`);
      continue;
    }
    const utilities = normaliseUtilities(extracted?.utilities);
    if (!utilities.length) {
      result.empty += 1;
      continue;
    }
    result.changes.push({ id: row.id, propertyId: Number(row.remote_property_id), utilities });
    if (dryRun) continue;
    try {
      db.db.prepare('UPDATE listings SET utilities = ? WHERE id = ?').run(JSON.stringify(utilities), row.id);
      const { rowCount } = await pool.query(
        `UPDATE properties SET utilities = $1::text[]
          WHERE id = $2 AND (utilities IS NULL OR cardinality(utilities) = 0)`,
        [utilities, row.remote_property_id],
      );
      if (rowCount > 0) result.written += 1;
    } catch (err) {
      result.failed += 1;
      console.error(`[utilities] writing listing #${row.id}: ${err.message}`);
    }
  }
  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit'));
  const limit = limitArg
    ? Number.parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
    : undefined;
  if (!postgresService.isConfigured()) {
    console.error('[utilities] Postgres is not configured — nothing to do.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('[utilities] OPENAI_API_KEY is not set — this backfill is a model pass.');
    process.exit(1);
  }
  const result = await runBackfill({ dryRun, limit: Number.isFinite(limit) ? limit : undefined });
  for (const change of result.changes) {
    console.log(`  listing #${change.id} -> property #${change.propertyId}: ${change.utilities.join(', ')}`);
  }
  console.log(
    `\n[utilities] ${result.needing} live listing(s) without tags; ${result.attempted} re-read; `
      + `${dryRun ? `${result.changes.length} would be written` : `${result.written} written`}, `
      + `${result.empty} stated none, ${result.failed} failed.`,
  );
  dbService.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[utilities] fatal:', err);
    process.exit(1);
  });
}

module.exports = { runBackfill, propertiesNeedingUtilities };
