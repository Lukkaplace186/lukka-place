import 'server-only';

/**
 * Server-side client for lukka-place-engine's /admin/* API
 * (routes/admin.js) — the conversations/leads dashboard's only path to that
 * data. Same pattern as lib/locations.js's GET /locations call: a
 * server-side fetch to the engine, never exposed to the browser, no CORS
 * involved. Authenticated with ENGINE_API_SECRET (mirrors the engine's own
 * API_SECRET — see .env.local's comment there).
 *
 * /admin/* is gated by middleware.js + lib/adminAuth.js's signed session
 * cookie (a single shared team password) — see web/CLAUDE.md.
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

/**
 * @param {{status?: string, propertyIds?: number[], assignedAgent?: string, waId?: string, limit?: number, offset?: number}} [options]
 * `propertyIds` scopes the stream to one agent's own listings — the agent
 * dashboard's Lead Activity Stream (Stage 4D). `assignedAgent` widens that
 * same stream (OR'd with `propertyIds` on the engine side, not AND'd) to
 * also surface a general inquiry with no property_id yet that was still
 * addressed to this agent by name — see submitInquiryAction in
 * web/app/(site)/agents/[id]/actions.js, the only place that writes
 * `assigned_agent`, and services/db.js's listLeads doc comment for why this
 * is a display-name string match, not an id join. `waId` scopes it to one
 * customer's own submitted leads — customer inquiry history
 * (lib/customerInquiries.js). Callers must only ever pass a `waId` derived
 * server-side from the authenticated caller's own session, never a
 * client-supplied value — same non-negotiable binding rule the buyer
 * assistant's tool-calling layer already follows (see root CLAUDE.md).
 * @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[]}>}
 */
export async function listLeads({ status, propertyIds, assignedAgent, waId, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyIds?.length) params.set('property_ids', propertyIds.join(','));
  if (assignedAgent) params.set('assigned_agent', assignedAgent);
  if (waId) params.set('wa_id', waId);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/leads${query ? `?${query}` : ''}`);
}

/** @returns {Promise<{lead: Object}>} */
export async function updateLeadStatus(id, status) {
  return engineFetch(`/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

/**
 * Agent storefront's "Demandez ce bien à cet agent" inquiry form.
 * @returns {Promise<{lead: Object}>}
 */
export async function createLead({ waId, name, source, propertyId, assignedAgent, requirementsSummary }) {
  return engineFetch('/admin/leads', {
    method: 'POST',
    body: JSON.stringify({
      wa_id: waId,
      name,
      source,
      property_id: propertyId,
      assigned_agent: assignedAgent,
      requirements_summary: requirementsSummary,
    }),
  });
}

/**
 * Agent phone-verification OTP (web/lib/agentAuth.js) — the engine holds
 * the real Chakra credentials, so this is the only way `web/` can actually
 * deliver a WhatsApp message.
 * @returns {Promise<{success: true}>}
 */
export async function sendWhatsAppMessage(phone, message) {
  return engineFetch('/admin/send-whatsapp', { method: 'POST', body: JSON.stringify({ phone, message }) });
}

/**
 * Notifies a listing's original WhatsApp submitter of an approve/reject
 * decision. `status` is 'approved' or 'rejected' — not the raw
 * `approve_status` integer, the engine maps it to real message copy.
 * @returns {Promise<{success: true}>}
 */
export async function notifyListingModeration(propertyId, status) {
  return engineFetch(`/admin/properties/${propertyId}/notify`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
