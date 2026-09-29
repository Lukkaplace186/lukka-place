/**
 * Bon de visite — the agent's "la visite a eu lieu", and the receipt it sends.
 *
 * One hour after a CONFIRMED visit's `scheduled_at`, the listing's verified
 * agent is asked once, on WhatsApp, "La visite … a-t-elle eu lieu ?" with two
 * buttons (`visit_done:<id>` / `visit_notdone:<id>`, a typed OUI / NON when
 * the buttons do not arrive). The agent dashboard's "Visite effectuée" button
 * reaches the same `recordAgentOutcome` through
 * POST /admin/viewing-requests/:id/agent-completed.
 *
 * DONE:
 *  - stamps `agent_completed_at` and keeps the receipt text verbatim on the
 *    row (`visit_receipt_text`) — the timestamped proof that the introduction
 *    happened through Lukka Place;
 *  - sends the customer the receipt; `visit_receipt_sent_at` only when Chakra
 *    accepted it (a session message: it reaches a customer active in the last
 *    24 h, or a template once VISIT_RECEIPT_TEMPLATE is approved — unset by
 *    default, like every template name here);
 *  - answers the agent with a wa.me link carrying the same receipt, so they
 *    can send it from their own WhatsApp, which lands whatever our window.
 *
 * NOT_DONE tells the desk (OPS_WHATSAPP_NUMBER) and nothing else.
 *
 * Neither answer changes the status. COMPLETED remains the CUSTOMER's
 * check-in (services/viewingSweeps.js): an agent's claim alone never
 * completes a visit. The outcome is written once (`agent_visit_outcome IS
 * NULL` in the UPDATE), so a second tap or the dashboard after WhatsApp
 * changes nothing and sends nothing.
 *
 * Authorisation is the viewing loop's own: WhatsApp answers go through
 * viewingNotifications.resolveContext (the listing's — or the reassigned —
 * verified agent), dashboard answers through agents.id like
 * respondFromDashboard. A refusal is silent to the sender.
 */

const dbService = require('./db');
const chakra = require('./chakra');
const propertyRepository = require('./propertyRepository');
const { formatSlotFr } = require('./visitSchedule');
const viewing = require('./viewingNotifications');

const DONE_PREFIX = 'visit_done';
const NOT_DONE_PREFIX = 'visit_notdone';
const PENDING_KIND = 'VISIT_DONE';

/** Ask one hour after the slot; never about a visit more than 3 days old. */
const ASK_AFTER_MS = 60 * 60 * 1000;
const ASK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const HEADER_BRAND = '🏠 [Lukka Place]';

function parseVisitDoneButtonId(replyId) {
  const match = /^(visit_done|visit_notdone):(\d+)$/.exec(String(replyId || '').trim());
  if (!match) return null;
  return { outcome: match[1] === DONE_PREFIX ? 'DONE' : 'NOT_DONE', viewingRequestId: Number.parseInt(match[2], 10) };
}

/** OUI / NON (and 1 / 2) typed instead of tapped; null for anything else. */
function parseVisitDoneText(text) {
  const raw = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[️⃣.!]/g, '')
    .trim();
  if (/^(1|oui|yes|ok|oui elle a eu lieu|effectuee|faite)$/.test(raw)) return 'DONE';
  if (/^(2|non|no|pas eu lieu|annulee)$/.test(raw)) return 'NOT_DONE';
  return null;
}

function visitDoneButtons(viewingRequestId) {
  return [
    { id: `${DONE_PREFIX}:${viewingRequestId}`, title: '✅ Oui, effectuée' },
    { id: `${NOT_DONE_PREFIX}:${viewingRequestId}`, title: '❌ Non' },
  ];
}

/** "Réf. LKP-2026-0091" when set — never an invented reference. */
function listingName(listing, propertyId) {
  const label = viewing.listingLabel(listing, propertyId);
  return listing?.reference && !label.includes(listing.reference) ? `${label} (Réf. ${listing.reference})` : label;
}

function askText(listing, request) {
  const when = formatSlotFr(request.scheduled_at) || request.scheduled_at;
  return [
    `${HEADER_BRAND} Bon de visite`,
    '',
    `La visite du ${when} pour ${listingName(listing, request.property_id)} a-t-elle eu lieu ?`,
    `Client : ${request.lead_name || viewing.displayPhone(request.lead_wa_id)}`,
    '',
    'Si oui, nous envoyons au client un bon de visite daté. Répondez OUI ou NON.',
  ].join('\n');
}

/** The receipt the customer receives — kept verbatim on the row. French always. */
function receiptText({ listing, request, propertyId }) {
  const when = formatSlotFr(request.scheduled_at);
  const agent = listing?.agent_name ? ` avec ${listing.agent_name}` : '';
  return [
    `${HEADER_BRAND} Bon de visite`,
    '',
    `Merci pour votre visite du bien ${listingName(listing, propertyId)}${when ? ` le ${when}` : ''}${agent}.`,
    'Cette visite a été organisée par l’intermédiaire de Lukka Place.',
    '',
    viewing.listingLink(listing, propertyId),
  ].join('\n');
}

