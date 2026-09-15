import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { keysetClause, pageCursors } from './adminPagination';
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSessionToken } from './customerAuth';
import { generateOtpCode, hashOtp, otpExpiresAt } from './authCrypto';
import { sendOtpViaWhatsApp, otpFallbackText } from './otpDelivery';
import { MAX_FAVORITES, MAX_SAVED_SEARCHES, MAX_FAVORITE_NOTE_LENGTH } from './accountLimits';
import { DEFAULT_ALERT_FREQUENCY } from './alertPreferences';

/**
 * Customer-account DB access — mirrors lib/listings.js's shape (plain async
 * functions over the shared Postgres pool, no ORM). Same Supabase Postgres
 * the engine writes to, but these tables (`customers`, `customer_favorites`,
 * `customer_saved_searches`) belong entirely to this app; nothing in the
 * engine repo reads or writes them.
 */

export async function getCustomerByPhone(phone) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, password_hash, full_name, token_version, failed_login_count, locked_until, created_at,
            reset_otp_code_hash, reset_otp_expires_at
     FROM customers WHERE phone = $1`,
    [phone],
  );
  return rows[0] || null;
}

// Memoised per request (React `cache()`, a no-op outside a render): the
// portal layout, its page and getCustomerInquiries all read the same row.
export const getCustomerById = cache(async (id) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, full_name, token_version, created_at FROM customers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
});

export async function createCustomer({ phone, passwordHash, fullName }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO customers (phone, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING id, phone, full_name, token_version, created_at`,
    [phone, passwordHash, fullName || null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Signup phone verification — the WhatsApp OTP a brand-new customer account
// has to clear before it can hold a session. Mirrors lib/agents.js's
// setAgentOtp/consumeAgentOtp/sendAgentOtp exactly, including the separate
// column pair: `otp_code_hash`/`otp_expires_at` belong to signup
// verification, `reset_otp_*` below to a password reset, and one flow must
// never invalidate the other's in-flight code.
// ---------------------------------------------------------------------------

/** Read by id for the verification step, which has no password to look up by. */
export async function getCustomerAuthById(customerId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, full_name, token_version, otp_code_hash, otp_expires_at, phone_verified_at
     FROM customers WHERE id = $1`,
    [customerId],
  );
  return rows[0] || null;
}

export async function setCustomerOtp(customerId, { codeHash, expiresAt }) {
  const pool = getPool();
  await pool.query(`UPDATE customers SET otp_code_hash = $1, otp_expires_at = $2 WHERE id = $3`, [
    codeHash,
    expiresAt,
    customerId,
  ]);
}

/**
 * Clears the code and stamps the verification in one statement — a used
 * code is never valid twice, and a verified number never re-verifies from a
 * replayed one.
 */
export async function consumeCustomerOtp(customerId) {
  const pool = getPool();
  await pool.query(
    `UPDATE customers
     SET otp_code_hash = NULL, otp_expires_at = NULL, phone_verified_at = NOW()
     WHERE id = $1`,
    [customerId],
  );
}

/**
 * Generates a real code, stores its hash, and actually delivers it — the
 * single place "make a code" and "send it" are composed, used by signup, by
 * the resend button, and by a login on a not-yet-verified account.
 */
export async function sendCustomerOtp(customerId, phone) {
  const code = generateOtpCode();
  await setCustomerOtp(customerId, { codeHash: hashOtp(code), expiresAt: otpExpiresAt() });
  await sendOtpViaWhatsApp(phone, code, { label: 'customer-auth', fallbackText: otpFallbackText(code) });
}

export async function recordFailedLogin(customerId, { lockUntil } = {}) {
  const pool = getPool();
  await pool.query(
    `UPDATE customers
     SET failed_login_count = failed_login_count + 1,
         locked_until = COALESCE($2, locked_until)
     WHERE id = $1`,
    [customerId, lockUntil || null],
  );
}

export async function clearFailedLoginsAndTouchLogin(customerId) {
  const pool = getPool();
  await pool.query(
    `UPDATE customers
     SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
     WHERE id = $1`,
    [customerId],
  );
}

/** Invalidates every outstanding session token for this account. */
export async function bumpTokenVersion(customerId) {
  const pool = getPool();
  await pool.query(`UPDATE customers SET token_version = token_version + 1 WHERE id = $1`, [customerId]);
}

export async function updateCustomerName(customerId, fullName) {
  const pool = getPool();
  await pool.query(`UPDATE customers SET full_name = $2 WHERE id = $1`, [customerId, fullName || null]);
}

export async function deleteCustomer(customerId) {
  const pool = getPool();
  await pool.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
}

// ---------------------------------------------------------------------------
// "Mot de passe oublié" — web/lib/resetPassword.js. Deliberately separate
// columns from anything else on this table (there's no signup-verification
// OTP for customers to collide with, unlike agents below), but kept
// symmetric with setAgentResetOtp/resetAgentPassword in lib/agents.js so
// resetPassword.js can drive both through one identical shape.
// ---------------------------------------------------------------------------

export async function setCustomerResetOtp(customerId, { codeHash, expiresAt }) {
  const pool = getPool();
  await pool.query(`UPDATE customers SET reset_otp_code_hash = $1, reset_otp_expires_at = $2 WHERE id = $3`, [
    codeHash,
    expiresAt,
    customerId,
  ]);
}

/**
 * The one write that actually completes a reset: new password, OTP cleared
 * (a used code is never valid twice), every outstanding session invalidated
 * (token_version bump — same mechanism logout-everywhere already uses), and
 * any login lockout cleared, since proving phone ownership via OTP is a
 * stronger signal than the failed-attempt counter it would otherwise still
 * be gating on.
 */
export async function resetCustomerPassword(customerId, passwordHash) {
  const pool = getPool();
  await pool.query(
    `UPDATE customers
     SET password_hash = $1, reset_otp_code_hash = NULL, reset_otp_expires_at = NULL,
         token_version = token_version + 1, failed_login_count = 0, locked_until = NULL
     WHERE id = $2`,
    [passwordHash, customerId],
  );
}

// ---------------------------------------------------------------------------
// Admin console (/admin/customers). Read-only listing plus the lookup the
// password-reset action needs. The reset itself reuses resetCustomerPassword
// above rather than adding a second UPDATE — an admin-set password and a
// self-service reset must leave the row in exactly the same state (password
// replaced, every outstanding session invalidated, lockout cleared), and two
// statements claiming to do that is how they drift.
// ---------------------------------------------------------------------------

/**
 * @param {{q?: string, limit?: number}} [options] `q` matches on phone digits
 *   or name. Matched against the stored E.164 digits, so a search for
 *   "0793" finds nothing and "44793" finds the number — the same thing the
 *   agents search already does, and the reason the placeholder says digits.
 */
export async function adminListCustomers({ q, limit = 200 } = {}) {
  const pool = getPool();
  const term = String(q || '').trim();
  const params = [Math.min(Number(limit) || 200, 500)];
  let where = '';
  if (term) {
    params.push(`%${term.replace(/[%_]/g, '')}%`);
    where = `WHERE c.phone ILIKE $2 OR COALESCE(c.full_name, '') ILIKE $2`;
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.phone, c.full_name, c.created_at, c.last_login_at,
            c.phone_verified_at, c.failed_login_count, c.locked_until,
            (c.password_hash IS NOT NULL AND c.password_hash <> '') AS has_password
     FROM customers c
     ${where}
     ORDER BY c.created_at DESC
     LIMIT $1`,
    params,
  );
  return rows;
}

