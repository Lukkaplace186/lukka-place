import 'server-only';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSessionToken } from './customerAuth';

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
    `SELECT id, phone, password_hash, full_name, token_version, failed_login_count, locked_until, created_at
     FROM customers WHERE phone = $1`,
    [phone],
  );
  return rows[0] || null;
}

export async function getCustomerById(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, phone, full_name, token_version, created_at FROM customers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

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

export async function listFavoriteIds(customerId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT property_id FROM customer_favorites WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows.map((r) => r.property_id);
}

export async function addFavorite(customerId, propertyId) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO customer_favorites (customer_id, property_id) VALUES ($1, $2)
     ON CONFLICT (customer_id, property_id) DO NOTHING`,
    [customerId, propertyId],
  );
}

export async function removeFavorite(customerId, propertyId) {
  const pool = getPool();
  await pool.query(`DELETE FROM customer_favorites WHERE customer_id = $1 AND property_id = $2`, [
    customerId,
    propertyId,
  ]);
}

export async function listSavedSearches(customerId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, query, label, created_at, last_viewed_at
     FROM customer_saved_searches WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId],
  );
  return rows;
}

export async function addSavedSearch(customerId, { query, label }) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO customer_saved_searches (customer_id, query, label) VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, query) DO NOTHING`,
    [customerId, query, label],
  );
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
    await pool.query(
      `INSERT INTO customer_favorites (customer_id, property_id)
       SELECT $1, unnest($2::int[])
       ON CONFLICT (customer_id, property_id) DO NOTHING`,
      [customerId, numericFavoriteIds],
    );
  }

  for (const search of savedSearches) {
    if (!search?.query || !search?.label) continue;
    await addSavedSearch(customerId, { query: search.query, label: search.label });
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
export async function getCurrentCustomerId() {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  const verified = verifyCustomerSessionToken(token);
  return verified?.customerId ?? null;
}
