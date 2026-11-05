import 'server-only';
import { NextResponse } from 'next/server';
import { getChatViewer } from './chat';
import { customerUnauthorized } from './customerApiResponse';
import { AGENT_LOGGED_IN_FLAG_COOKIE } from './agentAuth';

/**
 * Plumbing shared by the /api/chat/* routes: who is asking, reading a JSON
 * body, and one table from lib/chat.js statuses to HTTP codes.
 *
 * `?as=agent` names the agent's inbox; anything else is the customer's. The
 * identity is always that side's own httpOnly session (lib/chat.js
 * getChatViewer), never a request value.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };

export const CHAT_STATUS_HTTP = Object.freeze({
  ok: 200,
  'not-found': 404,
  'listing-unavailable': 404,
  'agent-unavailable': 404,
  empty: 400,
  'too-long': 400,
  'invalid-kind': 400,
  'invalid-reason': 400,
  invalid: 400,
  self: 400,
  'phone-unverified': 403,
  forbidden: 403,
  blocked: 409,
  'rate-limited': 429,
  limit: 429,
  unavailable: 503,
});

export function chatJson(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** A lib/chat.js result as a response: `{error: <status>}` for anything not ok. */
export function chatResult(result, okBody) {
  const http = CHAT_STATUS_HTTP[result.status] ?? 500;
  if (result.status === 'ok') return chatJson(okBody ?? result, 200);
  return chatJson({ error: result.status }, http);
}

export function chatSide(request) {
  return new URL(request.url).searchParams.get('as') === 'agent' ? 'agent' : 'customer';
}

/** The viewer, or the 401 to answer with. The customer's also clears the stale signed-in flag. */
export async function requireChatViewer(request) {
  const side = chatSide(request);
  const viewer = await getChatViewer(side);
  if (viewer) return { viewer };
  if (side === 'customer') return { response: customerUnauthorized() };
  const response = chatJson({ error: 'unauthorized' }, 401);
  response.cookies.set(AGENT_LOGGED_IN_FLAG_COOKIE, '', { path: '/', maxAge: 0 });
  return { response };
}

/**
 * The JSON body of a write, or null. Only `application/json` is read: a
 * cross-site HTML form cannot send that content type, and the session
 * cookies are SameSite=Lax, so a write here cannot be forged from another
 * site.
 */
export async function readChatJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function badRequest() {
  return chatJson({ error: 'invalid' }, 400);
}