export const ADMIN_CUSTOMER_STATUSES = ['active', 'locked', 'unverified'];

/**
 * One page of /admin/customers, with the counts the table shows.
 *
 * "Locked" is `locked_until > NOW()` — an expired lockout is an active account
 * again, which the old list got wrong by testing `locked_until` for NULL.
 * Saved-search and favourite counts are scalar sub-selects evaluated for the
 * page's rows only (both tables are indexed on customer_id). Enquiry counts
 * live in the engine's SQLite and are fetched per page by the caller.
 *
 * `q` matches the name, or the stored E.164 digits once separators are
 * stripped from what was typed — "+44 7932" finds 447932….
 */
export async function adminListCustomersPage({ q, status, limit = 25, offset = 0, cursor = null } = {}) {
  const pool = getPool();
  const params = [];
  const where = [];
  const raw = String(q || '').trim();
  if (raw) {
    params.push(`%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const nameParam = params.length;
    const digits = raw.replace(/\D/g, '');
    if (digits) {
      params.push(`%${digits}%`);
      where.push(`(COALESCE(c.full_name, '') ILIKE $${nameParam} OR c.phone LIKE $${params.length})`);
    } else {
      where.push(`COALESCE(c.full_name, '') ILIKE $${nameParam}`);
    }
  }
  if (status === 'locked') where.push('c.locked_until > NOW()');
  if (status === 'active') where.push('(c.locked_until IS NULL OR c.locked_until <= NOW())');
  if (status === 'unverified') where.push('c.phone_verified_at IS NULL');
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const keyset = keysetClause(cursor, { ts: 'c.created_at', id: 'c.id', descending: true }, params.length + 1);
  const pageWhere = [...where, keyset.condition].filter(Boolean);
  const pageParams = [...params, ...keyset.values];

  const [countResult, pageResult, summaryResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM customers c ${whereClause}`, params),
    pool.query(
      `SELECT c.id, c.phone, c.full_name, c.created_at, c.created_at::text AS cursor_ts, c.last_login_at,
              c.phone_verified_at, c.failed_login_count, c.locked_until,
              (c.locked_until IS NOT NULL AND c.locked_until > NOW()) AS is_locked,
              (c.password_hash IS NOT NULL AND c.password_hash <> '') AS has_password,
              (SELECT COUNT(*)::int FROM customer_saved_searches s WHERE s.customer_id = c.id) AS saved_searches_count,
              (SELECT COUNT(*)::int FROM customer_favorites f WHERE f.customer_id = c.id) AS favorites_count
       FROM customers c
       ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
       ORDER BY ${keyset.orderBy}
       LIMIT $${pageParams.length + 1} OFFSET $${pageParams.length + 2}`,
      [...pageParams, pageLimit, cursor ? 0 : pageOffset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE locked_until > NOW())::int AS locked,
              COUNT(*) FILTER (WHERE phone_verified_at IS NULL)::int AS unverified
       FROM customers`,
    ),
  ]);
  const rows = keyset.reverse ? [...pageResult.rows].reverse() : pageResult.rows;
  return {
    total: countResult.rows[0]?.total ?? 0,
    rows,
    cursors: pageCursors(rows),
    summary: summaryResult.rows[0] || { total: 0, locked: 0, unverified: 0 },
  };
}

/**
 * Lift a login lockout without touching the password. Clears exactly the two
 * columns the lockout consists of — the same two resetCustomerPassword clears
 * alongside the password — and leaves token_version alone, since nobody's
 * session needs to end for an account to be unlocked.
 */
export async function adminUnlockCustomer(customerId) {
  const { rowCount } = await getPool().query(
    'UPDATE customers SET failed_login_count = 0, locked_until = NULL WHERE id = $1',
    [customerId],
  );
  return (rowCount ?? 0) > 0;
}

/** One customer with the account facts the detail page shows. */
export async function adminGetCustomerProfile(customerId) {
  const id = Number.parseInt(customerId, 10);
  if (!Number.isFinite(id)) return null;
  const { rows } = await getPool().query(
    `SELECT c.id, c.phone, c.full_name, c.created_at, c.last_login_at, c.phone_verified_at,
            c.failed_login_count, c.locked_until,
            (c.locked_until IS NOT NULL AND c.locked_until > NOW()) AS is_locked,
            (c.password_hash IS NOT NULL AND c.password_hash <> '') AS has_password,
            COALESCE((SELECT array_agg(f.property_id ORDER BY f.created_at DESC) FROM customer_favorites f WHERE f.customer_id = c.id), ARRAY[]::bigint[]) AS favorite_ids
     FROM customers c WHERE c.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { ...row, id: Number(row.id), favorite_ids: (row.favorite_ids || []).map(Number) } : null;
}

/** The existence check the reset action runs before writing a password. */
export async function adminGetCustomerById(customerId) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, phone, full_name FROM customers WHERE id = $1`, [customerId]);
  return rows[0] || null;
}

export const listFavoriteIds = cache(async (customerId) => {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT property_id FROM customer_favorites WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => r.property_id);
});

/**
 * @returns {Promise<'added'|'exists'|'limit'>} `limit` when the account is
 *   already at MAX_FAVORITES (lib/accountLimits.js) — the callers turn that
 *   into a message rather than a silent revert.
 */
export async function addFavorite(customerId, propertyId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO customer_favorites (customer_id, property_id)
     SELECT $1, $2
     WHERE (SELECT COUNT(*) FROM customer_favorites WHERE customer_id = $1) < $3
     ON CONFLICT (customer_id, property_id) DO NOTHING
     RETURNING property_id`,
    [customerId, propertyId, MAX_FAVORITES],
  );
  if (rows.length > 0) return 'added';
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM customer_favorites WHERE customer_id = $1 AND property_id = $2`,
    [customerId, propertyId],
  );
  return existing.length > 0 ? 'exists' : 'limit';
}

/**
 * The customer's private notes on their saved listings, as {propertyId: note}.
 * Through to_jsonb, so the Favoris tab still renders before
 * migrations/20260918_customer_alert_preferences.sql adds the column.
 */
export async function listFavoriteNotes(customerId) {
  const { rows } = await getPool().query(
    `SELECT f.property_id, to_jsonb(f) ->> 'note' AS note
       FROM customer_favorites f
      WHERE f.customer_id = $1 AND COALESCE(to_jsonb(f) ->> 'note', '') <> ''`,
    [customerId],
  );
  return Object.fromEntries(rows.map((row) => [String(row.property_id), row.note]));
}

/**
 * Write (or clear, with an empty note) the note on one of THEIR favourites.
 * Owner-scoped in the WHERE clause; a listing they have not saved is a no-op.
 * @returns {Promise<boolean>} whether a favourite of theirs was updated
 */
export async function setFavoriteNote(customerId, propertyId, note) {
  const clean = String(note || '').trim().slice(0, MAX_FAVORITE_NOTE_LENGTH);
  const { rowCount } = await getPool().query(
    `UPDATE customer_favorites SET note = $3 WHERE customer_id = $1 AND property_id = $2`,
    [customerId, propertyId, clean || null],
  );
  return (rowCount ?? 0) > 0;
}

export async function removeFavorite(customerId, propertyId) {
  const pool = getPool();
  await pool.query(`DELETE FROM customer_favorites WHERE customer_id = $1 AND property_id = $2`, [
    customerId,
    propertyId,
  ]);
}

export const listSavedSearches = cache(async (customerId) => {
  const pool = getPool();
  // Preference columns through to_jsonb: safe before
  // migrations/20260918_customer_alert_preferences.sql has run.
  const { rows } = await pool.query(
    `SELECT css.id, css.query, css.label, css.created_at, css.last_viewed_at,
            COALESCE(to_jsonb(css) ->> 'alert_frequency', '${DEFAULT_ALERT_FREQUENCY}') AS alert_frequency,
            to_jsonb(css) ->> 'last_alerted_at' AS last_alerted_at
     FROM customer_saved_searches css WHERE css.customer_id = $1 ORDER BY css.created_at DESC`,
    [customerId],
  );
  return rows;
});

/**
 * Rename an alert and/or change how often it WhatsApps. Scoped to the owner in
 * the WHERE clause, so a guessed id changes nothing.
 *
 * @param {number} customerId from the session
 * @param {number} savedSearchId
 * @param {{label?: string, frequency?: 'daily'|'weekly'|'off'}} patch already validated by the caller
 * @returns {Promise<boolean>} whether a row of theirs was updated
 */
export async function updateSavedSearchPreferences(customerId, savedSearchId, { label, frequency } = {}) {
  const sets = [];
  const params = [savedSearchId, customerId];
  if (label !== undefined) {
    params.push(label);
    sets.push(`label = $${params.length}`);
  }
  if (frequency !== undefined) {
    params.push(frequency);
    sets.push(`alert_frequency = $${params.length}`);
  }
  if (sets.length === 0) return false;
  const { rowCount } = await getPool().query(
    `UPDATE customer_saved_searches SET ${sets.join(', ')} WHERE id = $1 AND customer_id = $2`,
    params,
  );
  return (rowCount ?? 0) > 0;
}

/** When this account stopped WhatsApp alerts, or null. Safe before the migration. */
export async function getWhatsAppAlertsOptOut(customerId) {
  const { rows } = await getPool().query(
    `SELECT to_jsonb(c) ->> 'whatsapp_alerts_opted_out_at' AS opted_out_at FROM customers c WHERE c.id = $1`,
    [customerId],
  );
  return rows[0]?.opted_out_at || null;
}

/**
 * Account-wide stop / restart. Stopping keeps the FIRST opt-out time (a second
 * click must not move "since when"); restarting clears it. Saved searches and
 * their per-search frequency are untouched either way.
 */
export async function setWhatsAppAlertsOptOut(customerId, optedOut) {
  await getPool().query(
    `UPDATE customers
        SET whatsapp_alerts_opted_out_at = CASE WHEN $2::boolean THEN COALESCE(whatsapp_alerts_opted_out_at, now()) ELSE NULL END
      WHERE id = $1`,
    [customerId, Boolean(optedOut)],
  );
}

/** @returns {Promise<'added'|'exists'|'limit'>} see addFavorite; ceiling is MAX_SAVED_SEARCHES. */
export async function addSavedSearch(customerId, { query, label }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO customer_saved_searches (customer_id, query, label)
     SELECT $1, $2, $3
     WHERE (SELECT COUNT(*) FROM customer_saved_searches WHERE customer_id = $1) < $4
     ON CONFLICT (customer_id, query) DO NOTHING
     RETURNING id`,
    [customerId, query, label, MAX_SAVED_SEARCHES],
  );
  if (rows.length > 0) return 'added';
  const { rows: existing } = await pool.query(
    `SELECT 1 FROM customer_saved_searches WHERE customer_id = $1 AND query = $2`,
    [customerId, query],
  );
  return existing.length > 0 ? 'exists' : 'limit';
}

