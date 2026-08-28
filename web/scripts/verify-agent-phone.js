#!/usr/bin/env node
/**
 * Mark an agent's phone as verified without going through the WhatsApp OTP.
 *
 * Why this exists: the OTP is delivered as a free-form WhatsApp text, and
 * Meta only delivers free-form text to someone who has messaged the business
 * within the last 24 hours. A brand-new agent never has, so the send is
 * accepted (HTTP 200) and silently never arrives — leaving a real, correct
 * account permanently unable to finish signing in. Until the OTP moves to an
 * approved authentication-category template (services/chakra.js's
 * sendTemplate), this is the supported way to let a known-good account in.
 *
 * This is an administrative override of an identity check, so it is
 * deliberately explicit rather than convenient: it takes a phone number, not
 * just an id, and refuses to run unless the two agree — so a mistyped id
 * can't quietly verify somebody else's account.
 *
 * Sets phone_verified_at and clears any in-flight OTP, exactly as
 * consumeAgentOtp does on the real success path (services/... web/lib/agents.js),
 * so no stale code stays valid afterwards.
 *
 * Usage:
 *   node scripts/verify-agent-phone.js --agent-id=33 --phone=243993960948
 *   node scripts/verify-agent-phone.js --agent-id=33 --phone=243993960948 --undo
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const get = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const agentId = Number.parseInt(get('agent-id'), 10);
const phone = get('phone');
const undo = args.includes('--undo');
const setPassword = get('set-password');

if (!Number.isFinite(agentId) || !phone) {
  console.error(
    'Usage: node scripts/verify-agent-phone.js --agent-id=<id> --phone=<digits> [--set-password=<pw>] [--undo]',
  );
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

const { rows } = await pool.query(
  'SELECT id, phone, username, phone_verified_at FROM agents WHERE id = $1',
  [agentId],
);
const agent = rows[0];

if (!agent) {
  console.error(`No agent with id=${agentId}.`);
  await pool.end();
  process.exit(1);
}
if (String(agent.phone) !== String(phone)) {
  console.error(`Refusing: agent #${agentId} has phone ${agent.phone}, not ${phone}.`);
  await pool.end();
  process.exit(1);
}

/**
 * Same stored form web/lib/authCrypto.js produces: `salt:scrypt(value, salt)`
 * with a 64-byte key. Reimplemented here rather than imported because that
 * module is `server-only` and refuses to load outside a Next.js render.
 * Keep the two in step — a drift in salt length or key length silently makes
 * every password written here unverifiable by the app.
 */
function hashToStoredForm(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(value), salt, 64).toString('hex')}`;
}

if (setPassword) {
  if (setPassword.length < 8) {
    console.error('Refusing: password must be at least 8 characters (matches the app rule).');
    await pool.end();
    process.exit(1);
  }
  // Mirrors resetAgentPassword in web/lib/agents.js: bumping token_version
  // invalidates every outstanding session, and the lockout counters are
  // cleared so a previously locked-out account isn't still gated.
  await pool.query(
    `UPDATE agents
     SET password_hash = $1, token_version = token_version + 1,
         failed_login_count = 0, locked_until = NULL
     WHERE id = $2`,
    [hashToStoredForm(setPassword), agentId],
  );
  console.log(`Agent #${agentId} (${agent.phone}) password set. All existing sessions were invalidated.`);
  console.log('This is a TEMPORARY credential — change it from Paramètres once you are done.');
}

if (undo) {
  await pool.query('UPDATE agents SET phone_verified_at = NULL WHERE id = $1', [agentId]);
  console.log(`Reverted: agent #${agentId} (${agent.phone}) is no longer phone-verified.`);
} else if (!setPassword) {
  await pool.query(
    `UPDATE agents
     SET phone_verified_at = NOW(), otp_code_hash = NULL, otp_expires_at = NULL,
         failed_login_count = 0, locked_until = NULL
     WHERE id = $1`,
    [agentId],
  );
  console.log(`Agent #${agentId} (${agent.phone}) marked phone-verified — login now skips the OTP step.`);
  console.log('To revert: re-run with --undo');
}

await pool.end();
