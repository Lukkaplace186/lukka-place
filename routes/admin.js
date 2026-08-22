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
  const { status, limit, offset } = req.query;

  if (status && !db.LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status '${status}'.` });
  }

  try {
    const page = db.listLeads({ status, limit, offset });
    return res.json({ success: true, ...page });
  } catch (err) {
    console.error(`[admin] GET /leads failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read leads.' });
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

module.exports = router;
