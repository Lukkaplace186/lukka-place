import 'server-only';
import {
  hashToStoredForm,
  verifyAgainstStoredForm,
  safeEqualHex,
  hmacSign,
  scryptHex,
  randomSaltHex,
  generateOtpCode,
  hashOtp,
  verifyOtp,
  otpExpiresAt,
} from './authCrypto';

/**
 * Agent self-service auth — deliberately mirrors web/lib/customerAuth.js
 * exactly (same shared authCrypto.js primitives, same session-token shape,
 * same lockout constants) rather than being a second, differently-shaped
 * auth system. The one real difference: agents also need phone ownership
 * verified via a WhatsApp OTP before the account is usable (customers don't
 * — see web/CLAUDE.md's "Phone is the primary identifier" for why agents,
 * who publish public contact info, warrant the extra step).
 *
 * agents.password (Laravel's own bcrypt-format column) is never read or
 * written here — this uses a new agents.password_hash column instead, kept
 * completely independent of whatever the original Laravel system's
 * credential semantics were.
 */

const SESSION_COOKIE = 'lukka_agent_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, same as customerAuth.js

function sessionSecret() {
  const secret = process.env.AGENT_SESSION_SECRET;
  if (!secret) throw new Error('AGENT_SESSION_SECRET is not set — see .env.local');
  return secret;
}

export function hashPassword(password) {
  return hashToStoredForm(String(password ?? ''));
}

export function verifyPasswordAgainstHash(candidate, storedHash) {
  return verifyAgainstStoredForm(candidate, storedHash);
}

const DUMMY_HASH = hashToStoredForm('lukka-agent-auth-dummy-comparison-value');
/** Burns roughly the same time a real verify would take, for a phone that doesn't exist — no timing signal on account existence. */
export function burnConstantTime(candidate) {
  verifyAgainstStoredForm(candidate, DUMMY_HASH);
}

function sign(value) {
  return hmacSign(sessionSecret(), value);
}

/** `${agentId}.${tokenVersion}.${expiresAtMs}.${hmac}` */
export function createAgentSessionToken({ agentId, tokenVersion }) {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  const payload = `${agentId}.${tokenVersion}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAgentSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [agentIdRaw, tokenVersionRaw, expiresAtRaw, signature] = parts;
  const payload = `${agentIdRaw}.${tokenVersionRaw}.${expiresAtRaw}`;
  if (!safeEqualHex(sign(payload), signature)) return null;
  if (Number(expiresAtRaw) <= Date.now()) return null;
  const agentId = Number.parseInt(agentIdRaw, 10);
  const tokenVersion = Number.parseInt(tokenVersionRaw, 10);
  if (!Number.isFinite(agentId) || !Number.isFinite(tokenVersion)) return null;
  return { agentId, tokenVersion };
}

export function isValidAgentSessionToken(token) {
  return verifyAgentSessionToken(token) !== null;
}

export const AGENT_SESSION_COOKIE = SESSION_COOKIE;
export const AGENT_SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// The OTP primitives now live in authCrypto.js, alongside the password and
// session-token ones, because customer signup verification needs the exact
// same code lifetime and the exact same hashing — a second copy under a
// customer-flavoured name is how two "10 minutes" quietly become 10 and 15.
// Re-exported here so nothing importing them from agentAuth.js has to change.
export { generateOtpCode, hashOtp, verifyOtp, otpExpiresAt };

// Re-exported so callers doing agent-specific work never need to import
// authCrypto.js directly for a one-off hash (kept for symmetry with the
// exports above, not currently used outside this file).
export { scryptHex, randomSaltHex };
