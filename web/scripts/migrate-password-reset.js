/**
 * One-off migration: adds the reset-OTP columns the unified "Mot de passe
 * oublié" flow needs to both `customers` and `agents` — separate from each
 * table's existing password_hash/token_version columns, and (for `agents`)
 * separate from the signup-verification otp_code_hash/otp_expires_at pair,
 * so a password reset in progress can never be confused with — or
 * accidentally clear — an unrelated signup-verification attempt.
 *
 * Same convention as scripts/migrate-customer-accounts.js: `IF NOT EXISTS`
 * throughout, safe to re-run, not wired into build/deploy.
 *
 * Usage:
 *   node scripts/migrate-password-reset.js
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
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_otp_code_hash TEXT`,
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS reset_otp_code_hash TEXT`,
  `ALTER TABLE agents ADD COLUMN IF NOT EXISTS reset_otp_expires_at TIMESTAMPTZ`,
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
