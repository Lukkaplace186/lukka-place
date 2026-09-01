#!/usr/bin/env node
/**
 * web/scripts/setup-search-alerts.js
 *
 * One-off: creates saved_search_notifications, the table that tracks which
 * (saved search, listing) pairs have already triggered a WhatsApp alert, so
 * /api/cron/search-alerts never re-notifies the same match twice. No
 * migration framework exists in this repo — same one-off-script pattern
 * already used by web/scripts/setup-agent-profile-fields.js. Idempotent:
 * safe to re-run.
 *
 * Usage: node web/scripts/setup-search-alerts.js
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_search_notifications (
        id bigserial PRIMARY KEY,
        saved_search_id bigint NOT NULL REFERENCES customer_saved_searches (id) ON DELETE CASCADE,
        property_id integer NOT NULL,
        notified_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (saved_search_id, property_id)
      )
    `);
    console.log('OK: saved_search_notifications');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('setup-search-alerts failed:', err);
  process.exit(1);
});
