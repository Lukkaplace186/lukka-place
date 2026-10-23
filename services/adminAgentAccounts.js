/**
 * Agent accounts made or verified by the Lukka Place team, from the web
 * console (web/app/admin/agents), with no code from the agent's phone.
 *
 * WHY THIS EXISTS
 * A number becomes a verified agent in two ways otherwise: the agent sends a
 * 6-digit code FROM their WhatsApp (services/phoneChallenges.js), or they
 * answer the onboarding question after WhatsApping a listing
 * (services/agentOnboarding.js). Brokers whose listings arrive from WhatsApp
 * groups (services/groupRelay.js) do neither: their posts are filed under
 * their number and stay unattributed until that number is a verified agent.
 * The owner asked for the team to vouch for them directly.
 *
 * WHAT IT SKIPS, AND WHY THAT IS ADMIN-ONLY
 * `phone_verified_at` is the gate resolveAgentId, identifySender and web's
 * lead routing share: setting it publishes the number on the agent's listings
 * and routes their enquiries to it. Here nobody proved they hold the number —
 * an admin said so. These functions are reachable only through routes/admin.js
 * (requireApiKey), called from the admin console's server actions; there is no
 * public path to them and there must never be one.
 *
 * WHO VOUCHED
 * There is no admin id on `agents` (verified_by-style columns stay NULL, never
 * a made-up id). A created account carries `onboarding_source = 'admin'`; the
 * console records the admin in its audit log and in an agent note, where the
 * session's real identity is known.
 */

const db = require('./db');
const postgres = require('./postgres');
const onboarding = require('./agentOnboarding');

/** The two business numbers, refused even when no env var names them. */
const BUSINESS_NUMBERS = ['243976321848', '243846962654'];

const PHONE_SHAPE = /^\d{7,15}$/;

class AdminAgentError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/** HTTP status for each refusal, used by routes/admin.js. */
const ERROR_STATUS = {
  'phone-invalid': 400,
  'phone-ours': 400,
  'name-required': 400,
  'phone-taken': 409,
  'phone-verified-elsewhere': 409,
  'not-found': 404,
  'postgres-unavailable': 503,
};

/**
 * Digits-only, 7–15 (web/lib/phone.js and routes/admin.js's wa_id rule), and
 * never one of ours: the business numbers, the desk, the relay SIM.
 */
function checkPhone(phone) {
  const digits = onboarding.normalisePhone(phone);
  if (!PHONE_SHAPE.test(digits)) throw new AdminAgentError('phone-invalid', 'phone must be 7-15 digits');
  const ours = new Set([...BUSINESS_NUMBERS, ...require('./groupRelay').ownNumbers()]);
  if (ours.has(digits)) throw new AdminAgentError('phone-ours', `${digits} is a Lukka Place number`);
  return digits;
}

/**
 * Hand every listing filed under this number to its now-verified agent:
 * Postgres `properties.agent_id` through linkListingsToAgent (the onboarding
 * path's own claim, which re-resolves the agent through resolveAgentId's gate
 * and only fills a NULL), then the SQLite record. A listing not yet in
 * Postgres (a capture kept as a draft for want of a photo) is attributed at
 * its first sync, since the number now passes resolveAgentId.
 *
 * Best-effort, like completeOnboarding's: the account exists either way.
 */
async function claimListingsForNumber(digits, agentId) {
  const result = { linkedIds: [], localStamped: 0, error: null };
  try {
    const remoteIds = db.getRemotePropertyIdsForWaId(digits);
    if (remoteIds.length) {
      ({ linkedIds: result.linkedIds } = await postgres.linkListingsToAgent(remoteIds, digits));
    }
    result.localStamped = db.attributeListingsForWaId(digits, agentId);
  } catch (err) {
    result.error = err.message;
    console.warn(`[admin-agents] listing claim failed for ${digits}: ${err.message}`);
  }
  return result;
}

/**
 * "Créer un agent": a new, verified account and its activation link.
 * Refuses a number that already has any agents row, soft-deleted included.
 *
 * @param {{phone: string, firstName: string, lastName?: string|null,
 *          agencyName?: string|null, primaryCommunes?: string[]}} input
 * @returns {Promise<{agentId: number, phone: string, link: string, claimed: object}>}
 */
