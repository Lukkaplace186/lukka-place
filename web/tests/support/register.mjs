/**
 * The `--import` entry for every tier. Runs before any test file, which is
 * what gets the resolve hook installed in time for the first `import`.
 *
 * Tier is chosen by QA_FAKE_DB:
 *   unit  (QA_FAKE_DB=1) — lib/db.js is faked; secrets are fixed test values
 *                          set here, BEFORE any auth module is imported, so
 *                          a unit test can never accidentally sign a token
 *                          with the real production secret. Same discipline
 *                          as scripts/verify-pipeline.js's env preamble.
 *   http/chain           — real .env.local, real pool, real secrets.
 */
import './hooks.mjs';
import { loadEnvLocal } from './env.mjs';

if (process.env.QA_FAKE_DB === '1') {
  // Deterministic, obviously-fake, and distinct per realm. The realms' token
  // formats are byte-identical (agentAuth.js / customerAuth.js), so making
  // these differ here is what lets a test prove that the secret is the only
  // thing separating them.
  process.env.ADMIN_SESSION_SECRET ??= 'unit-admin-secret';
  process.env.AGENT_SESSION_SECRET ??= 'unit-agent-secret';
  process.env.CUSTOMER_SESSION_SECRET ??= 'unit-customer-secret';
  process.env.ADMIN_PASSWORD_HASH ??= '';
  // Nothing in the unit tier may reach a real database or a real API.
  for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'ENGINE_API_BASE', 'ENGINE_API_SECRET', 'CRON_SECRET']) {
    process.env[key] = '';
  }
} else {
  loadEnvLocal();
}
