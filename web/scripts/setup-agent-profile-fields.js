#!/usr/bin/env node
/**
 * web/scripts/setup-agent-profile-fields.js
 *
 * One-off: adds agents.working_hours and creates the 'avatars' Storage
 * bucket. No migration framework exists in this repo (agents.primary_communes
 * was added the same way, directly against the live DB) — this is that same
 * one-off-script pattern. Idempotent: safe to re-run.
 *
 * Usage: node web/scripts/setup-agent-profile-fields.js
 * Reads web/.env.local (DB_*, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_AVATARS_BUCKET).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

async function addWorkingHoursColumn() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS working_hours TEXT');
    console.log('OK: agents.working_hours');
  } finally {
    await pool.end();
  }
}

async function createAvatarsBucket() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const bucket = process.env.SUPABASE_AVATARS_BUCKET || 'avatars';

  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (existing) {
    console.log(`OK: bucket '${bucket}' already exists`);
    return;
  }

  const { error } = await supabase.storage.createBucket(bucket, { public: true, fileSizeLimit: '5MB' });
  if (error) throw new Error(`createBucket failed: ${error.message}`);
  console.log(`OK: created bucket '${bucket}' (public)`);
}

async function main() {
  await addWorkingHoursColumn();
  await createAvatarsBucket();
}

main().catch((err) => {
  console.error('setup-agent-profile-fields failed:', err);
  process.exit(1);
});
