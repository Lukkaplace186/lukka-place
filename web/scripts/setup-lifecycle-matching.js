#!/usr/bin/env node
/**
 * web/scripts/setup-lifecycle-matching.js
 *
 * One-off, idempotent. Adds the real columns three new capabilities need.
 * No migration framework exists in this repo — same one-off-script pattern
 * as setup-search-alerts.js / setup-agent-profile-fields.js.
 *
 *   Usage: node web/scripts/setup-lifecycle-matching.js
 *   Reads web/.env.local (DB_*).
 *
 * 1. LISTING LIFECYCLE (agent "Mes biens")
 *
 *    properties.sold_at      the real agreed transaction DATE. `sold_price`
 *                            already existed; without a date beside it the
 *                            market export had to approximate the closing
 *                            date with `updated_at`, which moves every time
 *                            anything on the row is edited. Days-on-market
 *                            computed from that is wrong by construction.
 *    properties.archived_at  when the agent archived (unpublished) the
 *                            listing. Archiving itself is `status = 0` — the
 *                            existing active/enabled integer flag the public
 *                            filter already excludes (CLAUDE.md) — so no new
 *                            visibility mechanism is invented. This column
 *                            only records *when and why* it went to 0, which
 *                            is what distinguishes an agent archive from a
 *                            listing that was simply never enabled.
 *
 * 2. LEAD MATCHING (automated agent push)
 *
 *    agents.serviced_communes  the communes an agency will actually take a
 *                              lead in. `primary_communes` already exists and
 *                              stays what it is — the agency's *specialty*,
 *                              shown on their public profile and scored
 *                              higher. Coverage is genuinely a wider set than
 *                              specialty, and collapsing the two would either
 *                              understate reach or overstate expertise.
 *                              Backfilled from primary_communes so no agent
 *                              starts with empty coverage.
 *    packages.priority_multiplier  lead-routing weight by subscription tier.
 *                              Defaults to 1.0 for every existing package, so
 *                              ranking is unchanged until someone sets one.
 *
 * 3. WHATSAPP AGENT ONBOARDING (magic link)
 *
 *    agents.agency_name             captured in the WhatsApp micro-onboarding
 *                                   ("Nom de votre agence ?"). There is no
 *                                   agency field anywhere in agent_infos, and
 *                                   `vendors.username` needs a vendors row an
 *                                   onboarding agent doesn't have yet.
 *    agents.activation_token_hash   SHA-256 of the single-use activation
 *                                   token sent over WhatsApp. Hashed, never
 *                                   stored raw — same posture as
 *                                   `otp_code_hash` beside it.
 *    agents.activation_expires_at   short-lived; an expired link is refused.
 *    agents.onboarding_source       'whatsapp' | 'web'. Real provenance, used
 *                                   by /admin to tell a self-registered agent
 *                                   from one the intake bot onboarded.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const STATEMENTS = [
  ['properties.sold_at', `ALTER TABLE properties ADD COLUMN IF NOT EXISTS sold_at date`],
  ['properties.archived_at', `ALTER TABLE properties ADD COLUMN IF NOT EXISTS archived_at timestamptz`],

  ['agents.serviced_communes', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS serviced_communes text[]`],
  [
    'agents.serviced_communes backfill',
    `UPDATE agents
     SET serviced_communes = primary_communes
     WHERE serviced_communes IS NULL AND primary_communes IS NOT NULL`,
  ],
  ['agents.agency_name', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS agency_name text`],
  ['agents.activation_token_hash', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS activation_token_hash text`],
  ['agents.activation_expires_at', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS activation_expires_at timestamptz`],
  ['agents.onboarding_source', `ALTER TABLE agents ADD COLUMN IF NOT EXISTS onboarding_source text`],

  [
    'packages.priority_multiplier',
    `ALTER TABLE packages ADD COLUMN IF NOT EXISTS priority_multiplier numeric NOT NULL DEFAULT 1.0`,
  ],

  // The dispatcher looks agents up by commune coverage on every customer
  // request. GIN is the right index for an array containment test
  // (`serviced_communes @> ARRAY[$1]`), which is the shape the ranking query
  // actually uses — a btree index cannot serve it at all.
  [
    'agents.serviced_communes index',
    `CREATE INDEX IF NOT EXISTS agents_serviced_communes_gin ON agents USING GIN (serviced_communes)`,
  ],
  // Agent lookup by phone happens on every inbound WhatsApp listing (is this
  // sender already registered?) and on every magic-link activation.
  [
    'agents.phone index',
    `CREATE INDEX IF NOT EXISTS agents_phone_idx ON agents (phone)`,
  ],
];

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
    for (const [label, sql] of STATEMENTS) {
      const result = await pool.query(sql);
      const suffix = typeof result.rowCount === 'number' && result.command === 'UPDATE'
        ? ` (${result.rowCount} row${result.rowCount === 1 ? '' : 's'})`
        : '';
      console.log(`OK: ${label}${suffix}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('setup-lifecycle-matching failed:', err);
  process.exit(1);
});
