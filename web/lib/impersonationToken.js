import 'server-only';
import { hmacSign, safeEqualHex } from './authCrypto';

/**
 * The signed "view as" cookie. Pure crypto, so middleware.js can check it on
 * every request without a database round trip; lib/impersonation.js adds the
 * database half (session not ended, admin still active).
 *
 * `imp1.<sessionId>.<nonce>.<adminId>.<adminTokenVersion>.<targetType>.<targetId>.<expiresAtMs>.<hmac>`
 *
 * Signed with ADMIN_SESSION_SECRET under its own "impersonation:" prefix, so an
 * admin session token can never be replayed as one of these or the reverse.
 */

export const IMPERSONATION_COOKIE = 'lukka_impersonation';
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000;
export const IMPERSONATION_TARGETS = ['agent', 'customer'];

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value) throw new Error('ADMIN_SESSION_SECRET is not set — see .env.local');
  return value;
}

function sign(payload) {
  return hmacSign(secret(), `impersonation:${payload}`);
}

export function createImpersonationToken({ sessionId, nonce, adminId, adminTokenVersion, targetType, targetId, expiresAt }) {
  if (!IMPERSONATION_TARGETS.includes(targetType)) throw new Error('invalid impersonation target');
  if (!/^[0-9a-f]{32}$/.test(String(nonce))) throw new Error('invalid impersonation nonce');
  const payload = [
    'imp1', Number(sessionId), nonce, Number(adminId), Number(adminTokenVersion), targetType, Number(targetId), Number(expiresAt),
  ].join('.');
  return `${payload}.${sign(payload)}`;
}

/**
 * @param {string|undefined} token
 * @param {{now?: number, allowExpired?: boolean}} [options] allowExpired lets
 *   the exit route end the session record of a cookie that has just run out.
 */
export function parseImpersonationToken(token, { now = Date.now(), allowExpired = false } = {}) {
  if (!token || typeof token !== 'string' || token.length > 400) return null;
  const parts = token.split('.');
  if (parts.length !== 9 || parts[0] !== 'imp1') return null;
  const [, sessionId, nonce, adminId, adminTokenVersion, targetType, targetId, expiresAt, signature] = parts;
  if (![sessionId, adminId, adminTokenVersion, targetId, expiresAt].every((part) => /^\d{1,19}$/.test(part))) return null;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !IMPERSONATION_TARGETS.includes(targetType) || !signature) return null;
  const payload = parts.slice(0, 8).join('.');
  if (!safeEqualHex(sign(payload), signature)) return null;
  const expired = !(Number(expiresAt) > now);
  if (expired && !allowExpired) return null;
  return {
    sessionId: Number(sessionId),
    nonce,
    adminId: Number(adminId),
    adminTokenVersion: Number(adminTokenVersion),
    targetType,
    targetId: Number(targetId),
    expiresAt: Number(expiresAt),
    expired,
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What middleware does with a request, given the impersonation cookie.
 *
 * Read-only is enforced HERE, for every path outside /admin: a Server Action,
 * an /api route, a form post — anything that is not GET/HEAD/OPTIONS — is
 * refused while someone is viewing as another account. One rule at the edge
 * rather than a check in each of dozens of actions, so a new action cannot
 * forget it. /admin stays writable: the console itself is not impersonated.
 *
 * @returns {'pass'|'block'|'exit'}
 */
export function impersonationDecision({ method, pathname, token, now = Date.now() }) {
  if (!token || pathname.startsWith('/admin')) return 'pass';
  const parsed = parseImpersonationToken(token, { now });
  if (!parsed) return SAFE_METHODS.has(method) ? 'exit' : 'block';
  return SAFE_METHODS.has(method) ? 'pass' : 'block';
}
