import 'server-only';

/**
 * Server-side client for lukka-place-engine's /admin/* API
 * (routes/admin.js) — the conversations/leads dashboard's only path to that
 * data. Same pattern as lib/locations.js's GET /locations call: a
 * server-side fetch to the engine, never exposed to the browser, no CORS
 * involved. Authenticated with ENGINE_API_SECRET (mirrors the engine's own
 * API_SECRET — see .env.local's comment there).
 *
 * No login of its own protects the /admin/* pages that call these functions
 * — see web/CLAUDE.md and app/admin/layout.js. Local-dev-only until one
 * exists; do not deploy this surface anywhere public yet.
 */

function base() {
  const value = process.env.ENGINE_API_BASE;
  if (!value) throw new Error('ENGINE_API_BASE is not set — see .env.local');
  return value;
}

function authHeaders() {
  const key = process.env.ENGINE_API_SECRET;
  if (!key) throw new Error('ENGINE_API_SECRET is not set — see .env.local');
  return { 'X-API-Key': key };
}

async function engineFetch(path, options = {}) {
  const res = await fetch(`${base()}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    cache: 'no-store',
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error || `${options.method || 'GET'} ${path} failed: ${res.status}`);
  }
  return body;
}

/** @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[]}>} */
export async function listConversations({ state, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/conversations${query ? `?${query}` : ''}`);
}

/** @returns {Promise<{conversation: Object, messages: Object[], leads: Object[]}>} */
export async function getConversationDetail(id) {
  return engineFetch(`/admin/conversations/${id}`);
}

/**
 * @param {number} id
 * @param {{state?: string, assigned_agent?: string, ai_active?: boolean, notes?: string}} patch
 * @returns {Promise<{conversation: Object}>}
 */
export async function updateConversation(id, patch) {
  return engineFetch(`/admin/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** @returns {Promise<{message: Object}>} */
export async function sendManualReply(id, text) {
  return engineFetch(`/admin/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) });
}

/** @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[]}>} */
export async function listLeads({ status, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/leads${query ? `?${query}` : ''}`);
}

/** @returns {Promise<{lead: Object}>} */
export async function updateLeadStatus(id, status) {
  return engineFetch(`/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}
