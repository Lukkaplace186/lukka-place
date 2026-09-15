import 'server-only';
import { NextResponse } from 'next/server';
import { CUSTOMER_LOGGED_IN_FLAG_COOKIE } from './customerSession';

/**
 * The 401 every /api/account/* route answers with — and it also clears the
 * client-readable `lukka_logged_in` flag.
 *
 * That flag only picks a code path (lib/favorites.js sends a signed-in visitor
 * to the server-synced store), but once a session is revoked (logout on
 * another device, a password reset) the flag outlived it: every heart tap went
 * to this route, got a 401, and silently reverted. Clearing the flag here drops
 * the browser back to the anonymous localStorage path on its next load, and
 * the account pages send the visitor to login as before.
 *
 * `path: '/'` must match how lib/customerSession.js set it, or the browser
 * treats it as a different cookie and nothing is cleared.
 */
export function customerUnauthorized() {
  const response = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  response.cookies.set(CUSTOMER_LOGGED_IN_FLAG_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
