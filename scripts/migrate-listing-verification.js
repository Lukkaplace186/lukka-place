/**
 * Adds listing-level verification to `properties`.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * Until now the only verification anywhere in this system was
 * `agents.phone_verified_at` — proof that a number belongs to whoever claims
 * it. That is a fact about a PERSON. "Verified by Lukka" is a claim about a
 * PROPERTY: that we have confirmed this listing describes a real place on
 * real terms. The two are not the same and one cannot stand in for the other,
 * which is why this is a new column rather than a join.
 *
 * It is also NOT `approve_status`. Approval is moderation — a human read the
 * listing and it was fit to publish. Verification is the stronger, separate
 * claim, and conflating the two would let every approved listing wear a badge
 * nobody earned. web/CLAUDE.md's "three independent axes" section is about
 * exactly this class of mistake; this is the fourth axis and it stays
 * independent of the other three.
 *
 * WHY A TIMESTAMP, NOT A BOOLEAN
 * `verified_at` + `verified_by`, matching `phone_verified_at`, `sold_at` and
 * `archived_at` — every comparable flag on this schema is already a
 * timestamp. `is_verified` is derived as `verified_at IS NOT NULL`. A bare
 * boolean cannot answer "who said so, and when", which is the first question
 * asked the day a verified listing turns out not to be real, and the market
 * export wants the date rather than a flag.
 *
 * NOTHING IS BACKFILLED, deliberately. Nobody has verified any existing
 * listing, and stamping a timestamp would record a verification that never
 * happened — the same fabrication the no-invented-data rule forbids
 * everywhere else in this product. Every row starts NULL and is earned.
 *
 * SAFE BY DEFAULT — a plain run reports what it WOULD do and writes nothing:
 *
 *   node scripts/migrate-listing-verification.js            # dry run
 *   node scripts/migrate-listing-verification.js --write    # ALTER
 *
 * Additive, IF NOT EXISTS, and re-runnable. Same convention as
 * scripts/migrate-entry-cost-columns.js and the other one-off scripts here:
 * not wired into the boot path, run by hand.
 */
require('dotenv').config();

const { Pool } = require('pg');

/** column name -> its DDL type. Both nullable; see the header. */
const COLUMNS = {
  verified_at: 'timestamptz',
  verified_by: 'integer',
};

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
  console.log(
    write
      ? '\nMODE: --write — this run WILL alter the table.\n'
      : '\nMODE: DRY RUN — nothing will be written.\n',
  );

  const names = Object.keys(COLUMNS);
  const { rows: existing } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = ANY($1::text[])`,
    [names],
  );
  const present = new Set(existing.map((r) => r.column_name));
  const missing = names.filter((c) => !present.has(c));

  if (missing.length === 0) {
    console.log('Schema   : both columns already exist — nothing to do.');
  } else if (!write) {
    console.log(
      `Schema   : would ADD COLUMN ${missing.map((c) => `${c} ${COLUMNS[c]}`).join(', ')} (nullable).`,
    );
  } else {
    const clause = names.map((c) => `ADD COLUMN IF NOT EXISTS ${c} ${COLUMNS[c]}`).join(', ');
    await client.query(`ALTER TABLE properties ${clause}`);
    // Partial: the overwhelming majority of rows are NULL and always will be,
    // so indexing only the verified ones keeps it small and keeps the badge
    // lookup on the storefront cheap.
    await client.query(
      'CREATE INDEX IF NOT EXISTS properties_verified_at_idx ON properties (verified_at) WHERE verified_at IS NOT NULL',
    );
    console.log(`Schema   : added ${missing.join(', ')} (+ partial index on verified_at).`);
  }

  // A count, so the run says something true about the data rather than only
  // about the schema.
  if (missing.length === 0 || write) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(verified_at)::int AS verified
         FROM properties WHERE approve_status = 1`,
    );
    console.log(
      `\nApproved listings: ${rows[0].total}, of which verified: ${rows[0].verified}.`,
    );
    console.log('No backfill: verification is earned per listing, never assumed.');
  }

  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