function agentAckText(customerWaId, text) {
  const digits = String(customerWaId || '').replace(/\D/g, '');
  const lines = [`${HEADER_BRAND} Merci ✅ Visite enregistrée comme effectuée.`];
  if (digits) {
    lines.push('', 'Envoyez aussi le bon de visite depuis votre WhatsApp :', `https://wa.me/${digits}?text=${encodeURIComponent(text)}`);
  }
  return lines.join('\n');
}

function opsNotDoneText({ listing, request, propertyId }) {
  const when = formatSlotFr(request.scheduled_at) || request.scheduled_at;
  return [
    `${HEADER_BRAND} Visite non effectuée`,
    '',
    `L’agent indique que la visite du ${when} n’a pas eu lieu.`,
    `Bien : ${listingName(listing, propertyId)}`,
    `Client : ${request.lead_name || ''} ${viewing.displayPhone(request.lead_wa_id)}`.trim(),
    `Demande #${request.id}`,
  ].join('\n');
}

/**
 * Record the agent's answer and do what it entails. `request` is a
 * getViewingRequestWithLead row, `listing` its listing contact (possibly with
 * a reassigned agent laid over it).
 */
async function recordAgentOutcome({ request, listing, propertyId, outcome, now = new Date(), sendAgentAck = null }) {
  if (request.status !== 'CONFIRMED') return { ok: false, reason: 'not-confirmed' };
  if (!request.scheduled_at || new Date(request.scheduled_at).getTime() > now.getTime()) {
    return { ok: false, reason: 'not-yet' };
  }
  const text = outcome === 'DONE' ? receiptText({ listing, request, propertyId }) : null;
  const recorded = dbService.recordAgentVisitOutcome(request.id, { outcome, at: now.toISOString(), receiptText: text });
  dbService.clearPendingAgentActionsForViewing(request.id);
  if (!recorded) return { ok: true, unchanged: true, outcome: request.agent_visit_outcome || outcome };

  if (outcome === 'NOT_DONE') {
    await viewing.notifyOps(opsNotDoneText({ listing, request, propertyId }), 'visit not done');
    console.log(`[visit-receipt] request #${request.id}: agent says the visit did NOT take place`);
    return { ok: true, outcome, receiptSent: false };
  }

  const sent = await sendReceipt(request.lead_wa_id, text, [
    listingName(listing, propertyId),
    formatSlotFr(request.scheduled_at) || '',
    listing?.agent_name || 'votre agent',
  ]);
  if (sent) dbService.markVisitReceiptSent(request.id, new Date().toISOString());
  if (sendAgentAck) await viewing.trySend(sendAgentAck, agentAckText(request.lead_wa_id, text), 'visit done ack');
  console.log(`[visit-receipt] request #${request.id} DONE — receipt sent to customer: ${sent}`);
  return { ok: true, outcome, receiptSent: sent, receiptText: text, customerWaId: request.lead_wa_id };
}

/**
 * Template first when VISIT_RECEIPT_TEMPLATE names an approved one (read at
 * call time, unset by default), else a session message. Template body to
 * submit (UTILITY, fr): "Merci pour votre visite du bien {{1}} le {{2}} avec
 * {{3}}. Cette visite a été organisée par l'intermédiaire de Lukka Place."
 */
async function sendReceipt(waId, text, params) {
  if (!waId) return false;
  const template = process.env.VISIT_RECEIPT_TEMPLATE || null;
  if (chakra.templateConfigured(template)) {
    try {
      await chakra.sendTemplate(String(waId).replace(/\D/g, ''), template, { bodyParams: params });
      return true;
    } catch (err) {
      console.error(`[visit-receipt] template send failed (${err.message}) — falling back to a session message`);
    }
  }
  return viewing.trySend(waId, text, 'visit receipt');
}

// --- WhatsApp answers -----------------------------------------------------------

async function handleVisitDoneButtonReply({ from, replyId }) {
  const parsed = parseVisitDoneButtonId(replyId);
  if (!parsed) return { handled: false };
  const ctx = await viewing.resolveContext(parsed.viewingRequestId, from);
  if (!ctx.request) return { handled: true, ignored: 'unknown-request' };
  if (!ctx.authorised) {
    console.warn(`[visit-receipt] button '${replyId}' from ${from} refused — ${ctx.reason}`);
    return { handled: true, ignored: ctx.reason };
  }
  const result = await recordAgentOutcome({ ...ctx, outcome: parsed.outcome, sendAgentAck: from });
  if (result.unchanged) await viewing.trySend(from, `${HEADER_BRAND} C’est déjà enregistré, merci.`, 'visit done repeat');
  return { handled: true, ...result };
}

