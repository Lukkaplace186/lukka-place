import 'server-only';
import { scryptHex, safeEqualHex, hmacSign } from './authCrypto';

/**
 * Session tokens for /admin/*, and the legacy shared team password.
 *
 * The console now has individual accounts (lib/adminUsers.js, roles in
 * lib/adminRoles.js, every action audited in lib/adminAudit.js). A session
 * token names the account it belongs to and the account's `token_version` at
 * issue time:
 *
 *   v2.<adminId>.<tokenVersion>.<expiresAtMs>.<hmac>
 *
 * The token itself is still stateless — middleware.js can check it without a
 * database — but lib/adminSession.js re-reads the account on every page and
 * action, so disabling a person or resetting their access (both bump
 * token_version) ends their sessions at once rather than at the 12h expiry.
 *
 * `adminId = 0` is the SHARED-PASSWORD session. It is kept deliberately as the
 * bootstrap path: without it, deploying individual accounts would lock the
 * team out of the console until someone could create the first owner. Every
 * action it takes is audited as "shared-password". Turn it off with
 * `ADMIN_SHARED_LOGIN=off` (or by unsetting ADMIN_PASSWORD_HASH) once the team
 * has accounts. A pre-v2 token (`<expiresAtMs>.<hmac>`) is read as that same
 * shared session, so nobody signed in at deploy time is thrown out.
 */

const SESSION_COOKIE = 'lukka_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — a work shift, not indefinite

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set — see .env.local');
  return secret;
}

/** Whether the legacy shared team password may still be used to sign in. */
export function sharedPasswordEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD_HASH) && String(process.env.ADMIN_SHARED_LOGIN || '').toLowerCase() !== 'off';
}

/**
 * @param {string} candidate Plain-text shared password from the login form.
 * @returns {boolean}
 */
export function verifyPassword(candidate) {
  if (!sharedPasswordEnabled()) return false;
  const [salt, expectedHash] = String(process.env.ADMIN_PASSWORD_HASH).split(':');
  if (!salt || !expectedHash) return false;
  return safeEqualHex(scryptHex(String(candidate || ''), salt), expectedHash);
}

function sign(value) {
  return hmacSign(sessionSecret(), value);
}

/**
 * @param {{adminId?: number, tokenVersion?: number}} [account] omitted = the shared-password session
 */
export function createSessionToken({ adminId = 0, tokenVersion = 0 } = {}) {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  const payload = `v2.${Math.max(0, Number(adminId) || 0)}.${Math.max(0, Number(tokenVersion) || 0)}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Signature + expiry only; whether the account still exists and is still
 * active is lib/adminSession.js's job.
 * @returns {{adminId: number, tokenVersion: number, expiresAt: number, legacy: boolean} | null}
 */
export function parseSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');

  if (parts.length === 2) {
    const [expiresAt, signature] = parts;
    if (!/^\d+$/.test(expiresAt) || !signature) return null;
    if (!safeEqualHex(sign(expiresAt), signature)) return null;
    if (!(Number(expiresAt) > Date.now())) return null;
    return { adminId: 0, tokenVersion: 0, expiresAt: Number(expiresAt), legacy: true };
  }

  if (parts.length !== 5 || parts[0] !== 'v2') return null;
  const [, adminId, tokenVersion, expiresAt, signature] = parts;
  if (![adminId, tokenVersion, expiresAt].every((part) => /^\d+$/.test(part)) || !signature) return null;
  const payload = `v2.${adminId}.${tokenVersion}.${expiresAt}`;
  if (!safeEqualHex(sign(payload), signature)) return null;
  if (!(Number(expiresAt) > Date.now())) return null;
  return { adminId: Number(adminId), tokenVersion: Number(tokenVersion), expiresAt: Number(expiresAt), legacy: false };
}

/** @returns {boolean} */
export function isValidSessionToken(token) {
  return parseSessionToken(token) !== null;
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
export const ADMIN_SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

/** The cookie options every place that signs someone in must use — see logoutAction for why path matters. */
export const ADMIN_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/admin',
  maxAge: ADMIN_SESSION_TTL_SECONDS,
};
