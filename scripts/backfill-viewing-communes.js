/**
 * Fills `viewing_requests.commune` for requests created before the column
 * existed, from the listing's own commune tag in Postgres.
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js: a plain run
 * prints what it would write and writes nothing.
 *
 *   node scripts/backfill-viewing-communes.js            # dry run
 *   node scripts/backfill-viewing-communes.js --write    # apply
 *
 * Only ever fills a NULL (db.setViewingCommuneIfMissing). A listing that no
 * longer resolves under the public gate — sold, suspended, deleted — or that
 * carries no commune tag leaves its request NULL: /admin/viewings then shows
 * it under no commune rather than under a guessed one.
 */
require('dotenv').config();

const db = require('../services/db');
const propertyRepository = require('../services/propertyRepository');

async function main() {
  const write = process.argv.includes('--write');
  const rows = db.db
    .prepare('SELECT id, property_id FROM viewing_requests WHERE commune IS NULL AND property_id IS NOT NULL ORDER BY id')
    .all();

  console.log(`SQLite   : ${db.DB_PATH}`);
  console.log(`Requests : ${rows.length} without a commune`);
  console.log(write ? 'MODE     : WRITE\n' : 'MODE     : DRY RUN — re-run with --write to apply\n');

  let filled = 0;
  let unresolved = 0;
  for (const row of rows) {
    const listing = await propertyRepository.getListingContactById(row.property_id);
    const commune = listing?.commune || null;
    if (!commune) {
      unresolved += 1;
      console.log(`  #${row.id} (property #${row.property_id}) — no commune resolvable, left NULL`);
      continue;
    }
    if (write) db.setViewingCommuneIfMissing(row.id, commune);
    filled += 1;
    console.log(`  #${row.id} (property #${row.property_id}) -> ${commune}`);
  }

  console.log(`\n${write ? 'Filled' : 'Would fill'} ${filled}, left ${unresolved} NULL.`);
  db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`backfill failed: ${err.message}`);
  process.exit(1);
});
