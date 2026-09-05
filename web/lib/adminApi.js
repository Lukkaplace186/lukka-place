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
export async function listLeads({
  status, propertyIds, assignedAgent, agentId, matchedAgentId, waId, limit, offset,
} = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyIds?.length) params.set('property_ids', propertyIds.join(','));
  if (assignedAgent) params.set('assigned_agent', assignedAgent);
  if (agentId != null) params.set('agent_id', String(agentId));
  // Requests the engine's dispatcher pushed to this agency — OR'd with the
  // other ownership signals engine-side, never replacing them.
  if (matchedAgentId != null) params.set('matched_agent_id', String(matchedAgentId));
  if (waId) params.set('wa_id', waId);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/leads${query ? `?${query}` : ''}`);
}

/** Admin Prospects detail page (/admin/leads/[id]). @returns {Promise<{lead: Object}>} */
export async function getLead(id) {
  return engineFetch(`/admin/leads/${id}`);
}

/** @returns {Promise<{lead: Object}>} */
export async function updateLeadStatus(id, status) {
  return engineFetch(`/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

/**
 * Admin dashboard's Request Assignment Routing. `agentId: null` un-assigns.
 * @param {number} id
 * @param {{agentId: number|null, assignedAgent: string|null}} patch
 * @returns {Promise<{lead: Object}>}
 */
export async function assignLead(id, { agentId, assignedAgent }) {
  return engineFetch(`/admin/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ agent_id: agentId, assigned_agent: assignedAgent }),
  });
}

/**
 * Customer-side "Modifier ma recherche" edit (Messages & Visites) — the same
 * structured columns POST /leads already writes on creation, now editable
 * after the fact through PATCH /admin/leads/:id. Only fields actually
 * present in `patch` are sent, so an omitted one is left untouched
 * server-side rather than overwritten with `undefined`.
 *
 * `proposals_reset` comes back `true` when this edit actually changed the
 * commune: the engine compares old vs. new commune itself (never trusts a
 * client-asserted flag) and, on a real change, clears every existing Agent
 * Demand Feed pitch and reopens the request in the new commune — see
 * routes/admin.js's PATCH /leads/:id and services/db.js's
 * resetLeadProposals.
 *
 * @param {number} id
 * @param {{transactionType?: string|null, commune?: string|null, priceMin?: number|null,
 *          priceMax?: number|null, bedrooms?: number|null, requirementsSummary?: string|null}} patch
 * @returns {Promise<{lead: Object, proposals_reset: boolean}>}
 */
export async function updateLeadRequirements(id, patch = {}) {
  const body = {};
  if (patch.transactionType !== undefined) body.transaction_type = patch.transactionType;
  if (patch.commune !== undefined) body.commune = patch.commune;
  if (patch.priceMin !== undefined) body.price_min = patch.priceMin;
  if (patch.priceMax !== undefined) body.price_max = patch.priceMax;
  if (patch.bedrooms !== undefined) body.bedrooms = patch.bedrooms;
  if (patch.requirementsSummary !== undefined) body.requirements_summary = patch.requirementsSummary;
  return engineFetch(`/admin/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

/**
 * Agent dashboard's Visit Scheduler — same propertyIds/assignedAgent
 * ownership-scoping convention as listLeads above (OR'd on the engine side).
 * @param {{status?: string, propertyIds?: number[], assignedAgent?: string, limit?: number, offset?: number}} [options]
 * @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[]}>}
 */
export async function listViewingRequests({ status, propertyIds, assignedAgent, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (propertyIds?.length) params.set('property_ids', propertyIds.join(','));
  if (assignedAgent) params.set('assigned_agent', assignedAgent);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/viewing-requests${query ? `?${query}` : ''}`);
}

/**
 * @param {number} id
 * @param {{status?: string, requestedTime?: string}} patch `requestedTime` lets
 *   "Reprogrammer" propose a new free-text time in the same write as the status change.
 * @returns {Promise<{viewingRequest: Object}>}
 */
export async function updateViewingRequest(id, { status, requestedTime } = {}) {
  return engineFetch(`/admin/viewing-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, requested_time: requestedTime }),
  });
}

/**
 * Public "Demander une visite" form (web/app/(site)/listings/[id]) — call
 * this after createLead() with the real lead id it returns; `requestedTime`
 * is the visitor's own free-text answer (same convention as every other
 * viewing_requests.requested_time write in this system).
 * @param {{leadId: number, propertyId?: number, requestedTime?: string}} options
 * @returns {Promise<{viewingRequest: Object}>}
 */
export async function createViewingRequest({ leadId, propertyId, requestedTime }) {
  return engineFetch('/admin/viewing-requests', {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId, property_id: propertyId, requested_time: requestedTime }),
  });
}

/**
 * Agent storefront's "Demandez ce bien à cet agent" inquiry form.
 * @returns {Promise<{lead: Object}>}
 */