async function createAgentByAdmin({ phone, firstName, lastName = null, agencyName = null, primaryCommunes = [] }) {
  const digits = checkPhone(phone);
  const first = String(firstName || '').trim().slice(0, 80);
  const last = String(lastName || '').trim().slice(0, 80) || null;
  if (!first) throw new AdminAgentError('name-required', 'firstName is required');
  if (!postgres.isConfigured()) throw new AdminAgentError('postgres-unavailable', 'Postgres is not configured');

  let agentId;
  let token;
  try {
    ({ agentId, token } = await onboarding.upsertAgentFromWhatsApp({
      waId: digits,
      fullName: [first, last].filter(Boolean).join(' '),
      firstName: first,
      lastName: last,
      agencyName: String(agencyName || '').trim().slice(0, 160) || null,
      source: 'admin',
      refuseExisting: true,
      primaryCommunes: Array.isArray(primaryCommunes) ? primaryCommunes.map(String).filter(Boolean) : [],
    }));
  } catch (err) {
    if (err.code === 'phone-taken') {
      throw new AdminAgentError('phone-taken', err.message, { agentId: err.agentId });
    }
    throw err;
  }

  const claimed = await claimListingsForNumber(digits, agentId);
  console.log(`[admin-agents] created agent #${agentId} for ${digits}; claimed ${claimed.linkedIds.length} listing(s)`);
  return { agentId, phone: digits, link: onboarding.activationLink(digits, token), claimed };
}

/**
 * "Vérifier le numéro" on an existing account. Sets `phone_verified_at`,
 * claims the number's listings, and — only when the account has no password
 * yet — issues an activation link (an account with a password keeps it, and
 * its sessions).
 *
 * Refused when another live, verified account holds the same number:
 * resolveAgentId would then pick one of the two arbitrarily.
 *
 * @returns {Promise<{agentId: number, phone: string, alreadyVerified: boolean, link: string|null, claimed: object}>}
 */
async function verifyAgentByAdmin(agentId) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) throw new AdminAgentError('not-found', 'agent id is required');
  if (!postgres.isConfigured()) throw new AdminAgentError('postgres-unavailable', 'Postgres is not configured');

  const client = await postgres.getPool().connect();
  let digits;
  let alreadyVerified = false;
  let token = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, phone, phone_verified_at, deleted_at, password_hash IS NOT NULL AS has_password
       FROM agents WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const agent = rows[0];
    if (!agent || agent.deleted_at) throw new AdminAgentError('not-found', `no live agent #${id}`);
    digits = checkPhone(agent.phone);

    const { rows: others } = await client.query(
      `SELECT id FROM agents
       WHERE regexp_replace(phone, '\\D', '', 'g') = $1 AND id <> $2
         AND phone_verified_at IS NOT NULL AND deleted_at IS NULL
       LIMIT 1`,
      [digits, id],
    );
    if (others.length) {
      throw new AdminAgentError('phone-verified-elsewhere', `${digits} is already verified on agent #${others[0].id}`, {
        agentId: Number(others[0].id),
      });
    }

    alreadyVerified = Boolean(agent.phone_verified_at);
    if (!agent.has_password) {
      token = require('crypto').randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + onboarding.ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
      await client.query(
        `UPDATE agents
         SET phone_verified_at = COALESCE(phone_verified_at, NOW()),
             activation_token_hash = $1, activation_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [onboarding.hashToken(token), expiresAt, id],
      );
    } else if (!alreadyVerified) {
      await client.query('UPDATE agents SET phone_verified_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const claimed = await claimListingsForNumber(digits, id);
  console.log(`[admin-agents] verified agent #${id} (${digits}); claimed ${claimed.linkedIds.length} listing(s)`);
  return { agentId: id, phone: digits, alreadyVerified, link: token ? onboarding.activationLink(digits, token) : null, claimed };
}

module.exports = {
  createAgentByAdmin,
  verifyAgentByAdmin,
  claimListingsForNumber,
  checkPhone,
  AdminAgentError,
  ERROR_STATUS,
  BUSINESS_NUMBERS,
};
