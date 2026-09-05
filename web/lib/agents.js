import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './db';
import { generateOtpCode, hashOtp, otpExpiresAt } from './agentAuth';
import { sendWhatsAppTemplate, sendWhatsAppMessage, claimListingsForPhone } from './adminApi';

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

/**
 * SHA-256 of an activation token — the engine stores only this
 * (`agents.activation_token_hash`), never the raw value. Plain SHA-256 rather
 * than the salted scrypt used for passwords and OTPs: this token is 32 bytes
 * of `crypto.randomBytes`, so it has no guessable structure for a work factor
 * to defend, and both sides of the comparison have to derive the same digest
 * from the same input with no stored salt to share across two applications.
 * Must stay byte-identical to services/agentOnboarding.js's hashToken().
 */
function hashActivationToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Redeems a WhatsApp activation link: verifies the token against the stored
 * hash, sets the agent's first password, and clears the token so the link
 * cannot be replayed.
 *
 * Single-statement, single-round-trip on purpose. The check and the clear
 * happen in one UPDATE with the conditions in its own WHERE clause, so two
 * concurrent submissions of the same link cannot both succeed — the second
 * finds `activation_token_hash` already NULL and updates zero rows. A
 * read-then-write version would have a real race here.
 *
 * `token_version` is bumped in the same statement: any session that somehow
 * existed for this account before its password was set is invalidated by the
 * act of setting one.
 *
 * The comparison is a plain SQL equality on a SHA-256 digest, not
 * timingSafeEqual. That is deliberate and safe here: the attacker-controlled
 * value is hashed BEFORE it reaches the database, so a timing difference
 * leaks information about the digest of their own guess, not about the
 * stored secret — there is no prefix to walk. (A password check, where the
 * candidate is compared after a salted KDF the attacker cannot precompute,
 * is a different situation and correctly uses verifyAgainstStoredForm.)
 *
 * @param {{phone: string, token: string, passwordHash: string}} input
 * @returns {Promise<{id: number, token_version: number}|null>} null when the
 *   token is wrong, expired, or already used.
 */
export async function consumeAgentActivationToken({ phone, token, passwordHash }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || !token) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE agents
     SET password_hash = $1,
         activation_token_hash = NULL,
         activation_expires_at = NULL,
         phone_verified_at = COALESCE(phone_verified_at, NOW()),
         token_version = token_version + 1,
         status = 1,
         updated_at = NOW()
     WHERE regexp_replace(phone, '\D', '', 'g') = $2
       AND activation_token_hash = $3
       AND activation_expires_at > NOW()
     RETURNING id, token_version`,
    [passwordHash, digits, hashActivationToken(token)],
  );

  const agent = rows[0];
  if (!agent) return null;

  // Retroactive claiming, the moment the account becomes fully usable. The
  // engine already links listings at onboarding time; this covers anything
  // submitted between the WhatsApp registration and this click. Best-effort:
  // the engine being unreachable must not fail an activation that has
  // already committed.
  try {
    await claimListingsForPhone(digits);
  } catch (err) {
    console.warn(`[agent-activate] listing claim failed for ${digits}: ${err.message}`);
  }

  return { id: Number(agent.id), token_version: agent.token_version };
}

/**
 * The activation landing page's own pre-flight check — is this link still
 * good? Read-only, so the page can render "ce lien a expiré" with a real
 * next step instead of showing a password form that will fail on submit.
 *
 * @returns {Promise<{valid: boolean, agentName: string|null, agencyName: string|null}>}
 */
export async function peekAgentActivation({ phone, token }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits || !token) return { valid: false, agentName: null, agencyName: null };

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.id, a.username, a.agency_name, ai.first_name, ai.last_name
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT first_name, last_name FROM agent_infos
       WHERE agent_id = a.id ORDER BY (language_id = 20) DESC, language_id LIMIT 1
     ) ai ON true
     WHERE regexp_replace(a.phone, '\D', '', 'g') = $1
       AND a.activation_token_hash = $2
       AND a.activation_expires_at > NOW()
     LIMIT 1`,
    [digits, hashActivationToken(token)],
  );

  const row = rows[0];
  if (!row) return { valid: false, agentName: null, agencyName: null };
  return {
    valid: true,
    agentName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || null,
    agencyName: row.agency_name || null,
  };
}

