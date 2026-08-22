#!/usr/bin/env node
/**
 * One-off corrective fix: scripts/resync-published-listings.js's UPDATE
 * path (via syncListingToPostgres -> buildPropertyValues) hardcodes
 * `approve_status: 0` on every write, including updates to an already-
 * approved property. Re-running the resync on properties #256/#257 (both
 * already human-approved and live before that resync — confirmed by their
 * appearing in every public /listings search across this whole session,
 * which strictly filters on approve_status = 1) silently reverted that
 * approval. This restores exactly what was there before, nothing else.
 */
require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const { rows } = await pool.query(
    'UPDATE properties SET approve_status = 1, updated_at = NOW() WHERE id IN (256, 257) RETURNING id, status, approve_status',
  );
  console.log('restored:', JSON.stringify(rows));
  await pool.end();
}

main().catch((err) => {
  console.error('fatal:', err.message);
  process.exit(1);
});
