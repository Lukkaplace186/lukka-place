import 'server-only';
import crypto from 'node:crypto';

/**
 * Identity-agnostic password/session-token primitives — extracted out of
 * adminAuth.js so a second, per-customer auth system (customerAuth.js) can
 * reuse the exact same crypto instead of a second hand-rolled copy. Node's
 * own `crypto` only: scrypt for password hashing, HMAC + `timingSafeEqual`
 * for signed tokens — the same primitives the engine already uses for
 * webhook signature verification. No new dependency.
 */

export function scryptHex(value, salt) {
  return crypto.scryptSync(value, salt, 64).toString('hex');
}

export function randomSaltHex() {
  return crypto.randomBytes(16).toString('hex');
}

/** `salt:hash` — the stored form of a hashed password/secret. */
export function hashToStoredForm(value) {
  const salt = randomSaltHex();
  return `${salt}:${scryptHex(value, salt)}`;
}

/** @returns {boolean} */
export function verifyAgainstStoredForm(candidate, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  return safeEqualHex(scryptHex(String(candidate ?? ''), salt), expectedHash);
}

/** Constant-time hex-string compare — a length mismatch is already a mismatch. */
export function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hmacSign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * 6-digit code, zero-padded — matches what a human reads aloud/types easily
 * off a WhatsApp message. Previously hand-rolled once inside agentAuth.js
 * for signup verification; lives here now so the password-reset flow
 * (resetPassword.js, both customers and agents) can reuse the exact same
 * generator instead of a second copy. Hash it the same way as a password —
 * `hashToStoredForm(code)` — a leaked *_otp_code_hash column is still
 * useless without the salt+scrypt work.
 */
export function generateOtpCode() {
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, '0');
}