/** A typed OUI / NON while the bon-de-visite question is this number's open one. */
async function handleVisitDoneTextReply({ from, text, pending }) {
  if (!pending || pending.kind !== PENDING_KIND) return { handled: false };
  const outcome = parseVisitDoneText(text);
  if (!outcome) return { handled: false };
  const ctx = await viewing.resolveContext(pending.viewing_request_id, from);
  if (!ctx.request || !ctx.authorised) {
    dbService.clearPendingAgentAction(from);
    return { handled: false };
  }
  dbService.clearPendingAgentAction(from);
  const result = await recordAgentOutcome({ ...ctx, outcome, sendAgentAck: from });
  return { handled: true, ...result };
}

// --- dashboard ------------------------------------------------------------------

/**
 * "Visite effectuée" / "Pas eu lieu" from /compte/agent/visites. Authorised by
 * agents.id exactly as respondFromDashboard is: the reassigned agent once
 * `reassigned_at` is set, otherwise the listing's agent or the agent stamped at
 * notify time.
 */
async function completeFromDashboard({ viewingRequestId, agentId, outcome, now = new Date() }) {
  if (!dbService.AGENT_VISIT_OUTCOMES.includes(outcome)) return { ok: false, reason: 'invalid-outcome' };
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { ok: false, reason: 'unknown-request' };
  const propertyId = request.property_id;
  let listing = null;
  if (propertyId) {
    try {
      listing = await propertyRepository.getListingContactById(propertyId);
    } catch (err) {
      console.error(`[visit-receipt] listing #${propertyId} lookup failed: ${err.message}`);
    }
  }
  const claimant = agentId == null ? '' : String(agentId);
  const stamped = request.agent_id == null ? '' : String(request.agent_id);
  const listingAgent = listing?.agent_id == null ? '' : String(listing.agent_id);
  const authorised = Boolean(claimant) && (request.reassigned_at ? stamped === claimant : listingAgent === claimant || stamped === claimant);
  if (!authorised) return { ok: false, reason: 'not-this-requests-agent' };
  if (listing && request.reassigned_at && request.agent_id) {
    const assigned = await propertyRepository.getAgentContactById(request.agent_id).catch(() => null);
    if (assigned) listing = viewing.withAgent(listing, assigned);
  }
  return recordAgentOutcome({ request, listing, propertyId, outcome, now });
}

// --- the sweep ------------------------------------------------------------------

async function runVisitDoneSweep(now = new Date()) {
  const due = dbService.listVisitsToAskAgentDone(
    new Date(now.getTime() - ASK_AFTER_MS).toISOString(),
    new Date(now.getTime() - ASK_WINDOW_MS).toISOString(),
  );
  let asked = 0;
  for (const request of due) {
    // Stamped first: whatever happens below, this request is asked once.
    dbService.markAgentDoneAsked(request.id, now.toISOString());
    let listing = null;
    try {
      listing = await propertyRepository.getListingContactById(request.property_id);
      if (listing && request.reassigned_at && request.agent_id) {
        const assigned = await propertyRepository.getAgentContactById(request.agent_id);
        if (assigned) listing = viewing.withAgent(listing, assigned);
      }
    } catch (err) {
      console.error(`[visit-receipt] listing #${request.property_id} lookup failed: ${err.message}`);
    }
    const blocker = listing ? propertyRepository.directRoutingBlocker(listing) : 'listing introuvable';
    if (blocker) {
      console.warn(`[visit-receipt] request #${request.id}: agent not asked — ${blocker}`);
      continue;
    }
    const agentWa = String(listing.agent_phone).replace(/\D/g, '');
    const ok = await viewing.sendWithButtons(agentWa, askText(listing, request), visitDoneButtons(request.id), 'visit done ask');
    // A typed OUI / NON resolves only when this is the number's one open
    // question; never displace a question the agent still owes.
    if (ok && !dbService.hasOpenAgentQuestion(agentWa)) {
      dbService.setPendingAgentAction({ waId: agentWa, kind: PENDING_KIND, viewingRequestId: request.id });
    }
    if (ok) asked += 1;
  }
  if (due.length) console.log(`[visit-receipt] sweep: ${asked}/${due.length} agent(s) asked`);
  return { due: due.length, asked };
}

const visitDoneJob = {
  name: 'viewing-agent-done',
  shouldRun: (now = new Date()) =>
    dbService.listVisitsToAskAgentDone(
      new Date(now.getTime() - ASK_AFTER_MS).toISOString(),
      new Date(now.getTime() - ASK_WINDOW_MS).toISOString(),
    ).length > 0,
  run: () => runVisitDoneSweep(),
};

module.exports = {
  parseVisitDoneButtonId,
  parseVisitDoneText,
  visitDoneButtons,
  askText,
  receiptText,
  agentAckText,
  recordAgentOutcome,
  handleVisitDoneButtonReply,
  handleVisitDoneTextReply,
  completeFromDashboard,
  runVisitDoneSweep,
  visitDoneJob,
  PENDING_KIND,
  ASK_AFTER_MS,
  ASK_WINDOW_MS,
};
