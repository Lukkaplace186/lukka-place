/**
 * routes/admin.js
 *
 * Read/write API for the conversations + leads admin dashboard (product
 * spec §19), consumed by the Next.js app in `web/` — same pattern already
 * established by GET /locations (see index.js's doc comment there): the
 * engine owns its own SQLite data, the frontend is a client of this API,
 * never a second process reaching into the same database file.
 *
 * Mounted at /admin in index.js, behind the same `requireApiKey` middleware
 * GET /listings already uses — no new auth mechanism invented. Note: this
 * only gates the API. The web/ admin *pages* themselves have no login of
 * their own yet (see web/CLAUDE.md) — do not deploy this anywhere public
 * without adding one first.
 */

const express = require('express');
const db = require('../services/db');
const chakra = require('../services/chakra');
const { STATES } = require('../services/conversationState');

const router = express.Router();

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

router.get('/conversations', (req, res) => {
  const { state, limit, offset } = req.query;

  if (state && !Object.values(STATES).includes(state)) {
    return res.status(400).json({ success: false, error: `Invalid state '${state}'.` });
  }

  try {
    const page = db.listConversations({ state, limit, offset });
    return res.json({ success: true, ...page });
  } catch (err) {
    console.error(`[admin] GET /conversations failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read conversations.' });
  }
});

router.get('/conversations/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const conversation = Number.isFinite(id) ? db.getConversation(id) : null;
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  const messages = db.getMessages(id);
  const leads = db.getLeadsByConversation(id);
  return res.json({ success: true, conversation, messages, leads });
});

const CONVERSATION_PATCHABLE = ['state', 'assigned_agent', 'ai_active', 'notes'];

/**
 * Covers "assign agent" (assigned_agent), "take over" (ai_active=false +
 * state=HUMAN_HANDOFF, sent as two fields in one request), "return to AI"
 * (ai_active=true + state=COLLECTING_REQUIREMENTS), and internal notes —
 * all product spec §19 admin actions, applied through the exact same
 * validated functions services/openai.js's buyer assistant uses, so an
 * admin action can never leave the conversation in a state the AI itself
 * couldn't have reached.
 */
router.patch('/conversations/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || !db.getConversation(id)) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  const body = req.body || {};
  const unknownKeys = Object.keys(body).filter((k) => !CONVERSATION_PATCHABLE.includes(k));
  if (unknownKeys.length) {
    return res.status(400).json({ success: false, error: `Unknown field(s): ${unknownKeys.join(', ')}` });
  }

  try {
    if (body.state !== undefined) {
      db.updateConversationState(id, body.state);
    }
    if (body.ai_active !== undefined) {
      db.setConversationAiActive(id, Boolean(body.ai_active));
    }
    if (body.assigned_agent !== undefined) {
      db.assignConversationAgent(id, body.assigned_agent);
    }
    if (body.notes !== undefined) {
      db.updateConversationNotes(id, body.notes);
    }
    return res.json({ success: true, conversation: db.getConversation(id) });
  } catch (err) {
    // A rejected state transition is a real, expected outcome (the agent's
    // UI should show why), not a 500 — see conversationState.js's own error
    // messages for what this looks like.
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * A human agent sending a manual reply from the dashboard — the "take
 * over" flow's actual point: once ai_active is false, this is the only way
 * a reply goes out for this conversation.
 */
router.post('/conversations/:id/reply', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const conversation = Number.isFinite(id) ? db.getConversation(id) : null;
  if (!conversation) {
    return res.status(404).json({ success: false, error: 'Conversation not found.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ success: false, error: 'text is required.' });
  }

  try {
    await chakra.sendWhatsAppMessage(conversation.wa_id, text);
  } catch (err) {
    console.error(`[admin] manual reply to conversation #${id} failed to send: ${err.message}`);
    return res.status(502).json({ success: false, error: 'WhatsApp send failed — message was not recorded.' });
  }

  const message = db.recordMessage(id, 'outbound', { text });
  return res.json({ success: true, message });
});

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

router.get('/leads', (req, res) => {
  const { status, property_ids: propertyIdsRaw, assigned_agent: assignedAgent, agent_id: agentIdRaw, wa_id: waId, limit, offset } = req.query;

  if (status && !db.LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
  }

  let agentId;
  if (agentIdRaw !== undefined) {
    agentId = Number.parseInt(agentIdRaw, 10);
    if (!Number.isFinite(agentId)) {
      return res.status(400).json({ success: false, error: 'agent_id must be a real integer.' });
    }
  }

  // Agent dashboard's Lead Activity Stream — comma-separated real Postgres
  // properties.id values, scoping the stream to one agent's own listings.
  let propertyIds;
  if (propertyIdsRaw) {
    propertyIds = String(propertyIdsRaw)
      .split(',')
      .map((id) => Number.parseInt(id, 10))
      .filter(Number.isFinite);
    if (propertyIds.length === 0) {
      return res.status(400).json({ success: false, error: 'property_ids must contain at least one valid id.' });
    }
  }

  // Customer inquiry history (web/) — scopes the stream to one customer's
  // own submitted leads. Same digits-only wa_id shape POST /send-whatsapp
  // already validates, since a lead's wa_id is always a real WhatsApp number.
  if (waId !== undefined && !/^\d{9,15}$/.test(String(waId))) {
    return res.status(400).json({ success: false, error: 'wa_id must be a real digits-only WhatsApp number.' });
  }

  try {
    const page = db.listLeads({ status, propertyIds, assignedAgent, agentId, waId, limit, offset });
    return res.json({ success: true, ...page });
  } catch (err) {
    console.error(`[admin] GET /leads failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read leads.' });
  }
});

/**
 * Agent storefront's "Demandez ce bien à cet agent" inquiry form (web/) —
 * a real visitor-initiated lead, same table/shape every other lead already
 * uses (buyer-conversation tool calls, etc.), not a separate mechanism.
 * wa_id is required (matches db.createLead's own invariant) since the whole
 * point of a lead is the agent following up on WhatsApp.
 */
router.post('/leads', (req, res) => {
  const {
    wa_id: waId,
    name,
    source,
    property_id: propertyId,
    assigned_agent: assignedAgent,
    requirements_summary: requirementsSummary,
    // Agent Demand Feed needs these as real structured columns to filter on
    // (commune, budget, bedrooms) — previously only web/'s "Trouver pour
    // moi" form folded them into requirements_summary as free text and
    // never forwarded the structured values this far, which silently broke
    // commune-based routing for every request submitted that way.
    transaction_type: transactionType,
    commune,
    price_min: priceMin,
    price_max: priceMax,
    bedrooms,
  } = req.body || {};
  if (!waId) {
    return res.status(400).json({ success: false, error: 'wa_id is required.' });
  }

  try {
    const lead = db.createLead({
      wa_id: waId,
      name: name || null,
      source: source || 'agent-profile-inquiry',
      property_id: propertyId ?? null,
      assigned_agent: assignedAgent || null,
      requirements_summary: requirementsSummary || null,
      transaction_type: transactionType || null,
      commune: commune || null,
      price_min: priceMin ?? null,
      price_max: priceMax ?? null,
      bedrooms: bedrooms ?? null,
    });
    return res.status(201).json({ success: true, lead });
  } catch (err) {
    console.error(`[admin] POST /leads failed: ${err.message}`);
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Agent Demand Feed — open "Trouver pour moi" requests + multi-agent
// pitching. Registered before GET /leads/:id so 'open'/'proposals' are
// never swallowed as an :id value.
// ---------------------------------------------------------------------------

router.get('/leads/open', (req, res) => {
  const { communes: communesRaw, limit } = req.query;
  const communes = communesRaw ? String(communesRaw).split(',').filter(Boolean) : undefined;

  try {
    const page = db.listOpenLeads({ communes, limit });
    // The actual privacy boundary: an agent who hasn't pitched (or been
    // assigned) a lead must never receive its real phone/name over the
    // wire, not just have the UI choose not to render them.
    const data = page.data.map(({ wa_id, name, ...rest }) => rest);
    return res.json({ success: true, ...page, data });
  } catch (err) {
    console.error(`[admin] GET /leads/open failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read open leads.' });
  }
});

router.get('/leads/proposals', (req, res) => {
  const { lead_ids: leadIdsRaw } = req.query;
  if (!leadIdsRaw) {
    return res.status(400).json({ success: false, error: 'lead_ids is required.' });
  }
  const leadIds = String(leadIdsRaw)
    .split(',')
    .map((id) => Number.parseInt(id, 10))
    .filter(Number.isFinite);

  try {
    const proposals = db.getLeadProposals(leadIds);
    return res.json({ success: true, proposals });
  } catch (err) {
    console.error(`[admin] GET /leads/proposals failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read proposals.' });
  }
});

/**
 * Agent Demand Feed's monthly pitch quota — a real count of this agent's own
 * lead_proposals rows since `since`. Registered before GET /leads/:id so
 * 'proposals-usage' is never parsed as a lead id, same reason
 * 'open'/'proposals' above are.
 */
router.get('/leads/proposals-usage', (req, res) => {
  const agentId = Number.parseInt(req.query.agent_id, 10);
  const since = String(req.query.since || '');
  if (!Number.isFinite(agentId)) {
    return res.status(400).json({ success: false, error: 'agent_id is required.' });
  }
  if (!since || Number.isNaN(new Date(since).getTime())) {
    return res.status(400).json({ success: false, error: 'since must be a valid ISO timestamp.' });
  }

  try {
    const used = db.countAgentProposalsSince({ agentId, since });
    return res.json({ success: true, used, since });
  } catch (err) {
    console.error(`[admin] GET /leads/proposals-usage failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read pitch usage.' });
  }
});

router.post('/leads/:id/proposals', (req, res) => {
  const leadId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(leadId) || !db.getLead(leadId)) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const agentId = Number.parseInt(req.body?.agent_id, 10);
  const propertyId = Number.parseInt(req.body?.property_id, 10);
  if (!Number.isFinite(agentId) || !Number.isFinite(propertyId)) {
    return res.status(400).json({ success: false, error: 'agent_id and property_id are required.' });
  }

  try {
    const proposal = db.createLeadProposal({ leadId, agentId, propertyId });
    return res.status(201).json({ success: true, proposal });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/leads/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const lead = Number.isFinite(id) ? db.getLead(id) : null;
  if (!lead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }
  return res.json({ success: true, lead });
});

router.patch('/leads/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existingLead = Number.isFinite(id) ? db.getLead(id) : null;
  if (!existingLead) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const {
    status,
    agent_id: agentId,
    assigned_agent: assignedAgent,
    // Customer-side "Modifier ma recherche" edit (web/'s Messages & Visites)
    // — the same structured columns POST /leads already accepts, now
    // writable after the fact. requirements object keys mirror
    // db.LEAD_REQUIREMENT_FIELDS exactly.
    transaction_type: transactionType,
    commune,
    quartier,
    price_min: priceMin,
    price_max: priceMax,
    bedrooms,
    requirements_summary: requirementsSummary,
  } = req.body || {};
  const requirementsPatch = {
    transaction_type: transactionType,
    commune,
    quartier,
    price_min: priceMin,
    price_max: priceMax,
    bedrooms,
    requirements_summary: requirementsSummary,
  };
  const hasRequirementsPatch = Object.values(requirementsPatch).some((v) => v !== undefined);

  if (status === undefined && agentId === undefined && assignedAgent === undefined && !hasRequirementsPatch) {
    return res.status(400).json({
      success: false,
      error: 'status, agent_id, assigned_agent, or a requirements field is required.',
    });
  }

  // Commune-sensitive reset: decided here, against the row fetched *before*
  // any write above, never from anything the caller asserts — a client
  // claiming "commune changed" is not trustworthy, the engine's own before/
  // after comparison is. Only fires when this patch actually carries a
  // commune (every other PATCH caller — status changes, Request Assignment
  // Routing — never touches this field, so `undefined` correctly means
  // "leave it alone", same as updateLeadRequirements' own convention.
  const communeChanged =
    requirementsPatch.commune !== undefined && requirementsPatch.commune !== existingLead.commune;

  try {
    if (status !== undefined) db.updateLeadStatus(id, status);
    // Admin dashboard's Request Assignment Routing — web/ resolves the real
    // agent's display name before calling this (it has Postgres access to
    // agent_infos, which this SQLite-only engine doesn't), so both fields
    // arrive together; agentId: null explicitly un-assigns.
    if (agentId !== undefined || assignedAgent !== undefined) {
      db.assignLead(id, { agentId: agentId ?? null, assignedAgent: assignedAgent ?? null });
    }
    if (hasRequirementsPatch) db.updateLeadRequirements(id, requirementsPatch);
    // Runs after updateLeadRequirements so the reset's own status='NEW' /
    // pitches_count=0 win over anything the requirements patch itself set —
    // a stale pitch count is exactly what this is meant to fix.
    if (communeChanged) db.resetLeadProposals(id);
    return res.json({ success: true, lead: db.getLead(id), proposals_reset: communeChanged });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Viewing requests — the agent dashboard's Visit Scheduler. Same
// property_ids/assigned_agent ownership-scoping convention as GET /leads
// above (see db.listViewingRequestsForOwner's doc comment for why this has
// to go through the parent lead, one hop, since viewing_requests carries no
// agent column of its own).
// ---------------------------------------------------------------------------

/**
 * Public "Demander une visite" form (web/app/(site)/listings/[id] — a real
 * visitor submitting a visit request for a specific listing, not the agent
 * dashboard). `lead_id` is required (matches db.createViewingRequest's own
 * invariant) — the caller creates the lead first via POST /leads, same
 * two-step sequence the buyer-assistant's request_viewing tool already does
 * internally (services/openai.js).
 */
router.post('/viewing-requests', (req, res) => {
  const { lead_id: leadId, property_id: propertyId, requested_time: requestedTime } = req.body || {};
  const numericLeadId = Number.parseInt(leadId, 10);
  if (!Number.isFinite(numericLeadId) || !db.getLead(numericLeadId)) {
    return res.status(400).json({ success: false, error: 'lead_id must reference a real lead.' });
  }

  try {
    const viewingRequest = db.createViewingRequest({ leadId: numericLeadId, propertyId, requestedTime });
    return res.status(201).json({ success: true, viewingRequest });
  } catch (err) {
    console.error(`[admin] POST /viewing-requests failed: ${err.message}`);
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/viewing-requests', (req, res) => {
  const { status, property_ids: propertyIdsRaw, assigned_agent: assignedAgent, limit, offset } = req.query;

  if (status && !db.VIEWING_REQUEST_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
  }

  let propertyIds;
  if (propertyIdsRaw) {
    propertyIds = String(propertyIdsRaw)
      .split(',')
      .map((id) => Number.parseInt(id, 10))
      .filter(Number.isFinite);
    if (propertyIds.length === 0) {
      return res.status(400).json({ success: false, error: 'property_ids must contain at least one valid id.' });
    }
  }

  try {
    const page = db.listViewingRequestsForOwner({ propertyIds, assignedAgent, status, limit, offset });
    return res.json({ success: true, ...page });
  } catch (err) {
    console.error(`[admin] GET /viewing-requests failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read viewing requests.' });
  }
});

router.patch('/viewing-requests/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || !db.getViewingRequest(id)) {
    return res.status(404).json({ success: false, error: 'Viewing request not found.' });
  }

  const { status, requested_time: requestedTime } = req.body || {};
  if (status === undefined && requestedTime === undefined) {
    return res.status(400).json({ success: false, error: 'status or requested_time is required.' });
  }

  try {
    const viewingRequest = db.updateViewingRequest(id, { status, requestedTime });
    return res.json({ success: true, viewingRequest });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Properties (moderation notifications)
// ---------------------------------------------------------------------------

const MODERATION_MESSAGES = {
  approved: (propertyId) =>
    `Bonjour, bonne nouvelle ! Votre annonce est maintenant en ligne : https://lukkaplace.com/listings/${propertyId}`,
  rejected: () =>
    `Bonjour, votre annonce nécessite quelques ajustements avant de pouvoir être publiée. Notre équipe vous contactera bientôt pour en discuter.`,
};

/**
 * Notifies the original WhatsApp submitter that their listing was
 * approved/rejected — called by web/'s admin moderation dashboard right
 * after it flips `properties.approve_status` in Postgres. That table has no
 * wa_id/phone column at all; the only link back to the sender is
 * `listings.remote_property_id` here in the engine's own SQLite.
 *
 * Validation (bad status, no matching submitter) still happens synchronously
 * and gets a real 4xx — those are caller mistakes, worth surfacing. The
 * actual Chakra send is deferred via setImmediate and this returns 202
 * before it resolves, so a slow/hanging WhatsApp API call never holds this
 * response open. The deferred callback has its own try/catch specifically
 * so a send failure can only ever become a console.error — letting it
 * throw uncaught inside a bare setImmediate would not be caught by
 * Express's error handling and risks crashing the whole engine process
 * (which also serves agent-intake and buyer-conversation WhatsApp traffic,
 * not just this admin feature) over what's meant to be a best-effort
 * courtesy notification.
 */
router.post('/properties/:remotePropertyId/notify', async (req, res) => {
  const remotePropertyId = Number.parseInt(req.params.remotePropertyId, 10);
  if (!Number.isFinite(remotePropertyId)) {
    return res.status(400).json({ success: false, error: 'remotePropertyId must be numeric.' });
  }

  const status = req.body?.status;
  const buildMessage = MODERATION_MESSAGES[status];
  if (!buildMessage) {
    return res.status(400).json({ success: false, error: `status must be one of: ${Object.keys(MODERATION_MESSAGES).join(', ')}` });
  }

  const listing = db.getListingByRemotePropertyId(remotePropertyId);
  if (!listing) {
    return res.status(404).json({ success: false, error: 'No submitting listing found for this property.' });
  }

  setImmediate(async () => {
    try {
      await chakra.sendWhatsAppMessage(listing.wa_id, buildMessage(remotePropertyId));
    } catch (err) {
      console.error(`[admin] moderation notify for property #${remotePropertyId} failed to send: ${err.message}`);
    }
  });

  return res.status(202).json({ success: true, queued: true });
});

// ---------------------------------------------------------------------------
// Agent listing attribution (web/)
// ---------------------------------------------------------------------------

/**
 * Attribute the listings a phone number already published to the agent who
 * now owns that number.
 *
 * This lives in the engine because only the engine can answer the question.
 * `properties` in Postgres records a resolved `agent_id` but never a
 * submitter phone, so the wa_id -> property_id mapping exists nowhere except
 * this engine's own SQLite `listings` table.
 *
 * The gap it closes: attribution is resolved during a sync, and a sync only
 * happens on publish or correction. An agent who sends listings by WhatsApp
 * *before* registering on the web — overwhelmingly the real order — was never
 * linked to any of them, permanently. 23 of 31 live listings had no agent at
 * all when this was written; their submitters could not edit them, mark them
 * sold, or see them in a dashboard, and every enquiry went to the central
 * number instead of to them.
 *
 * Intended caller: web/'s phone-verification step, right after an agent
 * proves they hold the number. Safe to call repeatedly — it only ever fills a
 * NULL agent_id, so an attribution an admin made by hand always wins, and a
 * second call simply links nothing.
 */
router.post('/agents/claim-listings', async (req, res) => {
  const waId = String(req.body?.wa_id ?? '').replace(/\D/g, '');
  if (!waId) {
    return res.status(400).json({ success: false, error: 'wa_id is required (digits only)' });
  }

  try {
    const remotePropertyIds = db.getRemotePropertyIdsForWaId(waId);
    if (!remotePropertyIds.length) {
      return res.json({ success: true, agentId: null, linkedIds: [], linked: 0 });
    }

    const { agentId, linkedIds } = await require('../services/postgres').linkListingsToAgent(
      remotePropertyIds,
      waId,
    );
    if (agentId) {
      console.log(`[admin] claim-listings ${waId} -> agent #${agentId}: linked ${linkedIds.length}`);
    }
    return res.json({ success: true, agentId, linkedIds, linked: linkedIds.length });
  } catch (err) {
    console.error(`[admin] claim-listings failed for ${waId}: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Generic WhatsApp send (agent phone-verification OTP, web/)
// ---------------------------------------------------------------------------

/**
 * Deliberately generic ("send this message to this phone"), not
 * "/send-otp" — the engine has no concept of "agents" at all; OTP
 * generation, hashing, and expiry all live on the Postgres side in web/
 * (lib/agentAuth.js). This is the one thing only the engine can do (hold
 * real Chakra credentials and call the WhatsApp API), nothing more.
 *
 * Synchronous, not the setImmediate+202 pattern the moderation-notify route
 * above uses — that one is a best-effort courtesy after a DB write that
 * already succeeded; this one gates whether the caller can even tell a
 * registering agent "check your WhatsApp," so the caller genuinely needs to
 * know whether the send worked before responding.
 */
router.post('/send-whatsapp', async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !/^\d{9,15}$/.test(String(phone))) {
    return res.status(400).json({ success: false, error: 'phone must be a real digits-only wa_id.' });
  }
  if (!message || typeof message !== 'string' || message.length > 1000) {
    return res.status(400).json({ success: false, error: 'message is required (max 1000 chars).' });
  }

  try {
    // Log Meta's accepted-message envelope, not just failures. A Cloud API
    // send can return 200 with a real message id and still never reach the
    // handset (24h customer-service window, an app still in development
    // mode with an allow-list of test recipients, a number with no WhatsApp
    // account). Without this line those cases are indistinguishable from a
    // message that was delivered, because the only other log here fires on
    // throw — which is exactly the dead end an OTP that "sends" but never
    // arrives leaves you in.
    const result = await chakra.sendWhatsAppMessage(phone, message);
    console.log(
      `[admin] send-whatsapp to ${phone} accepted by Meta: ${JSON.stringify({
        messageId: result?.messages?.[0]?.id ?? null,
        messageStatus: result?.messages?.[0]?.message_status ?? null,
        contactWaId: result?.contacts?.[0]?.wa_id ?? null,
        contactInput: result?.contacts?.[0]?.input ?? null,
      })}`,
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(`[admin] send-whatsapp to ${phone} failed: ${err.message}`);
    return res.status(502).json({ success: false, error: 'WhatsApp send failed.' });
  }
});

/**
 * Template send — the only reliable way to deliver an agent's verification
 * code.
 *
 * A free-form text (POST /send-whatsapp above) is only delivered to someone
 * who has messaged this business within the last 24 hours. A brand-new agent
 * signing up never has, so Meta accepts the call with a real message id and
 * then never delivers it — a silent dead end, diagnosed directly against the
 * live account. An approved AUTHENTICATION-category template has no such
 * window, which is why the OTP path uses this endpoint instead.
 *
 * `otp_code` is passed separately from `body_params` on purpose: an
 * authentication template needs the same code in BOTH the body and its
 * copy-code button, and services/chakra.js builds that second component
 * only when this field is present.
 */
router.post('/send-whatsapp-template', async (req, res) => {
  const {
    phone,
    template,
    language_code: languageCode,
    body_params: bodyParams,
    otp_code: otpCode,
  } = req.body || {};

  if (!phone || !/^\d{9,15}$/.test(String(phone))) {
    return res.status(400).json({ success: false, error: 'phone must be a real digits-only wa_id.' });
  }
  if (!template || typeof template !== 'string') {
    return res.status(400).json({ success: false, error: 'template name is required.' });
  }
  if (bodyParams !== undefined && !Array.isArray(bodyParams)) {
    return res.status(400).json({ success: false, error: 'body_params must be an array.' });
  }

  try {
    const result = await chakra.sendTemplate(phone, template, {
      languageCode: languageCode || 'fr',
      bodyParams: bodyParams || [],
      otpCode: otpCode || undefined,
    });
    console.log(
      `[admin] send-whatsapp-template '${template}' to ${phone} accepted by Meta: ${JSON.stringify({
        messageId: result?.messages?.[0]?.id ?? null,
        messageStatus: result?.messages?.[0]?.message_status ?? null,
      })}`,
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(`[admin] send-whatsapp-template '${template}' to ${phone} failed: ${err.message}`);
    return res.status(502).json({ success: false, error: `WhatsApp template send failed: ${err.message}` });
  }
});

module.exports = router;