/**
 * One agent, with everything the admin identity page edits — a superset of
 * getAgentById's fields plus the columns that only /admin touches
 * (activation state, onboarding provenance, serviced territory).
 */
export async function getAgentForAdmin(agentId) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${AGENT_FIELDS},
            a.serviced_communes, a.agency_name, a.onboarding_source,
            a.activation_expires_at, a.password_hash IS NOT NULL AS has_password,
            a.locked_until, a.failed_login_count, a.created_at
     ${AGENT_JOINS}
     WHERE a.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { ...row, id: Number(row.id) } : null;
}

/**
 * Full identity override. Every field is optional: `undefined` leaves the
 * column alone, so a one-field correction doesn't blank the rest.
 *
 * `phone` is deliberately NOT editable here. It is the primary identifier for
 * this whole platform — listings are claimed by it (services/postgres.js's
 * linkListingsToAgent), sessions belong to the account it identifies, and the
 * WhatsApp verification that granted the badge was performed against that
 * exact number. Editing it in an admin form would silently invalidate all
 * three with no visible signal. A genuinely wrong number means a new account
 * plus a listing reassignment, which is at least honest about what happened.
 */
export async function adminUpdateAgent(agentId, {
  agencyName, email, status, primaryCommunes, servicedCommunes, phoneVerified,
}) {
  const sets = [];
  const values = [];
  const push = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (agencyName !== undefined) push('agency_name', agencyName);
  if (email !== undefined) push('email', email);
  if (status !== undefined) push('status', status);
  if (primaryCommunes !== undefined) push('primary_communes', primaryCommunes);
  if (servicedCommunes !== undefined) push('serviced_communes', servicedCommunes);
  // A verification badge is a claim about reality, so it can be REVOKED here
  // (an admin discovering the number isn't theirs) but granting it stamps
  // NOW() rather than an arbitrary date — the badge means "verified", and the
  // timestamp records when we said so.
  if (phoneVerified !== undefined) {
    if (phoneVerified) sets.push('phone_verified_at = COALESCE(phone_verified_at, NOW())');
    else sets.push('phone_verified_at = NULL');
  }

  if (!sets.length) return false;

  const pool = getPool();
  values.push(agentId);
  const { rowCount } = await pool.query(
    `UPDATE agents SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
    values,
  );
  return rowCount > 0;
}

/**
 * Locks an account out immediately: every existing session for it stops
 * verifying, because a session token carries the `token_version` it was
 * issued under (lib/agentAuth.js) and this makes that stale.
 *
 * This is what "invalidate compromised sessions" actually means here — there
 * is no server-side session store to delete rows from, by design.
 */
export async function revokeAgentSessions(agentId) {
  const pool = getPool();
  const { rowCount } = await pool.query(
    'UPDATE agents SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1',
    [agentId],
  );
  return rowCount > 0;
}

/**
 * Issues a fresh activation link for an agent and sends it over WhatsApp —
 * the admin-side "reset this agent's password" and "resend their magic link"
 * in one action, because on this platform they are the same operation.
 *
 * Deliberately NOT a password an admin picks and reads out: nobody at Lukka
 * Place should ever know an agent's password, and a temporary one relayed by
 * hand is a live credential sitting in a chat log. The link goes to the
 * number the account is already verified against, so only the account holder
 * can use it.
 *
 * Sessions are revoked in the same statement. A password reset that leaves an
 * attacker's existing session alive resets nothing.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function issueAgentActivationLink(agentId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, phone FROM agents WHERE id = $1', [agentId]);
  const agent = rows[0];
  if (!agent) return { ok: false, error: 'Agent introuvable.' };
  if (!agent.phone) return { ok: false, error: 'Cet agent n’a pas de numéro WhatsApp enregistré.' };

  const token = randomBytes(32).toString('hex');
  const ttlHours = Number.parseInt(process.env.AGENT_ACTIVATION_TTL_HOURS, 10) || 72;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  await pool.query(
    `UPDATE agents
     SET activation_token_hash = $1, activation_expires_at = $2,
         token_version = token_version + 1, failed_login_count = 0, locked_until = NULL,
         updated_at = NOW()
     WHERE id = $3`,
    [hashActivationToken(token), expiresAt, agentId],
  );

  const digits = String(agent.phone).replace(/\D/g, '');
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
  const link = `${siteUrl}/compte/agent/activer?phone=${encodeURIComponent(digits)}&token=${token}`;

  try {
    await sendWhatsAppMessage(
      digits,
      [
        'Lukka Place — réinitialisation de votre accès agent.',
        '',
        'Cliquez ici pour choisir un nouveau mot de passe :',
        link,
        '',
        `Ce lien est valable ${ttlHours} heures. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.`,
      ].join('\n'),
    );
  } catch (err) {
    // The token is already stored, so the link genuinely works — only the
    // delivery failed. Saying so lets the admin relay it another way instead
    // of being told the whole operation failed when it did not.
    return { ok: false, error: `Lien créé mais l'envoi WhatsApp a échoué : ${err.message}` };
  }

  return { ok: true };
}

