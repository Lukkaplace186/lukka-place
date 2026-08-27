#!/usr/bin/env node
/**
 * One-off/reusable helper: attach a batch of real, currently-unassigned
 * live listings (properties.agent_id IS NULL) to one real agent, so that
 * agent's public storefront (/agents/[id]) and private dashboard
 * (/compte/agent/**) have real listings to render instead of the honest
 * empty state.
 *
 * This is a real, visible, production-data change, not a cosmetic one:
 *   - The public storefront will show this agent's name/avatar on those
 *     listings' agent panel.
 *   - EnquiryCard.js's WhatsApp CTA on those listings switches from the
 *     central Lukka Place number to this agent's own `agents.phone` (if
 *     set) — see lib/listings.js's agent join. If the target agent has no
 *     phone, the panel falls back to the central number as today.
 *   - The change is easy to UNDO (set agent_id back to NULL for the same
 *     ids — this script prints the affected ids for exactly that), but it
 *     is NOT purely cosmetic while it's live: real visitors see it.
 *
 * Usage:
 *   node scripts/link-agent-listings.js --agent-id=28 --count=8
 *   node scripts/link-agent-listings.js --agent-id=28 --ids=101,102,103
 *   node scripts/link-agent-listings.js --agent-id=28 --count=8 --dry-run
 *
 * Requires DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME in .env.local (same
 * Supabase Postgres this whole app already reads/writes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--agent-id=')) out.agentId = Number.parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--count=')) out.count = Number.parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--ids=')) out.ids = arg.split('=')[1].split(',').map((s) => Number.parseInt(s, 10));
  }
  return out;
}

async function main() {
  const { agentId, count, ids, dryRun } = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(agentId)) {
    console.error('Usage: node scripts/link-agent-listings.js --agent-id=<id> (--count=<n> | --ids=<id,id,...>) [--dry-run]');
    process.exit(1);
  }
  if (!Number.isFinite(count) && !ids) {
    console.error('Pass either --count=<n> or --ids=<id,id,...>.');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const agentRes = await pool.query('SELECT id, phone, status FROM agents WHERE id = $1', [agentId]);
  const agent = agentRes.rows[0];
  if (!agent) {
    console.error(`No agent with id=${agentId}.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`Target agent #${agent.id} — phone: ${agent.phone || '(none)'}, status: ${agent.status}`);
  if (!agent.phone) {
    console.log('  Note: this agent has no phone set — EnquiryCard.js will keep falling back to the central WhatsApp number for these listings.');
  }

  let targetIds = ids;
  if (!targetIds) {
    // Real, currently-live, unassigned listings only — never touches one
    // already attributed to another agent.
    const { rows } = await pool.query(
      `SELECT id FROM properties
       WHERE status = 1 AND approve_status = 1 AND agent_id IS NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [count],
    );
    targetIds = rows.map((r) => r.id);
  }

  if (targetIds.length === 0) {
    console.log('No matching listings to link.');
    await pool.end();
    return;
  }

  console.log(`${dryRun ? '[dry-run] Would link' : 'Linking'} ${targetIds.length} listing(s) to agent #${agentId}: ${targetIds.join(', ')}`);

  if (!dryRun) {
    const { rowCount } = await pool.query(
      `UPDATE properties SET agent_id = $1, updated_at = NOW() WHERE id = ANY($2::bigint[])`,
      [agentId, targetIds],
    );
    console.log(`Updated ${rowCount} row(s).`);
    console.log(`To undo: node -e "require('pg')" ... or re-run this script's UPDATE with agent_id = NULL for ids: ${targetIds.join(',')}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
