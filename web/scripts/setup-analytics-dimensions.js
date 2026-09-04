#!/usr/bin/env node
/**
 * web/scripts/setup-analytics-dimensions.js
 *
 * Adds the two dimensions the admin dashboard could not answer:
 * "is our traffic web or mobile?" and "where is it coming from?".
 * page_views/whatsapp_clicks only carried (path, commune, created_at).
 *
 * No migration framework exists in this repo — same one-off-script pattern
 * as setup-search-alerts.js and setup-agent-profile-fields.js. Idempotent
 * (ADD COLUMN IF NOT EXISTS), so it is safe to re-run.
 *
 * Both columns are nullable on purpose. Every row written before this ran
 * has no device and no source, and backfilling them would mean inventing
 * data — so historical rows stay NULL and the dashboard reports them as
 * "Inconnu" rather than silently folding them into a real bucket.
 *
 * `source` stores a referrer HOST only ('google.com'), never a full URL.
 * A full referrer can carry the visitor's previous search terms and query
 * parameters; the host is all the analytics question needs.
 *
 * Usage: node web/scripts/setup-analytics-dimensions.js
 * Reads web/.env.local (DB_*).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    for (const table of ['page_views', 'whatsapp_clicks']) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS device text`);
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS source text`);
      console.log(`${table}: device, source ensured`);
    }

    // Both dashboard queries group by these, over a table that grows with
    // every page view.
    await pool.query('CREATE INDEX IF NOT EXISTS page_views_device_idx ON page_views (device)');
    await pool.query('CREATE INDEX IF NOT EXISTS page_views_source_idx ON page_views (source)');
    await pool.query('CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON page_views (created_at)');
    console.log('indexes ensured');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE device IS NULL)::int AS without_device
       FROM page_views`,
    );
    console.log(
      `page_views: ${rows[0].total} rows, ${rows[0].without_device} predate this migration ` +
        '(they stay NULL — reported as "Inconnu", never bucketed into a guess)',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
