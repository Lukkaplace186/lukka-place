/**
 * Carries the two entry-cost columns the storefront has never been able to
 * show to Supabase, and backfills them from the intake engine's own SQLite.
 *
 * Kinshasa quotes an entry cost as "Garantie : 3 + 1 + 1" — three SEPARATE
 * figures (refundable deposit, rent paid in advance, agency commission). The
 * engine has parsed and stored them apart since the fix that stopped summing
 * them (a "3 + 1 + 1" stored as `deposit_months = 5` overstated the deposit by
 * two months and was read back to agents that way). But `properties` only ever
 * had `deposit_months`, so `syncListingToPostgres` had to drop the other two
 * and the public site could only ever say "Garantie 3 mois".
 *
 * This script is the missing half:
 *   1. ALTER TABLE properties ADD COLUMN advance_months / commission_months.
 *   2. Copy both from `listings` (SQLite) onto the property each listing was
 *      published as, via `listings.remote_property_id`.
 *
 * Additive and re-runnable: both statements are IF NOT EXISTS, and the
 * backfill only ever fills a column that is still NULL, so a value later
 * corrected in Postgres is never overwritten by a stale intake row.
 *
 * SAFE BY DEFAULT — a plain run reports what it WOULD do and writes nothing:
 *
 *   node scripts/migrate-entry-cost-columns.js            # dry run
 *   node scripts/migrate-entry-cost-columns.js --write    # ALTER + backfill
 *
 * Same convention as scripts/backfill-locations.js and the other one-off
 * scripts here: not wired into the boot path, run by hand.
 */
require('dotenv').config();

const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');

const COLUMNS = ['advance_months', 'commission_months'];

function pgPool() {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
}

async function main() {
  const write = process.argv.includes('--write');
  const pool = pgPool();
  const client = await pool.connect();

  console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);
  console.log(`SQLite   : ${SQLITE_PATH}`);
  console.log(write ? '\nMODE: --write — this run WILL alter and update.\n' : '\nMODE: DRY RUN — nothing will be written.\n');

  // ---------------------------------------------------------------- schema
  const { rows: existing } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = ANY($1::text[])`,
    [COLUMNS],
  );
  const present = new Set(existing.map((r) => r.column_name));
  const missing = COLUMNS.filter((c) => !present.has(c));

  if (missing.length === 0) {
    console.log('Schema   : both columns already exist.');
  } else if (!write) {
    console.log(`Schema   : would ADD COLUMN ${missing.join(', ')} (integer, nullable).`);
  } else {
    await client.query(
      'ALTER TABLE properties ADD COLUMN IF NOT EXISTS advance_months integer, ADD COLUMN IF NOT EXISTS commission_months integer',
    );
    console.log(`Schema   : added ${missing.join(', ')}.`);
  }

  // -------------------------------------------------------------- backfill
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const listings = sqlite
    .prepare(
      `SELECT remote_property_id, deposit_months, advance_months, commission_months
       FROM listings
       WHERE remote_property_id IS NOT NULL
         AND (advance_months IS NOT NULL OR commission_months IS NOT NULL)
       ORDER BY remote_property_id`,
    )
    .all();

  console.log(`\n${listings.length} listing(s) in SQLite carry a real advance or commission.\n`);

  let updated = 0;
  let skipped = 0;

  for (const row of listings) {
    const label = `property #${row.remote_property_id}: ${[row.deposit_months, row.advance_months, row.commission_months].filter((v) => v != null).join(' + ')}`;

    if (missing.length > 0 && !write) {
      console.log(`  ${label}  (columns do not exist yet — would be written after the ALTER)`);
      continue;
    }

    // Only ever fills a blank. A figure corrected by hand in Postgres, or by
    // the Laravel admin, outranks whatever the original intake parsed.
    const { rowCount } = await client.query(
      write
        ? `UPDATE properties
             SET advance_months = COALESCE(advance_months, $1),
                 commission_months = COALESCE(commission_months, $2),
                 updated_at = NOW()
           WHERE id = $3
             AND (advance_months IS NULL OR commission_months IS NULL)`
        : `SELECT 1 FROM properties
           WHERE id = $3::bigint
             AND ($1::int IS NOT NULL OR $2::int IS NOT NULL)`,
      [row.advance_months ?? null, row.commission_months ?? null, row.remote_property_id],
    );

    if (rowCount > 0) {
      updated += 1;
      console.log(`  ${write ? 'WROTE' : 'would write'}  ${label}`);
    } else {
      skipped += 1;
      console.log(`  skipped     ${label} (no such property, or already filled)`);
    }
  }

  console.log(`\n${write ? 'Done' : 'Dry run complete'}. ${updated} row(s) ${write ? 'updated' : 'would be updated'}, ${skipped} skipped.`);

  sqlite.close();
  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