export async function removeSavedSearch(customerId, query) {
  const pool = getPool();
  await pool.query(`DELETE FROM customer_saved_searches WHERE customer_id = $1 AND query = $2`, [
    customerId,
    query,
  ]);
}

export async function touchSavedSearchesViewed(customerId, searchIds) {
  if (!searchIds || searchIds.length === 0) return;
  const pool = getPool();
  await pool.query(
    `UPDATE customer_saved_searches SET last_viewed_at = now()
     WHERE customer_id = $1 AND id = ANY($2::bigint[])`,
    [customerId, searchIds],
  );
}

/**
 * One-time merge of a visitor's anonymous localStorage data into a newly
 * authenticated account, on first login/signup — additive and idempotent
 * (ON CONFLICT DO NOTHING), so logging in again on the same device is a
 * harmless no-op rather than a duplicate-row error.
 */
export async function mergeAnonymousData(customerId, { favoriteIds = [], savedSearches = [] }) {
  const pool = getPool();
  const numericFavoriteIds = favoriteIds.map((id) => Number.parseInt(id, 10)).filter((id) => Number.isFinite(id));

  if (numericFavoriteIds.length > 0) {
    // Same ceiling as a one-at-a-time save: only as many as the account has
    // room for, in the order they were saved on the device.
    await pool.query(
      `INSERT INTO customer_favorites (customer_id, property_id)
       SELECT $1, u.id FROM unnest($2::int[]) WITH ORDINALITY AS u(id, ord)
       ORDER BY u.ord
       LIMIT GREATEST($3 - (SELECT COUNT(*) FROM customer_favorites WHERE customer_id = $1), 0)
       ON CONFLICT (customer_id, property_id) DO NOTHING`,
      [customerId, numericFavoriteIds, MAX_FAVORITES],
    );
  }

  for (const search of savedSearches) {
    if (!search?.query || !search?.label) continue;
    const status = await addSavedSearch(customerId, { query: search.query, label: search.label });
    if (status === 'limit') break;
  }
}

