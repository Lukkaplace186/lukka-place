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
  const { status, property_ids: propertyIdsRaw, wa_id: waId, limit, offset } = req.query;

  if (status && !db.LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
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
    const page = db.listLeads({ status, propertyIds, waId, limit, offset });
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
    });
    return res.status(201).json({ success: true, lead });
  } catch (err) {
    console.error(`[admin] POST /leads failed: ${err.message}`);
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
  if (!Number.isFinite(id) || !db.getLead(id)) {
    return res.status(404).json({ success: false, error: 'Lead not found.' });
  }

  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ success: false, error: 'status is required.' });
  }

  try {
    const lead = db.updateLeadStatus(id, status);
    return res.json({ success: true, lead });
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
    await chakra.sendWhatsAppMessage(phone, message);
    return res.json({ success: true });
  } catch (err) {
    console.error(`[admin] send-whatsapp to ${phone} failed: ${err.message}`);
    return res.status(502).json({ success: false, error: 'WhatsApp send failed.' });
  }
});

module.exports = router;
