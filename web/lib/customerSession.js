import 'server-only';
import { cookies } from 'next/headers';
import { createCustomerSessionToken, CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_SECONDS } from './customerAuth';

const LOGGED_IN_FLAG_COOKIE = 'lukka_logged_in';
export const CUSTOMER_LOGGED_IN_FLAG_COOKIE = LOGGED_IN_FLAG_COOKIE;

/**
 * Sets both the real httpOnly session cookie and the client-readable
 * `lukka_logged_in` flag cookie (see lib/customerClient.js) together, with
 * matching attributes, so they can never drift out of sync with each other.
 * Both use `path: '/'` — the exact attribute that must match on deletion or
 * the browser treats it as an unrelated cookie (see clearCustomerSession
 * below, and the identical bug this app already hit once in the admin
 * logoutAction).
 */
export async function establishCustomerSession({ id, tokenVersion }) {
  const cookieStore = await cookies();
  const token = createCustomerSessionToken({ customerId: id, tokenVersion });
  const isProd = process.env.NODE_ENV === 'production';

  cookieStore.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
  cookieStore.set(LOGGED_IN_FLAG_COOKIE, '1', {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

/**
 * The last number that signed in on this device, so coming back is a
 * password and nothing else (2026-11-06: re-typing a number with its country
 * code on every visit was one of the reasons customers gave up). httpOnly —
 * only the login page reads it, server-side — and it survives logout on
 * purpose; deleting the account forgets it.
 */
const REMEMBERED_PHONE_COOKIE = 'lukka_customer_phone';
const REMEMBERED_PHONE_MAX_AGE = 365 * 24 * 60 * 60;

export async function rememberCustomerPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) return;
  const cookieStore = await cookies();
  cookieStore.set(REMEMBERED_PHONE_COOKIE, digits, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REMEMBERED_PHONE_MAX_AGE,
  });
}

export async function getRememberedCustomerPhone() {
  const cookieStore = await cookies();
  const digits = String(cookieStore.get(REMEMBERED_PHONE_COOKIE)?.value || '');
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

export async function forgetRememberedCustomerPhone() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: REMEMBERED_PHONE_COOKIE, path: '/' });
}

export async function clearCustomerSession() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: CUSTOMER_SESSION_COOKIE, path: '/' });
  cookieStore.delete({ name: LOGGED_IN_FLAG_COOKIE, path: '/' });
}
