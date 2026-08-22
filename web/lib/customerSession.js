import 'server-only';
import { cookies } from 'next/headers';
import { createCustomerSessionToken, CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_SECONDS } from './customerAuth';

const LOGGED_IN_FLAG_COOKIE = 'lukka_logged_in';

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

export async function clearCustomerSession() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: CUSTOMER_SESSION_COOKIE, path: '/' });
  cookieStore.delete({ name: LOGGED_IN_FLAG_COOKIE, path: '/' });
}
