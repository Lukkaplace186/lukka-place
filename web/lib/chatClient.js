/**
 * Messagerie — the browser's side of /api/chat/* (app/api/chat, lib/chat.js).
 * Plain fetch, same-origin cookies; nothing here authorises anything.
 */

/**
 * One call to the chat API. Resolves `{ok, status, data}`; never throws for
 * an HTTP error, so the screens decide what a 409 or a 429 means. A network
 * failure (offline, a Kinshasa link dropping) is `{ok: false, status: 0}`.
 */
export async function chatRequest(path, { method = 'GET', body, side = 'customer', query, signal } = {}) {
  const params = new URLSearchParams(query || {});
  if (side === 'agent') params.set('as', 'agent');
  const qs = params.toString();
  try {
    const response = await fetch(`/api/chat${path}${qs ? `?${qs}` : ''}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return { ok: false, status: 0, data: null };
  }
}

/** A UUID for one outgoing message, so a retry is recognised as the same message. */
export function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The French/English key for an API error code, for the screens' error line. */
export function chatErrorKey(code) {
  switch (code) {
    case 'blocked': return 'chat.errors.blocked';
    case 'rate-limited': return 'chat.errors.rateLimited';
    case 'limit': return 'chat.errors.limit';
    case 'too-long': return 'chat.errors.tooLong';
    case 'phone-unverified': return 'chat.errors.phoneUnverified';
    case 'listing-unavailable': return 'chat.errors.listingUnavailable';
    case 'agent-unavailable': return 'chat.errors.agentUnavailable';
    case 'self': return 'chat.errors.self';
    case 'unavailable': return 'chat.errors.unavailable';
    case 'network': return 'chat.errors.network';
    default: return 'chat.errors.generic';
  }
}