export async function createLead({
  waId, name, source, propertyId, assignedAgent, requirementsSummary,
  transactionType, commune, priceMin, priceMax, bedrooms,
}) {
  return engineFetch('/admin/leads', {
    method: 'POST',
    body: JSON.stringify({
      wa_id: waId,
      name,
      source,
      property_id: propertyId,
      assigned_agent: assignedAgent,
      requirements_summary: requirementsSummary,
      transaction_type: transactionType,
      commune,
      price_min: priceMin,
      price_max: priceMax,
      bedrooms,
    }),
  });
}

/**
 * "Proposer un bien" — one agent answering a customer request with one of
 * their own listings. Throws with a real, user-facing error message (cap
 * reached / already answered) on failure — see services/db.js's
 * createLeadProposal, engine repo.
 * @returns {Promise<{proposal: Object}>}
 */
export async function createLeadProposal({ leadId, agentId, propertyId }) {
  return engineFetch(`/admin/leads/${leadId}/proposals`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId, property_id: propertyId }),
  });
}

/**
 * Bulk fetch for the customer-side "Messages & Visites" merge.
 * @param {number[]} leadIds
 * @returns {Promise<{proposals: Object[]}>}
 */
export async function getLeadProposals(leadIds) {
  if (!leadIds?.length) return { proposals: [] };
  return engineFetch(`/admin/leads/proposals?lead_ids=${leadIds.join(',')}`);
}

/**
 * How many pitches this agent has made since `since` — the engine's
 * GET /admin/leads/proposals-usage, counting real `lead_proposals` rows.
 *
 * Usage lives in the engine's SQLite because that is where a pitch is
 * actually recorded; the *allowance* lives in Postgres on `packages`
 * (monthly_pitch_limit), because that is a plan entitlement. There is
 * deliberately no `agent_pitch_usage` table mirroring the count into
 * Postgres — it would be a second source of truth that drifts the first time
 * a proposal is deleted (which resetLeadProposals really does when a lead's
 * commune changes).
 *
 * @param {{agentId: number, since: string}} input `since` is an ISO string.
 * @returns {Promise<{used: number, since: string}>}
 */
export async function getAgentPitchUsage({ agentId, since }) {
  const params = new URLSearchParams({ agent_id: String(agentId), since });
  return engineFetch(`/admin/leads/proposals-usage?${params.toString()}`);
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
 * Template send — required for anything going to someone who has not
 * messaged the business in the last 24 hours, which is every agent
 * registering for the first time. A free-form send to them is accepted by
 * Meta and silently never delivered; a template is not subject to that
 * window. See the engine's POST /admin/send-whatsapp-template.
 *
 * @param {string} phone digits-only wa_id
 * @param {{template: string, languageCode?: string, bodyParams?: string[], otpCode?: string}} options
 *   `otpCode` is only for AUTHENTICATION-category templates, which need the
 *   code in their copy-code button as well as the body.
 * @returns {Promise<{success: true}>}
 */
export async function sendWhatsAppTemplate(phone, { template, languageCode, bodyParams, otpCode } = {}) {
  return engineFetch('/admin/send-whatsapp-template', {
    method: 'POST',
    body: JSON.stringify({
      phone,
      template,
      language_code: languageCode,
      body_params: bodyParams,
      otp_code: otpCode,
    }),
  });
}

/**
 * Notifies a listing's original WhatsApp submitter of an approve/reject
 * decision. `status` is 'approved' or 'rejected' — not the raw
 * `approve_status` integer, the engine maps it to real message copy.
 * @returns {Promise<{success: true}>}
 */
/**
 * Ask the engine to attribute the listings this number already published to
 * the agent who has just proved they hold it.
 *
 * The engine owns this because only it can answer the question: Postgres
 * records a resolved `agent_id` on `properties` but never a submitter phone,
 * so the wa_id -> property_id mapping lives solely in the engine's SQLite.
 *
 * Safe to call more than once — it only ever fills a NULL agent_id.
 */
export async function claimListingsForPhone(phone) {
  return engineFetch('/admin/agents/claim-listings', {
    method: 'POST',
    body: JSON.stringify({ wa_id: phone }),
  });
}

export async function notifyListingModeration(propertyId, status) {
  return engineFetch(`/admin/properties/${propertyId}/notify`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

/**
 * The matching console's whole dataset in one call — see routes/admin.js's
 * GET /leads/matching-stats for why it is one endpoint rather than five.
 * @param {{days?: number}} [options]
 */
export async function getMatchingStats({ days = 30 } = {}) {
  return engineFetch(`/admin/leads/matching-stats?days=${encodeURIComponent(days)}`);
}

/** Which agencies a request was pushed to, and whether each was reached. */
export async function getLeadMatches(leadId) {
  return engineFetch(`/admin/leads/${leadId}/matches`);
}

/**
 * Manual re-dispatch of one request. Awaited on the engine side (unlike the
 * automatic creation-time trigger), so the returned counts are real.
 * @returns {Promise<{dispatched: number, notified: number, failed: number, skipped?: string}>}
 */
export async function redispatchLead(leadId) {
  return engineFetch(`/admin/leads/${leadId}/dispatch`, { method: 'POST' });
}
