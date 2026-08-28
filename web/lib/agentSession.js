import 'server-only';
import { cookies } from 'next/headers';
import { createAgentSessionToken, AGENT_SESSION_COOKIE, AGENT_SESSION_TTL_SECONDS, verifyAgentSessionToken } from './agentAuth';

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
}

export async function clearAgentSession() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: AGENT_SESSION_COOKIE, path: '/' });
}

/** @returns {Promise<number|null>} */
export async function getCurrentAgentId() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AGENT_SESSION_COOKIE)?.value;
  const verified = verifyAgentSessionToken(token);
  return verified?.agentId ?? null;
}
