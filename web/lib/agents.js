import 'server-only';
import { getPool } from './db';
import { generateOtpCode, hashOtp, otpExpiresAt } from './agentAuth';
import { sendWhatsAppTemplate, claimListingsForPhone } from './adminApi';

/**
 * Reads/writes against the real Laravel/Zipprr schema that already lives in
 * this same Supabase Postgres database (agents/vendors/agent_infos/
 * memberships/packages) — a completely separate table family from
 * properties/property_contents that lib/listings.js owns. Confirmed real
 * data (5 vendors, 7 memberships) coexists with the one placeholder `agents`
 * row; every join below is LEFT JOIN and every optional field is allowed to
 * come back null — the UI renders '—' rather than inventing a default.
 *
 * There is no `max_active_listings` column anywhere in this schema. The real
 * per-agency listing cap is `packages.number_of_property`, reached through
 * the vendor's currently-active `memberships` row — that's what this module
 * surfaces instead of a fabricated field.
 */

const AGENT_FIELDS = `
  a.id, a.username, a.email, a.phone, a.status, a.vendor_id, a.image, a.primary_communes,
  a.working_hours, a.phone_verified_at,
  v.username AS vendor_username,
  ai.first_name, ai.last_name, ai.address, ai.city,
  p.title AS package_title, p.number_of_property AS listing_limit, p.term AS package_term,
  p.monthly_pitch_limit,
  m.expire_date, m.is_trial AS subscription_is_trial,
  (SELECT count(*) FROM properties WHERE agent_id = a.id)::int AS listing_count,
  (SELECT count(*) FROM properties
   WHERE agent_id = a.id AND status = 1 AND approve_status = 1)::int AS live_listing_count
`;

// LATERAL, not a plain LEFT JOIN, on purpose: agent_infos is a per-language
// content table (same pattern as property_contents/hero_statics — one row
// per language_id, confirmed directly: agent #28 has two agent_infos rows,
// language_id 20 and 26) and a vendor can in principle hold more than one
// currently-active membership row. A plain LEFT JOIN on either fans out into
// duplicate agent rows — caught live in the browser (agent #28 rendered
// twice) before this fix. LATERAL + LIMIT 1 guarantees at most one match
// each, deterministically, instead of assuming "there's only ever one row"
// and quietly breaking again the next time that assumption stops holding.
const AGENT_JOINS = `
  FROM agents a
  LEFT JOIN vendors v ON v.id = a.vendor_id
  LEFT JOIN LATERAL (
    SELECT first_name, last_name, address, city FROM agent_infos
    WHERE agent_id = a.id
    ORDER BY (language_id = 20) DESC, language_id
    LIMIT 1
  ) ai ON true
  LEFT JOIN LATERAL (
    SELECT package_id, expire_date, is_trial FROM memberships
    WHERE vendor_id = v.id AND status = 1 AND expire_date > NOW()
    ORDER BY expire_date DESC
    LIMIT 1
  ) m ON true
  LEFT JOIN packages p ON p.id = m.package_id
`;

/**
 * @param {{q?: string}} [options] `q` matches username/email/phone via ILIKE.
 * @returns {Promise<Array<object>>}
 */
export async function getAgents({ q } = {}) {
  const pool = getPool();
  const term = q?.trim();

  const { rows } = await pool.query(
    `SELECT ${AGENT_FIELDS} ${AGENT_JOINS}
     WHERE $1::text IS NULL OR a.username ILIKE $1 OR a.email ILIKE $1 OR a.phone ILIKE $1
     ORDER BY a.created_at DESC NULLS LAST`,
    [term ? `%${term}%` : null],
  );
  return rows;
}

