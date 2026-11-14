import 'server-only';
import { cookies } from 'next/headers';
import {
  AGENT_LOGGED_IN_FLAG_COOKIE, AGENT_SESSION_COOKIE, AGENT_SESSION_TTL_SECONDS,
  createAgentSessionToken, verifyAgentSessionToken,
} from './agentAuth';
import {
  CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_TTL_SECONDS, createCustomerSessionToken, verifyCustomerSessionToken,
} from './customerAuth';
import { CUSTOMER_LOGGED_IN_FLAG_COOKIE } from './customerSession';
import { DEMO_COOKIE, demoPhonesFor } from './demoPhone';

/**
 * The browser half of a demo pair (lib/demoAccounts.js).
 *
 * "Ouvrir côté client / agent" signs this browser into the demo account with
 * an ordinary session cookie — the same one a login sets, so every page,
 * action and API route behaves exactly as it does for a real person — and
 * sets `lukka_demo` = "<pairId>.<agentId>.<customerId>" beside it. That marker
 * is what shows the demo banner, counts the visits as staff, and makes
 * engineFetch send `x-lukka-demo` so the engine blocks anything aimed at a
 * real number. It is honoured only while the signed-in session IS that pair's
 * account (checked against the signed session tokens, no database): a stale
 * marker next to a real login changes nothing. And it can only ever restrict.
 *
 * Both sides can be open at once in one browser (agent and customer sessions
 * use different cookies), so the team can play a visit request from both ends.
 */

const ID = /^\d{1,19}$/;

export function parseDemoCookie(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || !parts.every((p) => ID.test(p))) return null;
  const [pairId, agentId, customerId] = parts.map(Number);
  if (!(pairId > 0 && pairId <= 9999)) return null;
  return { pairId, agentId, customerId };
}

function options(maxAge, httpOnly = true) {
  return { httpOnly, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge };
}

/**
 * Sign this browser into one side of the pair.
 * @param {{id: number, agentId: number, customerId: number}} pair
 * @param {'agent'|'customer'} side
 * @param {{agentTokenVersion?: number, customerTokenVersion?: number}} versions
 */
export function setDemoSessionCookies(cookieStore, pair, side, { agentTokenVersion = 0, customerTokenVersion = 1 } = {}) {
  if (side === 'agent') {
    cookieStore.set(
      AGENT_SESSION_COOKIE,
      createAgentSessionToken({ agentId: pair.agentId, tokenVersion: agentTokenVersion }),
      options(AGENT_SESSION_TTL_SECONDS),
    );
    cookieStore.set(AGENT_LOGGED_IN_FLAG_COOKIE, '1', options(AGENT_SESSION_TTL_SECONDS, false));
  } else {
    cookieStore.set(
      CUSTOMER_SESSION_COOKIE,
      createCustomerSessionToken({ customerId: pair.customerId, tokenVersion: customerTokenVersion }),
      options(CUSTOMER_SESSION_TTL_SECONDS),
    );
    cookieStore.set(CUSTOMER_LOGGED_IN_FLAG_COOKIE, '1', options(CUSTOMER_SESSION_TTL_SECONDS, false));
  }
  cookieStore.set(
    DEMO_COOKIE,
    `${pair.id}.${pair.agentId || 0}.${pair.customerId || 0}`,
    options(Math.max(AGENT_SESSION_TTL_SECONDS, CUSTOMER_SESSION_TTL_SECONDS)),
  );
}

/**
 * Which demo sides this request's cookies are signed into, or null.
 * Pure over a cookie store: usable from middleware-free server code.
 */
export function demoSidesFromCookies(cookieStore) {
  const marker = parseDemoCookie(cookieStore.get(DEMO_COOKIE)?.value);
  if (!marker) return null;
  const agent = verifyAgentSessionToken(cookieStore.get(AGENT_SESSION_COOKIE)?.value);
  const customer = verifyCustomerSessionToken(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value);
  const agentSide = Boolean(agent && marker.agentId && agent.agentId === marker.agentId);
  const customerSide = Boolean(customer && marker.customerId && customer.customerId === marker.customerId);
  if (!agentSide && !customerSide) return null;
  const phones = demoPhonesFor(marker.pairId);
  return { ...marker, agentSide, customerSide, phones };
}

/** The `x-lukka-demo` header value for an engine call, or null. Never throws. */
export async function demoEngineHeader() {
  try {
    const sides = demoSidesFromCookies(await cookies());
    if (!sides) return null;
    const list = [];
    if (sides.customerSide) list.push(sides.phones.customerPhone);
    if (sides.agentSide) list.push(sides.phones.agentPhone);
    return list.join(',');
  } catch {
    // Outside a request (a cron route, a script): no demo session.
    return null;
  }
}

/** Sign out of both demo sides and drop the marker. Real sessions are left alone. */
export function clearDemoSessionCookies(cookieStore) {
  const sides = demoSidesFromCookies(cookieStore);
  if (sides?.agentSide) {
    cookieStore.delete({ name: AGENT_SESSION_COOKIE, path: '/' });
    cookieStore.delete({ name: AGENT_LOGGED_IN_FLAG_COOKIE, path: '/' });
  }
  if (sides?.customerSide) {
    cookieStore.delete({ name: CUSTOMER_SESSION_COOKIE, path: '/' });
    cookieStore.delete({ name: CUSTOMER_LOGGED_IN_FLAG_COOKIE, path: '/' });
  }
  cookieStore.delete({ name: DEMO_COOKIE, path: '/' });
  return sides;
}
