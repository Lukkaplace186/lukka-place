import 'server-only';
import { cookies } from 'next/headers';
import { hmacSign, safeEqualHex } from './authCrypto';

/**
 * Carries `{ role, phone }` from step 1 (/mot-de-passe-oublie) to step 2
 * (/mot-de-passe-oublie/verifier) without ever putting a real phone number
 * in the URL — a query param lands in browser history, the `Referer` header
 * of anything the OTP page might load, and server access logs. A short-lived,
 * signed, httpOnly cookie instead, same HMAC primitive
 * customerSession.js/agentSession.js already sign real session tokens with.
 *
 * Reuses CUSTOMER_SESSION_SECRET (already required in every environment,
 * see web/CLAUDE.md) rather than adding a third auth secret to configure —
 * the fixed `reset-attempt` prefix domain-separates this token's signature
 * from a real session token's, so the two can never be confused even if
 * compared against the wrong verifier by mistake.
 */

const COOKIE_NAME = 'lukka_reset_attempt';
const COOKIE_PATH = '/mot-de-passe-oublie';
const TTL_MS = 15 * 60 * 1000; // outlives the 10-minute OTP so "expired, resend" still has a phone/role to work with
const PREFIX = 'reset-attempt';

function secret() {
  const value = process.env.CUSTOMER_SESSION_SECRET;
  if (!value) throw new Error('CUSTOMER_SESSION_SECRET is not set — see .env.local');
  return value;
}

function sign(payload) {
  return hmacSign(secret(), payload);
}

/** @param {{role: 'customer'|'agent', phone: string}} */
export async function setResetAttemptCookie({ role, phone }) {
  const expiresAt = String(Date.now() + TTL_MS);
  const payload = `${PREFIX}.${role}.${phone}.${expiresAt}`;
  const token = `${payload}.${sign(payload)}`;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: Math.floor(TTL_MS / 1000),
  });
}

/** @returns {Promise<{role: 'customer'|'agent', phone: string}|null>} */
export async function getResetAttempt() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [prefix, role, phone, expiresAtRaw, signature] = parts;
  if (prefix !== PREFIX || (role !== 'customer' && role !== 'agent') || !phone) return null;

  const payload = `${prefix}.${role}.${phone}.${expiresAtRaw}`;
  if (!safeEqualHex(sign(payload), signature)) return null;
  if (Number(expiresAtRaw) <= Date.now()) return null;

  return { role, phone };
}

/** Path must match what setResetAttemptCookie set, or the browser treats it as a different cookie (see customerSession.js's identical note on the admin logout bug this app already hit once). */
export async function clearResetAttemptCookie() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: COOKIE_PATH });
}
