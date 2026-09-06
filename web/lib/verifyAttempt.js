import 'server-only';
import { cookies } from 'next/headers';
import { hmacSign, safeEqualHex } from './authCrypto';

/**
 * Carries "who is part-way through phone verification" from the action that
 * sent the code to the page that checks it — signed, httpOnly, short-lived.
 * Same primitive and the same reasoning as lib/resetAttempt.js, which does
 * this for the password-reset flow.
 *
 * **This replaces the `?agent=<id>` / `?customer=<id>` query param the
 * verification step used to key on.** That param was not a credential — the
 * code is — but it was guessable, and two things followed from that: the
 * resend button would fire a real WhatsApp message at whichever account id
 * you typed into the URL, and the page could never show the number it had
 * just texted (doing so would have turned an id into somebody else's phone
 * number). With the account id held in a signed cookie instead, a resend can
 * only ever reach the number that actually started the flow, and the page
 * can confirm the last digits back to the person who typed them — which is
 * how they catch their own typo before waiting ten minutes for a code that
 * was never coming.
 *
 * Reuses CUSTOMER_SESSION_SECRET rather than adding a fourth auth secret to
 * configure; the fixed `verify-attempt` prefix domain-separates this token
 * from a real session token and from a reset attempt.
 */

const COOKIE_NAME = 'lukka_verify_attempt';
// Both verification pages live under /compte (the (site) route group does
// not appear in the URL). Deleting must repeat this exact path — a cookie is
// keyed by name AND path, and mismatching it creates a second cookie instead
// of clearing the first (see lib/adminAuth.js's note on the logout bug this
// app already shipped once).
const COOKIE_PATH = '/compte';
const TTL_MS = 30 * 60 * 1000; // outlives the 10-minute code so "expired, resend" still knows who to resend to
const PREFIX = 'verify-attempt';

function secret() {
  const value = process.env.CUSTOMER_SESSION_SECRET;
  if (!value) throw new Error('CUSTOMER_SESSION_SECRET is not set — see .env.local');
  return value;
}

function sign(payload) {
  return hmacSign(secret(), payload);
}

/** @param {{role: 'customer'|'agent', id: number, phone: string}} attempt */
export async function setVerifyAttemptCookie({ role, id, phone }) {
  const expiresAt = String(Date.now() + TTL_MS);
  const payload = `${PREFIX}.${role}.${id}.${phone}.${expiresAt}`;
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

/** @returns {Promise<{role: 'customer'|'agent', id: number, phone: string}|null>} */
export async function getVerifyAttempt() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 6) return null;
  const [prefix, role, idRaw, phone, expiresAtRaw, signature] = parts;
  if (prefix !== PREFIX || (role !== 'customer' && role !== 'agent') || !phone) return null;

  const payload = `${prefix}.${role}.${idRaw}.${phone}.${expiresAtRaw}`;
  if (!safeEqualHex(sign(payload), signature)) return null;
  if (Number(expiresAtRaw) <= Date.now()) return null;

  const id = Number.parseInt(idRaw, 10);
  if (!Number.isFinite(id)) return null;

  return { role, id, phone };
}

export async function clearVerifyAttemptCookie() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: COOKIE_NAME, path: COOKIE_PATH });
}

/**
 * '447932673460' -> '••• ••• 3460'. Enough for the person who just typed it
 * to recognise their own number (or spot that they fat-fingered it), and not
 * enough to be a phone number if the screen is over someone's shoulder.
 */
export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `••• ••• ${digits.slice(-4)}`;
}