/**
 * Accounts that look like the same person registered twice.
 *
 * Two real signals, and no heuristic dressed up as a certainty:
 *
 *   - THE SAME NUMBER, DIFFERENT FORMATTING. `agents.phone` is free text
 *     (varchar), and one line genuinely appears as '243997123456',
 *     '+243 997 123 456' and '0997123456' depending on how it was entered.
 *     Reducing to digits and folding a leading national '0' onto the 243
 *     country code is what collapses those three into one group.
 *   - THE SAME EMAIL, case-insensitively.
 *
 * Deliberately NOT name similarity: several very common names in Kinshasa
 * would group unrelated agencies together, and presenting that as a duplicate
 * finding is a guess wearing a fact's clothes. This returns groups to REVIEW;
 * it never merges anything.
 */
export async function findDuplicateAgents() {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH digits AS (
       SELECT id, username, email, phone, status, created_at,
              regexp_replace(phone, '[^0-9]', '', 'g') AS d
       FROM agents
       WHERE phone IS NOT NULL AND phone <> ''
     ),
     normalised AS (
       SELECT id, username, email, phone, status, created_at,
              -- DRC mobile numbers only. '243' + 9 digits is already
              -- canonical; '0' + 9 digits is the local form; a bare 9 digits
              -- starting 8 or 9 is how they are commonly typed.
              --
              -- Anything else keeps EXACTLY its own digits, uncanonicalised.
              -- An unconditional '243' prefix turned a real UK number
              -- (447932673460, agent #37 in production) into
              -- '243447932673460' — harmless in that instance because it
              -- grouped with nothing, but exactly the kind of silent mangling
              -- that eventually matches two unrelated accounts together.
              CASE
                WHEN d ~ '^243[0-9]{9}$'  THEN d
                WHEN d ~ '^0[0-9]{9}$'    THEN '243' || substring(d from 2)
                WHEN d ~ '^[89][0-9]{8}$' THEN '243' || d
                ELSE d
              END AS phone_key
       FROM digits
     )
     SELECT phone_key AS key, 'phone' AS kind,
            json_agg(json_build_object(
              'id', id, 'username', username, 'email', email, 'phone', phone,
              'status', status, 'created_at', created_at
            ) ORDER BY id) AS accounts
     FROM normalised
     GROUP BY phone_key
     HAVING COUNT(*) > 1

     UNION ALL

     SELECT LOWER(email) AS key, 'email' AS kind,
            json_agg(json_build_object(
              'id', id, 'username', username, 'email', email, 'phone', phone,
              'status', status, 'created_at', created_at
            ) ORDER BY id) AS accounts
     FROM agents
     WHERE email IS NOT NULL AND email <> ''
     GROUP BY LOWER(email)
     HAVING COUNT(*) > 1`,
  );
  return rows;
}

/**
 * Moves every listing from one agent to another — the "bulk-reassign their
 * inventory" an admin needs before suspending or retiring an account, so the
 * properties don't silently fall back to the central WhatsApp number.
 *
 * @returns {Promise<number>} how many listings moved.
 */
export async function reassignAgentListings(fromAgentId, toAgentId) {
  const pool = getPool();
  const { rows } = await pool.query(
    'UPDATE properties SET agent_id = $1, updated_at = NOW() WHERE agent_id = $2 RETURNING id',
    [toAgentId, fromAgentId],
  );
  return rows.length;
}
