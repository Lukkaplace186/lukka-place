#!/usr/bin/env node
/**
 * scripts/resync-published-listings.js
 *
 * Re-syncs every locally-`published` listing to Postgres via the real,
 * already-trusted syncListingToPostgres() — the same function every new
 * listing publish already goes through. This exists for a narrower gap
 * than scripts/backfill-locations.js's own resync step: that script only
 * re-syncs a row when *normalising* commune/quartier text actually changes
 * it, so a row whose SQLite commune was already correct — but which was
 * never successfully synced to Postgres in the first place, or was synced
 * before the commune-amenity-tag feature (COMMUNE_AMENITY_IDS) existed —
 * is silently skipped. Confirmed directly against the live data before
 * writing this: 3 of 5 published listings have `remote_property_id IS
 * NULL` (never reached Postgres at all), and the other 2 already have real,
 * agent-confirmed commune values in SQLite that simply never got tagged.
 *
 * Deliberately does NOT infer a commune from free-text title/description —
 * every row here already carries a real, structured commune value a human
 * (the submitting agent) confirmed during WhatsApp intake. Re-syncing is
 * re-applying already-trusted data, not guessing new data.
 *
 * Usage:
 *   node scripts/resync-published-listings.js              # apply
 *   node scripts/resync-published-listings.js --dry-run     # preview only
 */
// Same bootstrap as index.js — services/postgres.js reads DB_HOST etc.
// straight off process.env with no dotenv call of its own, so this script
// (run standalone, not through index.js) would otherwise silently no-op
// via isConfigured()'s "skipping sync" path. Confirmed directly: running
// without this first printed that skip message for every row.
require('dotenv').config();

const dbService = require('../services/db');
const postgresService = require('../services/postgres');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = dbService.db.prepare("SELECT * FROM listings WHERE status = 'published'").all().map(dbService.parseRow);

  console.log(`[resync] ${rows.length} published listing(s)${dryRun ? ' (dry run — no writes)' : ''}`);

  for (const row of rows) {
    const label = `#${row.id} (${row.commune || 'commune inconnue'}${row.quartier ? `, ${row.quartier}` : ''})`;
    if (dryRun) {
      console.log(`  ${label}: would sync -> remote_property_id=${row.remote_property_id || '(new)'}`);
      continue;
    }
    try {
      const remoteId = await postgresService.syncListingToPostgres(row);
      if (remoteId && remoteId !== row.remote_property_id) {
        dbService.db.prepare('UPDATE listings SET remote_property_id = ? WHERE id = ?').run(remoteId, row.id);
      }
      console.log(`  ${label}: synced -> remote_property_id=${remoteId}`);
    } catch (err) {
      console.error(`  ${label}: FAILED -> ${err.message}`);
    }
  }

  dbService.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[resync] fatal:', err);
    process.exit(1);
  });
}

module.exports = { main };
