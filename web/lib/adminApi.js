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

/**
 * @param {{state?: string, q?: string, aiActive?: '0'|'1', limit?: number, offset?: number}} [options]
 * @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[], summary: Object}>}
 */
export async function listConversations({ state, q, aiActive, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
  if (q) params.set('q', q);
  if (aiActive === '0' || aiActive === '1') params.set('ai_active', aiActive);
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
  status, propertyIds, assignedAgent, agentId, matchedAgentId, waId, q, unassigned, limit, offset,
} = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', String(q).slice(0, 100));
  if (unassigned) params.set('unassigned', '1');
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
 * pitch and reopens the request in the new commune — see
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
  if (patch.communes !== undefined) body.communes = patch.communes;
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
 * Visit requests per listing, all time — the market-data export.
 * @returns {Promise<Map<number, number>>}
 */
export async function countViewingRequestsByProperty() {
  const { data = [] } = await engineFetch('/admin/viewing-requests/counts-by-property');
  return new Map(data.map((row) => [Number(row.property_id), Number(row.n)]));
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
 * An AGENT's answer to a viewing request, from the dashboard's Visites tab —
 * the web twin of the WhatsApp Accepter / Autre créneau / Décliner buttons.
 *
 * Deliberately not updateViewingRequest above. That one is a bare PATCH, kept
 * for admin overrides; it changes the row and tells nobody. This goes through
 * the engine's response path, which messages the customer, stamps the agent's
 * first response and records that the answer came from the dashboard. The
 * engine re-checks that `agentId` is the agent this request belongs to.
 *
 * @param {number} id
 * @param {{agentId: number, status: 'CONFIRMED'|'RESCHEDULED'|'DECLINED'|'CANCELLED', requestedTime?: string}} answer
 * @returns {Promise<{status: string, unchanged: boolean, tenantNotified: boolean, alternatives?: number, viewingRequest: Object}>}
 *   `tenantNotified` is Chakra ACCEPTING the send — not delivery.
 */
export async function respondToViewingRequest(id, { agentId, status, requestedTime } = {}) {
  return engineFetch(`/admin/viewing-requests/${id}/agent-response`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId, status, requested_time: requestedTime }),
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

// ---------------------------------------------------------------------------
// The CUSTOMER's side of a viewing request (Espace Client). Every call takes
// the signed-in account's own stored phone as `waId`; the engine re-checks it
// against the request's lead and answers 404 for anybody else's.
// ---------------------------------------------------------------------------

/** @returns {Promise<{data: Object[]}>} newest first, customer-safe columns only. */
export async function listCustomerViewingRequests(waId) {
  return engineFetch(`/admin/viewing-requests/by-customer?wa_id=${encodeURIComponent(waId)}`);
}

/** @param {{waId: string, action: 'CANCEL'|'ACCEPT_SLOT'}} answer */
export async function customerRespondToViewing(id, { waId, action }) {
  return engineFetch(`/admin/viewing-requests/${id}/customer-response`, {
    method: 'POST',
    body: JSON.stringify({ wa_id: waId, action }),
  });
}

/** @param {{waId: string, response: 'GOOD'|'BAD'|'AGENT_ABSENT'}} answer */
export async function customerViewingCheckin(id, { waId, response }) {
  return engineFetch(`/admin/viewing-requests/${id}/checkin`, {
    method: 'POST',
    body: JSON.stringify({ wa_id: waId, response }),
  });
}

/** @param {{waId: string, code: string}} answer one of the engine's FALLOFF_REASON_BY_CHOICE codes */
export async function customerViewingFalloffReason(id, { waId, code }) {
  return engineFetch(`/admin/viewing-requests/${id}/falloff-reason`, {
    method: 'POST',
    body: JSON.stringify({ wa_id: waId, code }),
  });
}

/**
 * Agent storefront's "Demandez ce bien à cet agent" inquiry form.
 * @returns {Promise<{lead: Object}>}
 */
export async function createLead({
  waId, name, source, propertyId, assignedAgent, requirementsSummary,
  transactionType, commune, communes, priceMin, priceMax, bedrooms,
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
      // Every commune picked; the engine stores the list and pushes the
      // request to agencies in each (services/leadCommunes.js).
      communes,
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

/**
 * Smart Paste (agent dashboard) — sends raw pasted listing text to the
 * engine's Sonnet/GPT-backed extractor (POST /admin/parse-listing) and gets
 * back structured fields + a clean generated description. Mapping those
 * fields onto real form values (matching a real category id, a real commune
 * from the allow-list, a real amenity id) happens client-side in
 * lib/smartPaste.js — this function only does the network call, same
 * boundary every other function in this file keeps.
 * @returns {Promise<{extracted_data: Object}>}
 */
export async function parseAgentListingText(text) {
  return engineFetch('/admin/parse-listing', { method: 'POST', body: JSON.stringify({ text }) });
}

/**
 * @param {number} propertyId
 * @param {'approved'|'rejected'} status
 * @param {{reasonCode?: string|null, note?: string|null}} [reason] a rejection's
 *   code and free-text note, which the engine turns into the agent's message.
 */
export async function notifyListingModeration(propertyId, status, { reasonCode = null, note = null } = {}) {
  return engineFetch(`/admin/properties/${propertyId}/notify`, {
    method: 'POST',
    body: JSON.stringify({ status, reason_code: reasonCode, note }),
  });
}

/** The engine's half of the console's work queues (viewings, conversations, sends). */
export async function getEngineWorkQueueCounts() {
  return engineFetch('/admin/work-queues');
}

/** The engine's own health report — jobs, sends, database, configuration. */
export async function getEngineHealth() {
  return engineFetch('/admin/health');
}

/**
 * The matching console's whole dataset in one call — see routes/admin.js's
 * GET /leads/matching-stats for why it is one endpoint rather than five.
 * @param {{days?: number}} [options]
 */
export async function getMatchingStats({ days = 30 } = {}) {
  return engineFetch(`/admin/leads/matching-stats?days=${encodeURIComponent(days)}`);
}

/**
 * The paginated (request × agency) table on /admin/matching — see the engine's
 * db.listLeadMatches for the budget-overlap and proposal-join rules.
 */
export async function listLeadMatches({
  days = 30, commune, budgetMin, budgetMax, minScore, status, agentId, limit, offset,
} = {}) {
  const params = new URLSearchParams({ days: String(days) });
  if (agentId != null) params.set('agent_id', String(agentId));
  if (commune) params.set('commune', commune);
  if (budgetMin !== undefined && budgetMin !== '') params.set('budget_min', String(budgetMin));
  if (budgetMax !== undefined && budgetMax !== '') params.set('budget_max', String(budgetMax));
  if (minScore !== undefined && minScore !== '') params.set('min_score', String(minScore));
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  return engineFetch(`/admin/lead-matches?${params.toString()}`);
}

/**
 * Enquiry and viewing counts for one page of customers, keyed by wa_id.
 * @param {string[]} waIds at most 200
 * @returns {Promise<Record<string, {leads: number, viewings: number, lastLeadAt: string|null}>>}
 */
export async function getLeadCountsByWaIds(waIds) {
  const ids = [...new Set((waIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { counts } = await engineFetch(`/admin/leads/counts?wa_ids=${encodeURIComponent(ids.join(','))}`);
  return counts || {};
}

/** The engine half of /admin/telemetry's performance cards. */
export async function getLeadAnalytics({ days = 30 } = {}) {
  return engineFetch(`/admin/lead-analytics?days=${encodeURIComponent(days)}`);
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

// ---------------------------------------------------------------------------
// Direct-to-agent routing — /admin/viewings, /admin/telemetry,
// /admin/market-data, /admin/benchmarks.
// ---------------------------------------------------------------------------

/**
 * Every viewing request across every agent, plus unfiltered status / routing /
 * fall-through counts. NOT the owner-scoped listViewingRequests above.
 */
export async function listViewingFeed({
  status, routingType, view, q, agentIds, commune, from, to, limit, offset,
} = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (routingType) params.set('routing_type', routingType);
  if (view) params.set('view', view);
  if (q) params.set('q', q);
  if (agentIds?.length) params.set('agent_ids', agentIds.join(','));
  if (commune) params.set('commune', commune);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (limit) params.set('limit', String(limit));
  if (offset) params.set('offset', String(offset));
  const query = params.toString();
  return engineFetch(`/admin/viewing-requests/feed${query ? `?${query}` : ''}`);
}

/** Hand a request to another verified agent; the engine alerts them with buttons. */
export async function reassignViewingRequest(id, agentId) {
  return engineFetch(`/admin/viewing-requests/${id}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ agent_id: agentId }),
  });
}

/** Resend the current agent's alert. */
export async function nudgeViewingRequest(id) {
  return engineFetch(`/admin/viewing-requests/${id}/nudge`, { method: 'POST' });
}

/** @param {string} scheduledAt ISO-8601 with an offset. */
export async function scheduleViewingRequest(id, scheduledAt) {
  return engineFetch(`/admin/viewing-requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
}

/** GET /api/admin/benchmarks/agent-performance — leaderboard + commune deltas. */
export async function getAgentPerformance({ days = 90 } = {}) {
  return engineFetch(`/api/admin/benchmarks/agent-performance?days=${encodeURIComponent(days)}`);
}
