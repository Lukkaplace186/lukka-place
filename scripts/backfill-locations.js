#!/usr/bin/env node
/**
 * scripts/backfill-locations.js
 *
 * One-off migration: normalises `commune`/`quartier` on existing `listings`
 * rows against kinshasa_locations.json (services/locations.js) — for rows
 * written before that resolver existed, or saved via a path that bypassed it
 * (a direct services/db.js call, a future admin edit).
 *
 * A row belonging to an already-*published* listing is also re-synced to
 * Supabase after its local update, so a correction actually reaches the live
 * site's commune amenity tag / address / quartier column, not just SQLite.
 *
 * Usage:
 *   node scripts/backfill-locations.js              # apply changes
 *   node scripts/backfill-locations.js --dry-run     # preview only, no writes
 *   node scripts/backfill-locations.js --no-resync   # update SQLite only
 */

const dbService = require('../services/db');
const postgresService = require('../services/postgres');
const { resolveCommune, resolveQuartier } = require('../services/locations');

/**
 * Run the backfill against injected db/postgres services, so tests can point
 * this at a throwaway database instead of the real one.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] Compute and report changes; write nothing.
 * @param {boolean} [options.resync=true]  Re-sync changed *published* rows to Supabase.
 * @param {Object}  [options.db=dbService]
 * @param {Object}  [options.postgres=postgresService]
 * @returns {Promise<{scanned:number, changed:number, resynced:number, resyncFailed:number, changes:Array}>}
 */
async function runBackfill({ dryRun = false, resync = true, db = dbService, postgres = postgresService } = {}) {
  const rows = db.db
    .prepare("SELECT * FROM listings WHERE commune IS NOT NULL OR quartier IS NOT NULL")
    .all()
    .map(db.parseRow);

  const result = { scanned: rows.length, changed: 0, resynced: 0, resyncFailed: 0, changes: [] };

  for (const row of rows) {
    const resolvedCommune = row.commune ? resolveCommune(row.commune) || row.commune : row.commune;
    const resolvedQuartier = row.quartier
      ? resolveQuartier(row.quartier, resolvedCommune) || row.quartier
      : row.quartier;

    const communeChanged = resolvedCommune !== row.commune;
    const quartierChanged = resolvedQuartier !== row.quartier;
    if (!communeChanged && !quartierChanged) continue;

    result.changed += 1;
    result.changes.push({
      id: row.id,
      status: row.status,
      before: { commune: row.commune, quartier: row.quartier },
      after: { commune: resolvedCommune, quartier: resolvedQuartier },
    });

    if (dryRun) continue;

    db.db
      .prepare('UPDATE listings SET commune = ?, quartier = ? WHERE id = ?')
      .run(resolvedCommune, resolvedQuartier, row.id);

    if (resync && row.status === 'published') {
      try {
        const updatedRow = db.getListing(row.id);
        const remoteId = await postgres.syncListingToPostgres(updatedRow);
        if (remoteId) {
          db.db.prepare('UPDATE listings SET remote_property_id = ? WHERE id = ?').run(remoteId, row.id);
          result.resynced += 1;
        }
      } catch (err) {
        result.resyncFailed += 1;
        console.error(`[backfill] re-sync failed for listing #${row.id}: ${err.message}`);
      }
    }
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const resync = !process.argv.includes('--no-resync');

  console.log(`[backfill] scanning listings${dryRun ? ' (dry run — no writes)' : ''}...`);
  const result = await runBackfill({ dryRun, resync });

  console.log(
    `[backfill] scanned ${result.scanned} row(s), ${result.changed} needed normalisation` +
      `${dryRun ? ' (not written)' : ''}` +
      `${resync ? `, ${result.resynced} re-synced to Supabase` : ''}` +
      `${result.resyncFailed ? `, ${result.resyncFailed} re-sync failure(s)` : ''}.`,
  );

  for (const change of result.changes) {
    console.log(
      `  #${change.id} [${change.status}]: commune ${JSON.stringify(change.before.commune)} -> ${JSON.stringify(change.after.commune)}, ` +
        `quartier ${JSON.stringify(change.before.quartier)} -> ${JSON.stringify(change.after.quartier)}`,
    );
  }

  dbService.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
}

module.exports = { runBackfill };
