import 'server-only';
import { AGENT_SESSION_COOKIE, createAgentSessionToken } from './agentAuth';
import { CUSTOMER_SESSION_COOKIE, createCustomerSessionToken } from './customerAuth';
import { CUSTOMER_LOGGED_IN_FLAG_COOKIE } from './customerSession';
import { endImpersonation } from './impersonation';
import {
  IMPERSONATION_COOKIE, IMPERSONATION_TTL_MS, createImpersonationToken, parseImpersonationToken,
} from './impersonationToken';

/**
 * The cookie half of "view as". A real agent or customer session cookie is
 * minted for the target — so every page, layout and read path works exactly as
 * it does for that person — but it lives only as long as the impersonation
 * (60 minutes), and the signed `lukka_impersonation` cookie beside it is what
 * middleware.js turns into read-only and what the banner reads.
 */

function options(maxAgeSeconds, httpOnly = true) {
  return { httpOnly, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: maxAgeSeconds };
}

function clearTargetCookies(cookieStore, targetType) {
  if (targetType === 'agent') {
    cookieStore.delete({ name: AGENT_SESSION_COOKIE, path: '/' });
  } else {
    cookieStore.delete({ name: CUSTOMER_SESSION_COOKIE, path: '/' });
    cookieStore.delete({ name: CUSTOMER_LOGGED_IN_FLAG_COOKIE, path: '/' });
  }
}

export function setImpersonationCookies(cookieStore, { adminId, adminTokenVersion, targetType, session, target }) {
  const maxAge = Math.floor(IMPERSONATION_TTL_MS / 1000);
  // Whichever account this browser was signed into is set aside for the duration.
  clearTargetCookies(cookieStore, targetType === 'agent' ? 'customer' : 'agent');
  if (targetType === 'agent') {
    cookieStore.set(
      AGENT_SESSION_COOKIE,
      createAgentSessionToken({ agentId: target.id, tokenVersion: target.tokenVersion, ttlMs: IMPERSONATION_TTL_MS }),
      options(maxAge),
    );
  } else {
    cookieStore.set(
      CUSTOMER_SESSION_COOKIE,
      createCustomerSessionToken({ customerId: target.id, tokenVersion: target.tokenVersion, ttlMs: IMPERSONATION_TTL_MS }),
      options(maxAge),
    );
    cookieStore.set(CUSTOMER_LOGGED_IN_FLAG_COOKIE, '1', options(maxAge, false));
  }
  cookieStore.set(
    IMPERSONATION_COOKIE,
    createImpersonationToken({
      sessionId: session.id,
      nonce: session.nonce,
      adminId,
      adminTokenVersion,
      targetType,
      targetId: target.id,
      expiresAt: session.expiresAt,
    }),
    options(maxAge),
  );
}

/**
 * Ends the session this browser's cookie names and clears the cookies it set.
 * Only the target cookie THIS impersonation minted is removed, and only when
 * the impersonation cookie's signature is ours — a stray cookie can never be
 * used to sign a real user out.
 *
 * @returns {Promise<null | {parsed: object|null, ended: object|null}>}
 */
export async function endImpersonationFromCookies(cookieStore, reason) {
  const token = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!token) return null;
  cookieStore.delete({ name: IMPERSONATION_COOKIE, path: '/' });
  const parsed = parseImpersonationToken(token, { allowExpired: true });
  if (!parsed) return { parsed: null, ended: null };
  clearTargetCookies(cookieStore, parsed.targetType);
  const ended = await endImpersonation({
    sessionId: parsed.sessionId,
    nonce: parsed.nonce,
    reason: parsed.expired && reason === 'exit' ? 'expired' : reason,
  });
  return { parsed, ended };
}
