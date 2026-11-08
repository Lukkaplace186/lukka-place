import 'server-only';
import { hashToStoredForm, hashToStoredFormAsync, verifyAgainstStoredForm, verifyAgainstStoredFormAsync, safeEqualHex, hmacSign } from './authCrypto';

/**
 * Phone + password auth for customer accounts. Extends adminAuth.js's proven
 * primitives (scrypt, HMAC + timingSafeEqual, stateless signed cookie) but
 * cannot reuse its single-shared-secret model as-is: there are many
 * customers, not one team password, so the session token has to carry a
 * real identity (`customerId`), and a password needs a real per-row salt
 * (not one hash pasted into an env var).
 *
 * Cookie path is `/`, not `/compte` — deliberately different from the admin
 * cookie's `/admin` scoping. FavoriteButton/SaveSearchButton render on `/`,
 * `/listings` and `/listings/[id]`, all of which need to know login state,
 * not just pages under `/compte`.
 *
 * `tokenVersion` in the payload is the revocation mechanism: bumping
 * `customers.token_version` (logout, password reset, admin reset) invalidates
 * every outstanding token for that account. It is compared in
 * lib/customers.js's `resolveCustomerSession`, which every page, action and
 * /api/account route reaches through `getCurrentCustomerId` — NOT inside
 * middleware, which stays pure-crypto so its per-request cost doesn't grow.
 * So a revoked cookie still passes middleware's signature check, and is
 * refused one step later by the first identity read.
 *
 * (This comment previously claimed the comparison happened "wherever a page
 * already reads the customer row". Nothing compared it, so logout-everywhere
 * and password resets ended no other session at all.)
 */

const SESSION_COOKIE = 'lukka_customer_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — "remember me" is the default expectation for a consumer app

function sessionSecret() {
  const secret = process.env.CUSTOMER_SESSION_SECRET;
  if (!secret) throw new Error('CUSTOMER_SESSION_SECRET is not set — see .env.local');
  return secret;
}

export function hashPassword(password) {
  return hashToStoredForm(String(password ?? ''));
}

export function verifyPasswordAgainstHash(candidate, storedHash) {
  return verifyAgainstStoredForm(candidate, storedHash);
}

// Non-blocking twins for the customer sign-up and login hot paths (a
// campaign rush): same hash, computed off the web process's main thread.
export function hashPasswordAsync(password) {
  return hashToStoredFormAsync(String(password ?? ''));
}

export function verifyPasswordAgainstHashAsync(candidate, storedHash) {
  return verifyAgainstStoredFormAsync(candidate, storedHash);
}

// A fixed dummy hash, computed once, to run against when a phone number
// isn't found at all — so "phone doesn't exist" and "phone exists, wrong
// password" cost the same scrypt CPU time and don't leak which case
// happened via response timing.
const DUMMY_HASH = hashToStoredForm('lukka-customer-auth-dummy-comparison-value');
export function burnConstantTime(candidate) {
  verifyAgainstStoredForm(candidate, DUMMY_HASH);
}

export async function burnConstantTimeAsync(candidate) {
  await verifyAgainstStoredFormAsync(candidate, DUMMY_HASH);
}

function sign(value) {
  return hmacSign(sessionSecret(), value);
}

/** `${customerId}.${tokenVersion}.${expiresAtMs}.${hmac}` */
// `ttlMs` is shorter only for an admin's "view as" session (lib/impersonationCookies.js).
export function createCustomerSessionToken({ customerId, tokenVersion, ttlMs = SESSION_TTL_MS }) {
  const expiresAt = String(Date.now() + ttlMs);
  const payload = `${customerId}.${tokenVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/** @returns {{customerId: number, tokenVersion: number}|null} */
export function verifyCustomerSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [customerIdRaw, tokenVersionRaw, expiresAtRaw, signature] = parts;
  const payload = `${customerIdRaw}.${tokenVersionRaw}.${expiresAtRaw}`;
  if (!safeEqualHex(sign(payload), signature)) return null;

  if (Number(expiresAtRaw) <= Date.now()) return null;

  const customerId = Number.parseInt(customerIdRaw, 10);
  const tokenVersion = Number.parseInt(tokenVersionRaw, 10);
  if (!Number.isFinite(customerId) || !Number.isFinite(tokenVersion)) return null;

  return { customerId, tokenVersion };
}

/**
 * A session renewed while it is used (2026-11-08, owner request: everyone was
 * signed out 30 days after signing in, daily users included). Once a token
 * has less than this left — i.e. it is more than a week old — opening the
 * account issues a fresh 30-day one for the same customer and token version,
 * so a password change or "logout everywhere" still ends it.
 */
export const RENEW_WHEN_LEFT_MS = SESSION_TTL_MS - 7 * 24 * 60 * 60 * 1000;

/**
 * @returns {string|null} a fresh token when `token` is valid and due for
 *   renewal; null otherwise (invalid, or still fresh).
 */
export function renewedCustomerSessionToken(token, now = Date.now()) {
  const session = verifyCustomerSessionToken(token);
  if (!session) return null;
  const expiresAt = Number(String(token).split('.')[2]);
  if (!Number.isFinite(expiresAt) || expiresAt - now > RENEW_WHEN_LEFT_MS) return null;
  return createCustomerSessionToken({ customerId: session.customerId, tokenVersion: session.tokenVersion });
}

/** @returns {boolean} */
export function isValidCustomerSessionToken(token) {
  return verifyCustomerSessionToken(token) !== null;
}

export const CUSTOMER_SESSION_COOKIE = SESSION_COOKIE;
/** The client-readable "signed in" flag set beside the session (lib/customerSession.js). */
export const CUSTOMER_LOGGED_IN_FLAG = 'lukka_logged_in';
export const CUSTOMER_SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