/**
 * Public agent directory (web/app/(site)/agents/page.js) — active agents
 * with at least one real listing behind them, matching this app's own
 * no-empty-directory-entry convention (same reasoning as ExploreCommunes.js
 * only showing a commune tile once a real listing exists there).
 * listing_count is a correlated scalar subquery in AGENT_FIELDS, not an
 * aggregate over this query's own rows, so the >0 filter happens in JS
 * after the fetch rather than a SQL HAVING clause — real agent counts are
 * small (tens, not thousands; see admin/dashboard's own "Agents actifs"
 * stat), so this stays simple instead of restructuring the query.
 *
 * Filters and orders on `live_listing_count`, NOT `listing_count`. The
 * latter counts every property row attributed to the agent regardless of
 * moderation state, while the storefront this links to
 * (lib/agencies.js -> getListings) applies the full approved filter — so an
 * agent whose listings were all pending or rejected appeared in the
 * directory and led to a completely empty page. No agent triggers that
 * today, which is exactly why it needed pinning rather than leaving until it
 * broke in front of a visitor.
 */
export async function getPublicAgents() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_FIELDS} ${AGENT_JOINS} WHERE a.status = 1 ORDER BY live_listing_count DESC NULLS LAST`,
  );
  return rows.filter((r) => r.live_listing_count > 0);
}

export async function getAgentById(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;

  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${AGENT_FIELDS} ${AGENT_JOINS} WHERE a.id = $1`, [numericId]);
  return rows[0] || null;
}

/** For the agency-reassignment dropdown — real vendors only, no fabricated list. */
export async function getVendors() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, username, email FROM vendors ORDER BY username');
  return rows;
}

// ---------------------------------------------------------------------------
// Agent self-service auth (web/lib/agentAuth.js) — mirrors lib/customers.js's
// shape exactly. Deliberately separate query set from AGENT_FIELDS above:
// login/signup only ever need the raw agents row, never the CRM joins.
// ---------------------------------------------------------------------------

export async function getAgentByPhone(phone) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, email, username, password_hash, token_version, failed_login_count,
            locked_until, phone_verified_at, otp_code_hash, otp_expires_at,
            reset_otp_code_hash, reset_otp_expires_at
     FROM agents WHERE phone = $1`,
    [phone],
  );
  return rows[0] || null;
}

/** Self-service settings (change-password form) — same auth-shape query as getAgentByPhone, keyed by id instead. */
export async function getAgentAuthById(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, email, username, password_hash, token_version, failed_login_count, locked_until
     FROM agents WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

export async function createAgent({ phone, passwordHash }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO agents (phone, password_hash, username, status, created_at, updated_at)
     VALUES ($1, $2, $1, 1, NOW(), NOW())
     RETURNING id, phone, token_version`,
    [phone, passwordHash],
  );
  return rows[0];
}

export async function recordAgentFailedLogin(agentId, { lockUntil } = {}) {
  const pool = getPool();
  await pool.query(
    `UPDATE agents SET failed_login_count = failed_login_count + 1, locked_until = COALESCE($2, locked_until)
     WHERE id = $1`,
    [agentId, lockUntil || null],
  );
}

export async function clearAgentFailedLogins(agentId) {
  const pool = getPool();
  await pool.query(`UPDATE agents SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [agentId]);
}

/** Invalidates every outstanding session token for this account — logout. */
export async function bumpAgentTokenVersion(agentId) {
  const pool = getPool();
  await pool.query(`UPDATE agents SET token_version = token_version + 1 WHERE id = $1`, [agentId]);
}

export async function setAgentOtp(agentId, { codeHash, expiresAt }) {
  const pool = getPool();
  await pool.query(`UPDATE agents SET otp_code_hash = $1, otp_expires_at = $2 WHERE id = $3`, [
    codeHash,
    expiresAt,
    agentId,
  ]);
}

/**
 * Clears the OTP and marks the phone verified in one write — a used code is
 * never valid twice — then claims any listings this number already published.
 *
 * The claim step matters because listing attribution is otherwise resolved
 * only during a WhatsApp sync, and a sync only happens on publish or
 * correction. An agent who sent listings before creating an account was never
 * linked to any of them: 23 of 31 live listings had no agent at all when this
 * was written, so their submitters could not edit them, mark them sold, or
 * see them in a dashboard, and every enquiry routed to the central number.
 *
 * Verification is the right trigger: it is the exact moment we first have
 * evidence this person holds that number, and the engine's own resolver only
 * matches phone-verified agents for the same reason.
 *
 * Deliberately best-effort — a failure here must not fail a verification that
 * has already succeeded. The agent is verified either way; the listings are
 * picked up by the next call or by an admin. It is safe to retry because the
 * claim only ever fills a NULL agent_id.
 */
export async function consumeAgentOtp(agentId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE agents SET otp_code_hash = NULL, otp_expires_at = NULL, phone_verified_at = NOW()
     WHERE id = $1 RETURNING phone`,
    [agentId],
  );

  const phone = rows[0]?.phone;
  if (!phone) return;

  try {
    const result = await claimListingsForPhone(phone);
    if (result?.linked) {
      console.log(`[agents] agent #${agentId} claimed ${result.linked} existing listing(s) on verification`);
    }
  } catch (err) {
    console.error(`[agents] listing claim failed for agent #${agentId}: ${err.message}`);
  }
}

