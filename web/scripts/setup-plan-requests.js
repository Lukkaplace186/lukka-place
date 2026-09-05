#!/usr/bin/env node
/**
 * web/scripts/setup-plan-requests.js
 *
 * One-off, idempotent. Creates `plan_change_requests` — the real record of
 * an agent asking to change subscription tier from their own dashboard.
 *
 * Why a table and not just a WhatsApp deep link: this platform has no
 * payment gateway (the product decision behind /admin/subscriptions is a
 * manual ledger — cash, bank transfer, Mobile Money — recorded by an admin,
 * see lib/subscriptions.js's assignPackageToAgent). A "Passer au forfait
 * supérieur" button that only opened WhatsApp would leave the request
 * existing nowhere: nothing for the admin to work through, no way to tell
 * an unanswered request from a handled one, and no way to see which tier
 * agents actually want. This gives the request a real lifecycle
 * (pending -> approved/declined) that /admin/subscriptions works from, with
 * the WhatsApp message as the notification on top rather than the whole
 * mechanism.
 *
 *   Usage: node web/scripts/setup-plan-requests.js
 *   Reads web/.env.local (DB_*).
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
      CREATE TABLE IF NOT EXISTS plan_change_requests (
        id bigserial PRIMARY KEY,
        agent_id bigint NOT NULL,
        package_id bigint,
        kind text NOT NULL DEFAULT 'upgrade',
        note text,
        status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        handled_at timestamptz,
        handled_note text
      )
    `);
    console.log('OK: plan_change_requests');

    // Partial unique index, not a plain UNIQUE (agent_id, package_id): an
    // agent may legitimately ask for the same tier again after an earlier
    // request was handled or declined. Only one OPEN request per
    // (agent, package) may exist at a time — which is exactly what makes the
    // action's ON CONFLICT DO NOTHING mean "you already asked for this",
    // rather than silently swallowing a genuine second request months later.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS plan_change_requests_open_uniq
      ON plan_change_requests (agent_id, package_id)
      WHERE status = 'pending'
    `);
    console.log('OK: plan_change_requests_open_uniq');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS plan_change_requests_status_idx
      ON plan_change_requests (status, created_at DESC)
    `);
    console.log('OK: plan_change_requests_status_idx');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('setup-plan-requests failed:', err);
  process.exit(1);
});
