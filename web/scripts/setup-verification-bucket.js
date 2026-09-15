#!/usr/bin/env node
/**
 * web/scripts/setup-verification-bucket.js
 *
 * Creates the PRIVATE Supabase Storage bucket that holds agent identity and
 * RCCM documents (lib/agentVerification.js). Idempotent: an existing bucket is
 * checked, never recreated — and if it exists but is PUBLIC the script stops
 * with an error instead of carrying on, because a public bucket of ID cards is
 * the one misconfiguration this feature cannot survive.
 *
 * Run the SQL first: node scripts/run-sql-migration.js migrations/20260917_agent_verification.sql --write
 * (engine repo). Then:
 *
 *   node web/scripts/setup-verification-bucket.js          # dry run, reports only
 *   node web/scripts/setup-verification-bucket.js --write  # creates it if missing
 *
 * Reads web/.env.local (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_VERIFICATION_BUCKET — default "agent-verification").
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.SUPABASE_VERIFICATION_BUCKET || 'agent-verification';
const MAX_BYTES = 10 * 1024 * 1024;

async function main() {
  const write = process.argv.includes('--write');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: existing, error: getError } = await supabase.storage.getBucket(BUCKET);
  if (existing) {
    if (existing.public) {
      console.error(`Bucket "${BUCKET}" exists and is PUBLIC. Make it private in the Supabase dashboard before using it.`);
      process.exit(1);
    }
    console.log(`Bucket "${BUCKET}" already exists and is private. Nothing to do.`);
    return;
  }
  if (getError && !/not found/i.test(getError.message)) throw getError;

  if (!write) {
    console.log(`DRY RUN — bucket "${BUCKET}" does not exist. Re-run with --write to create it (private).`);
    return;
  }

  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });
  if (error) throw error;
  console.log(`Created private bucket "${BUCKET}".`);
}

main().catch((err) => {
  console.error('setup-verification-bucket failed:', err.message);
  process.exit(1);
});