/**
 * Generates a real code, stores its hash, and actually sends it via the
 * engine's Chakra connection (web/ has no WhatsApp credentials of its own —
 * see web/lib/adminApi.js's sendWhatsAppMessage). Shared by both the
 * registration flow and a login attempt on a not-yet-verified account, so
 * there's exactly one place that composes "make a code" + "deliver it."
 */
export async function sendAgentOtp(agentId, phone) {
  const code = generateOtpCode();
  await setAgentOtp(agentId, { codeHash: hashOtp(code), expiresAt: otpExpiresAt() });

  // Delivered as an approved template, NOT a free-form text. Meta only
  // delivers free-form messages to someone who has messaged this business
  // within the last 24 hours; a first-time registrant never has, so the old
  // sendWhatsAppMessage call was accepted with a real message id and then
  // silently never arrived — verified directly against the live account,
  // where the API returned 200 and no handset ever rang.
  //
  // The template name/language are env-driven because they live in Meta's
  // WhatsApp Manager, not in this repo — an approval there must not require
  // a code change here. OTP_TEMPLATE_HAS_BUTTON exists because Meta rejects
  // an AUTHENTICATION-category template sent without its copy-code button
  // and equally rejects a button component on a template that declares
  // none; only whoever approved the template knows which shape it is.
  const template = process.env.AGENT_OTP_TEMPLATE || 'agent_auth_otp';
  const languageCode = process.env.AGENT_OTP_TEMPLATE_LANG || 'fr';
  const withButton = process.env.AGENT_OTP_TEMPLATE_HAS_BUTTON !== '0';

  await sendWhatsAppTemplate(phone, {
    template,
    languageCode,
    bodyParams: [code],
    otpCode: withButton ? code : undefined,
  });
}

// ---------------------------------------------------------------------------
// "Mot de passe oublié" — web/lib/resetPassword.js. Separate reset_otp_*
// columns from otp_code_hash/otp_expires_at above on purpose: those two
// belong to signup phone-verification, this pair to a password reset: an
// agent resetting their password mid-signup-verification (or vice versa)
// must never have one flow silently invalidate the other's in-flight code.
// Symmetric shape with setCustomerResetOtp/resetCustomerPassword in
// lib/customers.js so resetPassword.js can drive both roles identically.
// ---------------------------------------------------------------------------

export async function setAgentResetOtp(agentId, { codeHash, expiresAt }) {
  const pool = getPool();
  await pool.query(`UPDATE agents SET reset_otp_code_hash = $1, reset_otp_expires_at = $2 WHERE id = $3`, [
    codeHash,
    expiresAt,
    agentId,
  ]);
}

/**
 * Writes agents.password_hash only — never the legacy Laravel `agents.password`
 * (bcrypt) column; see this file's/agentAuth.js's doc comments on why that
 * column stays untouched by this app. Also clears any login lockout: proving
 * phone ownership via OTP is a stronger signal than the failed-attempt
 * counter it would otherwise still be gating on.
 */
export async function resetAgentPassword(agentId, passwordHash) {
  const pool = getPool();
  await pool.query(
    `UPDATE agents
     SET password_hash = $1, reset_otp_code_hash = NULL, reset_otp_expires_at = NULL,
         token_version = token_version + 1, failed_login_count = 0, locked_until = NULL
     WHERE id = $2`,
    [passwordHash, agentId],
  );
}
