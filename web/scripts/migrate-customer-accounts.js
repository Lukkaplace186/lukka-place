/**
 * One-off migration: creates the customer-account tables (`customers`,
 * `customer_favorites`, `customer_saved_searches`) on the live Supabase
 * Postgres this app already reads from. Same convention as
 * scripts/hash-admin-password.js — not wired into build/deploy, run
 * manually by whoever ships this phase.
 *
 * All CREATE statements are `IF NOT EXISTS`, so this is safe to re-run.
 *
 * Usage:
 *   node scripts/migrate-customer-accounts.js
 *
 * Loads DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME from .env.local itself
 * (no `dotenv` dependency in this app, and this script runs outside Next's
 * own env loading, which only applies to `next dev`/`build`/`start`).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    token_version INTEGER NOT NULL DEFAULT 1,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS customer_favorites (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    property_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (customer_id, property_id)
  )`,
  `CREATE INDEX IF NOT EXISTS customer_favorites_customer_id_idx ON customer_favorites(customer_id)`,
  `CREATE TABLE IF NOT EXISTS customer_saved_searches (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_viewed_at TIMESTAMPTZ,
    UNIQUE (customer_id, query)
  )`,
  `CREATE INDEX IF NOT EXISTS customer_saved_searches_customer_id_idx ON customer_saved_searches(customer_id)`,
];

async function main() {
  loadEnvLocal();

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Connected to ${process.env.DB_HOST}/${process.env.DB_NAME}`);

  try {
    for (const statement of STATEMENTS) {
      await client.query(statement);
      console.log('OK:', statement.trim().split('\n')[0]);
    }
    console.log('\nMigration complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
