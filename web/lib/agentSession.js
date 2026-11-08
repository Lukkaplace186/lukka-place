import 'server-only';
import { cookies } from 'next/headers';
import { createAgentSessionToken, AGENT_SESSION_COOKIE, AGENT_LOGGED_IN_FLAG_COOKIE, AGENT_SESSION_TTL_SECONDS, verifyAgentSessionToken } from './agentAuth';

/**
 * Mirrors web/lib/customerSession.js. `path: '/'` (not scoped to
 * `/compte/agent`) so the public storefront (`/agents/[id]`) can also read
 * login state later if wanted (e.g. "this is your own profile" affordances)
 * — same reasoning customerSession.js's doc comment gives for customers
 * needing session state outside `/compte/*` too.
 */
export async function establishAgentSession({ id, tokenVersion }) {
  const cookieStore = await cookies();
  const token = createAgentSessionToken({ agentId: id, tokenVersion });
  const isProd = process.env.NODE_ENV === 'production';

  cookieStore.set(AGENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: AGENT_SESSION_TTL_SECONDS,
  });
  cookieStore.set(AGENT_LOGGED_IN_FLAG_COOKIE, '1', {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: AGENT_SESSION_TTL_SECONDS,
  });
}

/**
 * The number that last signed in on this device, so coming back is the
 * password and nothing else (2026-11-08, same as the customer's
 * lukka_customer_phone). httpOnly, read only by the agent sign-in page;
 * kept on logout.
 */
const REMEMBERED_AGENT_PHONE_COOKIE = 'lukka_agent_phone';
const REMEMBERED_PHONE_MAX_AGE = 365 * 24 * 60 * 60;

export async function rememberAgentPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) return;
  const cookieStore = await cookies();
  cookieStore.set(REMEMBERED_AGENT_PHONE_COOKIE, digits, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: REMEMBERED_PHONE_MAX_AGE,
  });
}

export async function getRememberedAgentPhone() {
  const cookieStore = await cookies();
  const digits = String(cookieStore.get(REMEMBERED_AGENT_PHONE_COOKIE)?.value || '');
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

export async function clearAgentSession() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: AGENT_SESSION_COOKIE, path: '/' });
  cookieStore.delete({ name: AGENT_LOGGED_IN_FLAG_COOKIE, path: '/' });
}

/** @returns {Promise<number|null>} */
export async function getCurrentAgentId() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AGENT_SESSION_COOKIE)?.value;
  const verified = verifyAgentSessionToken(token);
  return verified?.agentId ?? null;
}