/**
 * The one function every gated page/route calls. Reads the httpOnly session
 * cookie, verifies it, and returns the customer id or null — never trusts
 * the client-readable `lukka_logged_in` flag cookie for anything beyond
 * picking a client-side code path (see customerClient.js).
 *
 * @returns {Promise<number|null>}
 */
export const getCurrentCustomerId = cache(async () => {
  const cookieStore = await cookies();
  return resolveCustomerSession(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value);
});

/**
 * A raw session token -> the customer id it still speaks for, or null.
 *
 * Signature and expiry are the pure-crypto half middleware.js also checks.
 * The second half is the one that was missing: the token's `tokenVersion`
 * must equal the account's CURRENT `token_version`. Logout, a self-service
 * password reset and an admin password reset all bump that column to end
 * every other session — and until this compared it, none of them did: a
 * copied cookie kept working for its full 30 days. lib/adminSession.js has
 * always made the same comparison for the console.
 *
 * A deleted account has no row, so its sessions end here too.
 *
 * One primary-key read. getCurrentCustomerId is wrapped in React `cache()`,
 * so a layout and page asking in the same request share it.
 *
 * @param {string|undefined} token
 * @returns {Promise<number|null>}
 */
export async function resolveCustomerSession(token) {
  const verified = verifyCustomerSessionToken(token);
  if (!verified) return null;
  const { rows } = await getPool().query('SELECT token_version FROM customers WHERE id = $1', [
    verified.customerId,
  ]);
  const row = rows[0];
  if (!row || Number(row.token_version) !== verified.tokenVersion) return null;
  return verified.customerId;
}
