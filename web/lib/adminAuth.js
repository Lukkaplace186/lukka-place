import 'server-only';
import { scryptHex, safeEqualHex, hmacSign } from './authCrypto';

/**
 * Password gate for /admin/* — a single shared team password, not per-agent
 * accounts. This is deliberately the smallest real thing that answers "is
 * this visitor a Lukka Place team member or not": no user table, no new
 * dependency (Node's own `crypto` — scrypt for the password hash, HMAC +
 * timingSafeEqual for the session token, the same primitives the engine
 * already uses for webhook signature verification, now shared with
 * customerAuth.js via authCrypto.js). Real per-agent accounts were
 * deliberately deferred earlier until the admin dashboard actually needed a
 * login — see CLAUDE.md — this is that moment, sized to match it.
 *
 * Sessions are a stateless signed cookie (`${expiresAtMs}.${hmac}`), not a
 * database row — nothing to garbage-collect, nothing to lose on a restart.
 */

const SESSION_COOKIE = 'lukka_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — a work shift, not indefinite

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set — see .env.local');
  return secret;
}

function passwordHash() {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    throw new Error(
      'ADMIN_PASSWORD_HASH is not set — see .env.local. Generate one with: node scripts/hash-admin-password.js "<password>"',
    );
  }
  return hash;
}

/**
 * @param {string} candidate Plain-text password from the login form.
 * @returns {boolean}
 */
export function verifyPassword(candidate) {
  const [salt, expectedHash] = passwordHash().split(':');
  if (!salt || !expectedHash) return false;
  return safeEqualHex(scryptHex(String(candidate || ''), salt), expectedHash);
}

function sign(value) {
  return hmacSign(sessionSecret(), value);
}

/** A stateless session token: `${expiryMs}.${hmac}`. */
export function createSessionToken() {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
}

/** @returns {boolean} */
export function isValidSessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;

  const expiresAt = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!expiresAt || !signature) return false;

  if (!safeEqualHex(sign(expiresAt), signature)) return false;

  return Number(expiresAt) > Date.now();
}

export const ADMIN_SESSION_COOKIE = SESSION_COOKIE;
export const ADMIN_SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
