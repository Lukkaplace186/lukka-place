/**
 * Runs one .sql file from migrations/ against Postgres.
 *
 * SAFE BY DEFAULT, same convention as scripts/migrate-listing-verification.js:
 * a plain run prints the file and the target database and writes nothing.
 *
 *   node scripts/run-sql-migration.js migrations/<file>.sql            # dry run
 *   node scripts/run-sql-migration.js migrations/<file>.sql --write    # apply
 *
 * The file owns its own BEGIN/COMMIT and must be idempotent (IF NOT EXISTS /
 * guarded DO blocks), so re-running an applied migration is a no-op. There is
 * deliberately no migrations-ledger table: every migration in this repo has
 * been hand-run and re-runnable, and a ledger would be a second source of
 * truth for "is this column there" that information_schema already answers.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const write = process.argv.includes('--write');
  if (!file) {
    console.error('Usage: node scripts/run-sql-migration.js <file.sql> [--write]');
    process.exit(2);
  }

  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);
  console.log(`File     : ${file} (${sql.length} bytes)`);

  if (!write) {
    console.log('\nMODE: DRY RUN — nothing will be written. Re-run with --write to apply.\n');
    console.log(sql);
    return;
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query(sql);
    console.log('\nApplied.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
