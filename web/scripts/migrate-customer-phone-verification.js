/**
 * One-off migration: gives `customers` the same signup phone-verification
 * columns `agents` already has, so a customer account is only usable once a
 * WhatsApp OTP has proved the number belongs to whoever registered it.
 *
 * Deliberately separate from the existing `reset_otp_*` pair (added by
 * scripts/migrate-password-reset.js): a password reset in progress must
 * never clear — or be confused with — a signup verification in progress.
 * Exactly the split lib/agents.js documents on the agent side.
 *
 * **Existing rows are left with `phone_verified_at` NULL on purpose.** They
 * were created before this step existed and nobody ever proved those
 * numbers; backfilling a timestamp would record a verification that never
 * happened. They are asked to verify once, on their next login (see
 * web/app/(site)/compte/connexion/actions.js), which is the same one-time
 * step an agent with an unverified account already goes through.
 *
 * Same convention as the other migrations here: `IF NOT EXISTS` throughout,
 * safe to re-run, not wired into build/deploy.
 *
 * Usage:
 *   node scripts/migrate-customer-phone-verification.js
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
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS otp_code_hash TEXT`,
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ`,
  `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ`,
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

    const { rows } = await client.query(
      `SELECT count(*)::int AS total, count(phone_verified_at)::int AS verified FROM customers`,
    );
    console.log(`\n${rows[0].verified}/${rows[0].total} customer numbers verified.`);
    console.log('Unverified accounts are asked for a WhatsApp code on their next login.');
    console.log('\nMigration complete.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
