/**
 * services/viewingNotifications.js
 *
 * The outbound half of a viewing request.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both paths that create a `viewing_requests` row — the public "Demander une
 * visite" form (routes/admin.js's POST /viewing-requests) and the WhatsApp
 * buyer assistant's `request_viewing` tool (services/openai.js) — wrote the
 * row and stopped there. Nothing anywhere sent a message. Meanwhile the
 * listing page tells the visitor, in as many words, "votre demande de visite
 * a été envoyée — l'agent vous répondra sur WhatsApp." Confirmed against
 * production: viewing_requests #1..#3 all exist with correct data and not one
 * outbound send was ever attempted for any of them. This module is that
 * missing send.
 *
 * It is NOT services/leadDispatch.js and must not become it. Dispatch answers
 * "who might have a property like this?" and pushes to seven ranked agencies.
 * A viewing request names one specific listing; the only people it concerns
 * are that listing's own agent and Lukka Place's own desk. Broadcasting it to
 * competing agencies would be the wrong message to the wrong people.
 *
 * FAILURE POSTURE
 * Best-effort, exactly like dispatchLead: the row is the transaction that
 * matters and already committed before this runs. Every send is independently
 * try/caught and the function never throws into its caller.
 *
 * DELIVERY, HONESTLY
 * A free-form WhatsApp message only reaches somebody who messaged this
 * business number in the last 24 hours. An agent who has not is only
 * reachable through an approved template, and none is approved for this
 * yet — see VIEWING_REQUEST_TEMPLATE below. So a send logged as "sent" here
 * means Chakra accepted it, which is not the same as delivered; the log line
 * says which channel was used so the two stay distinguishable.
 */

const chakra = require('./chakra');
const propertyRepository = require('./propertyRepository');
const propertyMatchingService = require('./propertyMatching');
const { parseFrenchSlot, formatSlotFr } = require('./visitSchedule');
const priceExtraction = require('./priceExtraction');
const agentPerformance = require('./agentPerformance');

/** properties.price_source for a figure an agent gave us on WhatsApp. */
const PRICE_SOURCE_WHATSAPP = 'WHATSAPP_AGENT_REPLY';

/**
 * Template name as approved in Meta's WhatsApp Manager — env-driven for the
 * same reason AGENT_LEAD_MATCH_TEMPLATE and AGENT_OTP_TEMPLATE are.
 *
 * Deliberately UNSET by default, unlike those two. They each default to a
 * name and then discover at send time that Meta has never heard of it
 * (`(#132001) Template name does not exist in the translation`, logged in
 * production on 2026-09-08 and 2026-09-10), which costs a guaranteed-failing
 * API round trip on every single send. Until somebody actually approves a
 * template and sets this variable, going straight to the session message is
 * both faster and a truer description of what we can do.
 */
const TEMPLATE_NAME = process.env.VIEWING_REQUEST_TEMPLATE || null;
const TEMPLATE_LANG = process.env.VIEWING_REQUEST_TEMPLATE_LANG || 'fr';

/**
 * Lukka Place's own desk, copied on every viewing request so a request
 * against a listing with no attributed agent still reaches a human.
 *
 * No default. The obvious candidate is the central number in
 * NEXT_PUBLIC_WHATSAPP_NUMBER, and it is the wrong one: that IS this
 * engine's own WhatsApp sender, and a WABA number cannot message itself.
 * This has to be a real person's handset, so it is configured or it is
 * skipped — never guessed.
 *
 * Read at CALL TIME, not module load. It used to be a module-level const,
 * which meant pointing ops at a different handset — the on-call phone
 * changing, a number being corrected after a missed request — needed a full
 * `pm2 restart lukka-place-engine --update-env` rather than an env edit. Same
 * reasoning, and the same shape, as web/lib/otpBypass.js's otpBypassEnabled().
 */
function opsNumber() {
  return (process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '') || null;
}

/**
 * Said once at boot, because the alternative is finding out at 2am.
 *
 * Before this, an unset ops number announced itself only at the moment a
 * request ALSO failed to reach an agent — so a perfectly healthy-looking
 * deployment could be silently dropping the desk copy of every viewing
 * request, every decline survey and every closing price, and nothing said so
 * until the one case where both ends failed at once.
 */
function warnIfOpsUnconfigured() {
  if (opsNumber()) return false;
  console.warn(
    '[viewing] OPS_WHATSAPP_NUMBER is unset — nobody receives the desk copy of a viewing '
      + 'request, the decline survey or a captured closing price. A request on a listing with '
      + 'no verified agent will reach NOBODY.',
  );
  return true;
}

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

function listingLink(listing, propertyId) {
  return listing?.slug ? `${SITE_URL}/listings/${listing.slug}` : `${SITE_URL}/listings/${propertyId}`;
}

/** Where the agent acts on it: their own dashboard's Visit Scheduler. */
function schedulerLink() {
  return `${SITE_URL}/compte/agent/visites`;
}

/**
 * What the listing is called in a message. `title` is already a full human
 * sentence ("2 chambres — Appartement à louer à Lingwala"), so it wins; the
 * reference and the bare id are the honest fallbacks when it is missing.
 */
function listingLabel(listing, propertyId) {
  if (listing?.title) return listing.title;
  if (listing?.reference) return `Réf: ${listing.reference}`;
  return `bien #${propertyId}`;
}

/**
 * "+243 82 112 29 37" is what a person dials; `243821122937` is what we
 * store. Printed with a leading '+' so the recipient can tap it.
 */
function displayPhone(waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'numéro inconnu';
}

/**
 * The one header every message from this module opens with, so a recipient
 * reads it as a Lukka Place system alert rather than a stranger's WhatsApp.
 *
 * It is the first line, not a signature at the bottom, because WhatsApp's
 * notification preview and chat list only ever show the opening characters —
 * branding below the fold is branding nobody sees before deciding whether to
 * open the message.
 */
/** The stamp on every message this module sends, agent- or customer-facing. */
const HEADER_BRAND = '🏠 [Lukka Place]';

const HEADER = `${HEADER_BRAND} Demande de visite`;

/**
 * The agent alert. Every fact the agent needs to answer yes or no is above
 * the fold — including the client's real phone number, so an agent who would
 * rather just call can, without opening anything.
 */
function agentMessage({ listing, lead, viewingRequest, propertyId }) {
  const lines = [
    HEADER,
    `📍 Bien: ${listingLabel(listing, propertyId)}`,
    `👤 Client: ${lead?.name || 'Non précisé'} (${displayPhone(lead?.wa_id)})`,
    `📅 Date souhaitée: ${viewingRequest?.requested_time || 'Non précisée'}`,
  ];
  if (listing?.commune) lines.push(`🗺️ Commune: ${listing.commune}`);
  lines.push('', listingLink(listing, propertyId));
  return lines.join('\n');
}

/**
 * The three response options, as tappable reply buttons.
 *
 * The id is the only part that carries meaning — it comes back verbatim on
 * the inbound webhook as `interactive.button_reply.id`, which is why it
 * embeds the request id rather than relying on "the most recent request from
 * this agent". An agent holding two open requests must be able to answer the
 * older one, and a tap that arrives a day late must still resolve to the
 * right row.
 *
 * Titles are within WhatsApp's 20-character limit (chakra.js enforces it).
 */
function viewingButtons(viewingRequestId) {
  return [
    { id: `${BUTTON_PREFIX.accept}:${viewingRequestId}`, title: '✅ Accepter' },
    { id: `${BUTTON_PREFIX.reschedule}:${viewingRequestId}`, title: '🕒 Autre créneau' },
    { id: `${BUTTON_PREFIX.decline}:${viewingRequestId}`, title: '❌ Décliner' },
  ];
}

const BUTTON_PREFIX = {
  accept: 'viewing_accept',
  reschedule: 'viewing_reschedule',
  decline: 'viewing_decline',
  // Confirming the concrete slot, once the agent has accepted.
  slotOk: 'viewing_slot_ok',
  slotEdit: 'viewing_slot_edit',
};

/**
 * "Is this the right time?", asked only when we could parse a real slot out
 * of what the customer wrote.
 *
 * One tap in the common case. The alternative — making every agent type a
 * date after every accept — puts a mandatory round trip on the single action
 * we most want them to complete, and an agent who abandons it leaves the
 * check-in with nothing to fire from.
 */
function slotConfirmButtons(viewingRequestId) {
  return [
    { id: `${BUTTON_PREFIX.slotOk}:${viewingRequestId}`, title: '✅ Confirmer' },
    { id: `${BUTTON_PREFIX.slotEdit}:${viewingRequestId}`, title: '✏️ Autre heure' },
  ];
}

/**
 * The same three options written out, for when buttons aren't available.
 *
 * Not decoration. Two separate things can take the buttons away: this
 * account's Chakra plan may not forward interactive payloads at all (not
 * something this repo can assert either way), and an agent on a client that
 * renders them poorly still has to be able to answer. Everything downstream
 * accepts a typed "1"/"2"/"3" exactly as it accepts a tap, so the loop
 * closes either way.
 */
function buttonFallbackText() {
  return [
    '',
    'Répondez :',
    '1️⃣ Accepter',
    '2️⃣ Proposer un autre créneau',
    '3️⃣ Décliner',
  ].join('\n');
}

/**
 * The desk copy. Says out loud whether the agent was reached, because that
 * is the single thing whoever reads it needs to decide whether to act: an
 * unattributed listing means nobody else was told.
 */
function opsMessage({ listing, lead, viewingRequest, propertyId, agentNotified, agentSkipReason }) {
  const lines = [
    HEADER,
    '',
    `• Bien : ${listingLabel(listing, propertyId)} (#${propertyId})`,
  ];
  if (listing?.commune) lines.push(`• Commune : ${listing.commune}`);
  lines.push(`• Client : ${lead?.name || 'Non précisé'} (${displayPhone(lead?.wa_id)})`);
  if (viewingRequest?.requested_time) lines.push(`• Créneau souhaité : ${viewingRequest.requested_time}`);
  lines.push(
    '',
    agentNotified
      ? `Agent prévenu : ${listing?.agent_name || `#${listing?.agent_id}`}`
      : `⚠️ Agent NON prévenu (${agentSkipReason}) — à traiter manuellement.`,
    listingLink(listing, propertyId),
  );
  return lines.join('\n');
}

/**
 * Template-first only when a template name is actually configured; session
 * message otherwise, and as the fallback either way. Mirrors
 * leadDispatch.js's posture — a template failure is far more often "not
 * approved yet" than "this number is unreachable".
 *
 * @returns {Promise<'template'|'session'>} the channel that was accepted.
 */
async function send(phone, text, templateParams, buttons = null) {
  if (TEMPLATE_NAME && templateParams) {
    try {
      await chakra.sendTemplate(phone, TEMPLATE_NAME, {
        languageCode: TEMPLATE_LANG,
        bodyParams: templateParams,
      });
      return 'template';
    } catch (templateErr) {
      console.warn(
        `[viewing] template '${TEMPLATE_NAME}' failed for ${phone}, falling back to a session message: ${templateErr.message}`,
      );
    }
  }

  if (buttons) {
    try {
      await chakra.sendInteractiveButtons(phone, text, buttons);
      return 'buttons';
    } catch (buttonErr) {
      // Falls through to the numbered text, which every handler accepts.
      console.warn(
        `[viewing] interactive buttons failed for ${phone}, falling back to a numbered text: ${buttonErr.message}`,
      );
      await chakra.sendWhatsAppMessage(phone, `${text}\n${buttonFallbackText()}`, { previewUrl: true });
      return 'session-numbered';
    }
  }

  await chakra.sendWhatsAppMessage(phone, text, { previewUrl: true });
  return 'session';
}

/**
 * Tell the listing's agent — and Lukka Place's desk — that somebody asked to
 * visit. Safe to await or to fire and forget; never throws.
 *
 * @param {Object} params
 * @param {Object} params.viewingRequest A real `viewing_requests` row.
 * @param {Object} params.lead           Its parent `leads` row (carries wa_id + name).
 * @param {number|string} [params.propertyId] Defaults to the row's own property_id.
 * @returns {Promise<{agentNotified: boolean, opsNotified: boolean, reason?: string}>}
 */
async function notifyViewingRequest({
  viewingRequest,
  lead,
  propertyId,
  // Admin overrides (reassign / nudge) — see reassignViewing and
  // nudgeViewingAgent below. A normal creation passes none of these.
  agentOverride = null,
  notifyOpsCopy = true,
  recordRouting = true,
  reassign = false,
} = {}) {
  const id = propertyId ?? viewingRequest?.property_id ?? null;

  // A viewing request with no property is the assistant's "I'd like to see
  // something" before a listing was chosen. There is no agent to tell.
  if (!id) {
    console.log(`[viewing] request #${viewingRequest?.id} has no property — nobody to notify`);
    return { agentNotified: false, opsNotified: false, reason: 'no-property' };
  }

  // getListingContactById catches its own query errors and returns null, but
  // the pool it builds first can throw outside that try (a malformed DB_HOST,
  // say). This function promises never to throw, so the lookup is guarded
  // here too rather than trusting the callee's internal posture — caught by
  // scripts/verify-pipeline.js §20, which stubs a throwing lookup.
  let listing = null;
  try {
    listing = await propertyRepository.getListingContactById(id);
  } catch (err) {
    console.error(`[viewing] listing lookup for property #${id} failed: ${err.message}`);
  }

  // An admin-chosen agent stands in for the listing's own one.
  if (listing && agentOverride) listing = withAgent(listing, agentOverride);

  // Same gate as services/postgres.js's resolveAgentId and
  // agentOnboarding's identifySender, for the same reason: an unverified
  // number is a claim somebody typed, not a confirmed destination. Plus the
  // team's direct-routing switch — see propertyRepository.directRoutingBlocker.
  let agentSkipReason = null;
  if (!listing) agentSkipReason = 'listing introuvable ou non approuvée';
  else agentSkipReason = propertyRepository.directRoutingBlocker(listing);

  let agentNotified = false;
  if (!agentSkipReason) {
    try {
      const channel = await send(
        String(listing.agent_phone).replace(/\D/g, ''),
        agentMessage({ listing, lead, viewingRequest, propertyId: id }),
        [
          listing.agent_name || 'Agent',
          listingLabel(listing, id),
          lead?.name || 'Non précisé',
          viewingRequest?.requested_time || 'Non précisé',
          schedulerLink(),
        ],
        viewingRequest?.id ? viewingButtons(viewingRequest.id) : null,
      );
      agentNotified = true;
      // A tapped button carries the request id; a typed "1" does not. When
      // the buttons didn't go out, claim this agent's next message for this
      // specific request so the numbered reply still resolves.
      if (channel === 'session-numbered' && viewingRequest?.id) {
        dbService.setPendingAgentAction({
          waId: String(listing.agent_phone).replace(/\D/g, ''),
          kind: PENDING_KINDS.viewingResponse,
          viewingRequestId: viewingRequest.id,
        });
      }
      console.log(
        `[viewing] request #${viewingRequest?.id} (property #${id}) -> agent #${listing.agent_id} accepted via ${channel}`,
      );
    } catch (err) {
      agentSkipReason = `échec de l'envoi : ${err.message}`;
      console.error(`[viewing] notifying agent #${listing.agent_id} for request #${viewingRequest?.id} failed: ${err.message}`);
    }
  } else {
    console.warn(`[viewing] request #${viewingRequest?.id} (property #${id}) — agent not notified: ${agentSkipReason}`);
  }

  // Which path this request actually took — the fact /admin/viewings filters
  // on. Recorded from what happened, not from what the listing page offered:
  // a verified agent whose alert failed to send is CENTRAL_FALLBACK.
  const routingType = agentNotified ? 'DIRECT_WA' : 'CENTRAL_FALLBACK';
  if (viewingRequest?.id) {
    if (recordRouting) {
      try {
        dbService.setViewingRouting(viewingRequest.id, {
          agentId: listing?.agent_id ?? null,
          routingType,
          commune: listing?.commune ?? null,
        });
      } catch (err) {
        console.error(`[viewing] routing record for request #${viewingRequest.id} failed: ${err.message}`);
      }
    }
    if (agentNotified) {
      await agentPerformance.logLeadDispatched({
        agentId: listing.agent_id,
        listingId: id,
        viewingRequestId: viewingRequest.id,
        // A reassigned agent's clock starts now, not at the original request.
        leadTimestamp: reassign ? new Date().toISOString() : viewingRequest.created_at,
        reassign,
      });
    }
  }

  let opsNotified = false;
  const ops = notifyOpsCopy ? opsNumber() : null;
  if (ops) {
    try {
      await chakra.sendWhatsAppMessage(
        ops,
        opsMessage({ listing, lead, viewingRequest, propertyId: id, agentNotified, agentSkipReason }),
        { previewUrl: true },
      );
      opsNotified = true;
    } catch (err) {
      console.error(`[viewing] ops copy for request #${viewingRequest?.id} failed: ${err.message}`);
    }
  } else if (!agentNotified && notifyOpsCopy) {
    // The one combination where a request reaches nobody at all. Worth a
    // louder line than the per-recipient warnings above, because it is the
    // state the visitor's "l'agent vous répondra" is silently false in.
    console.error(
      `[viewing] request #${viewingRequest?.id} (property #${id}) reached NOBODY — ` +
        `no agent (${agentSkipReason}) and OPS_WHATSAPP_NUMBER is unset`,
    );
  }

  return { agentNotified, opsNotified, routingType, reason: agentSkipReason || undefined };
}

/** The listing row with a different agent's contact fields laid over it. */
function withAgent(listing, agent) {
  return {
    ...listing,
    agent_id: agent?.agent_id ?? null,
    agent_phone: agent?.agent_phone ?? null,
    phone_verified_at: agent?.phone_verified_at ?? null,
    direct_routing_enabled: agent?.direct_routing_enabled,
    agent_name: agent?.agent_name ?? null,
  };
}

/**
 * Admin override: hand a viewing request to a different, verified agent and
 * alert them with the same three buttons.
 *
 * The chosen agent has to pass the same directRoutingBlocker gate as any
 * automatic alert — an admin picking a name from a list is not proof that the
 * person holds the number, and messaging an unverified one would tell a
 * stranger who wants to visit a property.
 *
 * @returns {Promise<{ok: boolean, reason?: string, agentNotified?: boolean}>}
 */
async function reassignViewing(viewingRequestId, agentId) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { ok: false, reason: 'unknown-request' };
  if (!request.property_id) return { ok: false, reason: 'no-property' };

  let agent = null;
  try {
    agent = await propertyRepository.getAgentContactById(agentId);
  } catch (err) {
    console.error(`[viewing] reassign lookup for agent #${agentId} failed: ${err.message}`);
  }
  const blocker = agent ? propertyRepository.directRoutingBlocker(agent) : 'agent introuvable';
  if (blocker) return { ok: false, reason: blocker };

  dbService.reassignViewingRequest(request.id, agent.agent_id);
  const updated = dbService.getViewingRequestWithLead(request.id);
  const result = await notifyViewingRequest({
    viewingRequest: updated,
    lead: dbService.getLead(updated.lead_row_id),
    agentOverride: agent,
    recordRouting: false,
    reassign: true,
  });
  console.log(
    `[viewing] request #${request.id} REASSIGNED to agent #${agent.agent_id} — notified: ${result.agentNotified}`,
  );
  return { ok: true, agentId: agent.agent_id, agentNotified: result.agentNotified, reason: result.reason };
}

/**
 * Re-engagement ping: send the current agent the alert again, buttons and
 * all. Agent only — ops already has the desk copy, and a nudge that also
 * re-pinged ops would train them to ignore the channel.
 */
async function nudgeViewingAgent(viewingRequestId) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { ok: false, reason: 'unknown-request' };
  if (!request.property_id) return { ok: false, reason: 'no-property' };

  let agentOverride = null;
  if (request.reassigned_at && request.agent_id) {
    agentOverride = await propertyRepository.getAgentContactById(request.agent_id).catch(() => null);
    if (!agentOverride) return { ok: false, reason: 'agent introuvable' };
  }
  const result = await notifyViewingRequest({
    viewingRequest: request,
    lead: dbService.getLead(request.lead_row_id),
    agentOverride,
    notifyOpsCopy: false,
    recordRouting: false,
  });
  return { ok: result.agentNotified, agentNotified: result.agentNotified, reason: result.reason };
}

/**
 * Fire-and-forget wrapper for the two creation paths, same shape and same
 * reasoning as leadDispatch.js's dispatchLeadInBackground: the row is
 * committed first, and a slow or failing WhatsApp API must never hold open
 * the response the visitor is waiting on.
 */
function notifyViewingRequestInBackground(params) {
  setImmediate(() => {
    notifyViewingRequest(params).catch((err) => {
      console.error(`[viewing] unhandled failure for request #${params?.viewingRequest?.id}: ${err.message}`);
    });
  });
}


// ===========================================================================
// THE AGENT FEEDBACK LOOP
//
// Everything above sends the agent one alert. Everything below handles what
// they do with it: accept, propose another slot, or decline — and, when they
// decline because the property is gone, capture the closing price and get the
// customer three real alternatives instead of a dead end.
//
// TWO WAYS IN, ONE SET OF HANDLERS
// A tapped button arrives as `interactive.button_reply.id` and carries the
// request id inside it. A typed "1" does not, so the numbered fallback claims
// the sender's next message via db.setPendingAgentAction — the same mechanism
// the survey and the reschedule prompt use. Either route ends in the same
// three functions, so nothing has to care which one the agent used.
//
// AUTHORISATION
// A button id is a guessable string (`viewing_accept:3`). Every handler
// re-resolves the listing's real agent from Postgres and refuses a sender who
// isn't them, so a stranger cannot confirm, reschedule or kill somebody
// else's viewing by typing an id. The pending-action path is safe by
// construction — the row is keyed by the wa_id we sent the question to.
// ===========================================================================

const dbService = require('./db');

/** Pending-question kinds. See services/db.js's pending_agent_actions table. */
const PENDING_KINDS = {
  viewingResponse: 'VIEWING_RESPONSE',
  declineReason: 'DECLINE_REASON',
  reschedule: 'RESCHEDULE_TIME',
  closingPrice: 'CLOSING_PRICE',
  // A figure read out of a sentence (or by the model) and read back to the
  // agent; pending_agent_actions.amount holds it until they say OUI.
  closingPriceConfirm: 'CLOSING_PRICE_CONFIRM',
  // Asked after an accept when the customer's wording carried no parseable
  // slot ("je suis disponible cette semaine"), so the check-in has a real
  // instant to count from rather than a guess.
  scheduleTime: 'SCHEDULE_TIME',
};

const DECLINE_REASONS = {
  1: 'Bien déjà loué / vendu',
  2: 'Non disponible aux dates demandées',
  3: 'Autre raison',
};

/**
 * The survey answers as viewing_requests.decline_reason_code. The agent's
 * three options stay as they are; PRICE_TOO_HIGH / LOCATION_DESELECTED /
 * TERMS_UNACCEPTABLE are customer reasons and are collected from the customer
 * (services/viewingSweeps.js), never put in an agent's mouth.
 */
const AGENT_DECLINE_REASON_CODES = {
  1: 'PROPERTY_NO_LONGER_AVAILABLE',
  2: 'OTHER',
  3: 'OTHER',
};

/** Strip accents and case so "déjà loué" and "deja loue" match alike. */
function fold(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * `viewing_accept:3` -> { action: 'accept', viewingRequestId: 3 }.
 * Anything else is null, so an unrelated button from some other feature is
 * left alone rather than swallowed.
 */
function parseViewingButtonId(replyId) {
  const match = /^viewing_(accept|reschedule|decline|slot_ok|slot_edit):(\d+)$/.exec(
    String(replyId || '').trim(),
  );
  if (!match) return null;
  return { action: match[1], viewingRequestId: Number.parseInt(match[2], 10) };
}

/**
 * A typed answer to a numbered question: "1", "1.", "1️⃣", "un", and the
 * words themselves.
 *
 * Returns null for anything else ON PURPOSE — every caller then falls through
 * and lets the message be processed normally, exactly as the sale-price
 * follow-up in routes/webhook.js does ("Anything else is not an answer to our
 * question"). Swallowing an unrecognised reply would turn a real listing into
 * a lost message.
 */
function parseNumberedChoice(text) {
  const raw = fold(text)
    // 1️⃣ is U+0031 U+FE0F U+20E3 — drop the variation selector and the
    // keycap so it folds down to a plain "1".
    .replace(/[️⃣]/g, '')
    .replace(/[.)\]]+$/, '')
    .trim();
  if (/^[123]$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^(un|one)$/.test(raw)) return 1;
  if (/^(deux|two)$/.test(raw)) return 2;
  if (/^(trois|three)$/.test(raw)) return 3;
  return null;
}

/**
 * The decline survey's own answer parser, accepting the words an agent
 * actually types instead of the digit we asked for.
 *
 * Ordered most-specific-first: "pas disponible" must not be read as reason 1
 * just because it contains no "loue", and "deja loue" must win over a bare
 * "autre" appearing later in the same sentence.
 */
function parseDeclineReason(text) {
  const numbered = parseNumberedChoice(text);
  if (numbered) return numbered;

  const raw = fold(text);
  if (!raw) return null;
  if (/\b(deja\s+)?(loue|louee|vendu|vendue|pris|prise|occupe|occupee)\b/.test(raw)) return 1;
  if (/(pas|non|plus)\s+(dispo|disponible)|indisponible|autre\s+date|pas\s+libre/.test(raw)) return 2;
  if (/^autre/.test(raw) || /autre\s+raison/.test(raw)) return 3;
  return null;
}

/**
 * "700$", "700 $", "1 200", "1.200 USD" -> a positive integer.
 *
 * Deliberately duplicated from routes/webhook.js's parseSalePrice rather than
 * imported: that module requires this one, so importing back would be a
 * require cycle. The two must stay in agreement — change one, change the
 * other. Same rule the geocoding landmark check documents for its own
 * duplicate in scripts/geocode-listings.js.
 */
function parseClosingPrice(text) {
  const raw = String(text || '').trim();
  const match = /^([\d][\d\s.,]*)\s*(?:\$|usd|dollars?)?$/i.exec(raw);
  if (!match) return null;
  const digits = match[1].replace(/[\s.,]/g, '');
  if (!digits) return null;
  const amount = Number.parseInt(digits, 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** "passer", "non", "skip" — declining to state the closing price. */
function isPriceDeclined(text) {
  return /^(?:passer?|non|no|skip|prefere?\s*pas|pas\s*maintenant)[\s!.]*$/.test(fold(text));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const DECLINE_SURVEY_TEXT = [
  `${HEADER_BRAND} Merci. Pour nous aider à garder le site à jour :`,
  '',
  'Pourquoi déclinez-vous cette visite ?',
  '1️⃣ Bien déjà loué / vendu',
  '2️⃣ Non disponible aux dates demandées',
  '3️⃣ Autre raison',
].join('\n');

const CLOSING_PRICE_ASK =
  '📊 Super ! Quel a été le prix final conclu (en USD) ? (Exemple: 700)\n\n' +
  'Répondez _passer_ si vous préférez ne pas le communiquer.';

const CLOSING_PRICE_THANKS = `${HEADER_BRAND} Merci, la transaction est enregistrée. 🎉`;

const CLOSING_PRICE_USD_ONLY =
  `${HEADER_BRAND} Merci ! Pouvez-vous nous donner le montant en dollars (USD) ? (Exemple: 700)`;

const CLOSING_PRICE_REASK =
  `${HEADER_BRAND} D'accord — quel a été le montant exact conclu, en USD ? (Exemple: 700)`;

/** A figure we read out of a sentence, read back before anything is written. */
function closingPriceConfirmText(amount) {
  return [
    `${HEADER_BRAND} Nous avons compris : ${priceExtraction.formatUsd(amount)}.`,
    '',
    'Répondez *OUI* pour confirmer, ou envoyez le bon montant.',
  ].join('\n');
}

/** The receipt: the figure, and — when the listing had an asking price — the real gap. */
function closingPriceThanksText(amount, listPrice, delta) {
  const lines = [CLOSING_PRICE_THANKS, `💰 Prix conclu : ${priceExtraction.formatUsd(amount)}`];
  if (listPrice != null && delta?.deltaPct != null) {
    lines.push(
      `🏷️ Prix affiché : ${priceExtraction.formatUsd(listPrice)} (écart : ${priceExtraction.formatPct(delta.deltaPct)})`,
    );
  }
  return lines.join('\n');
}
const CLOSING_PRICE_SKIPPED =
  `${HEADER_BRAND} Très bien — le bien reste retiré des recherches. Merci de nous avoir prévenus ! 🙌`;
const RESCHEDULE_ASK =
  `${HEADER_BRAND} Quel créneau proposez-vous ? Répondez avec la date et l'heure ` +
  "(ex. _samedi 14h_) et nous le transmettons au client.";
const DECLINE_THANKS = `${HEADER_BRAND} C'est noté, merci de votre réponse. 🙏`;
const SCHEDULE_ASK =
  `${HEADER_BRAND} À quelle date et à quelle heure exactement ? ` +
  'Répondez par exemple _demain 14h_ ou _samedi matin_.';

/** The parsed slot, read back for a one-tap confirmation. */
function slotConfirmText(iso) {
  return [
    `${HEADER_BRAND} Confirmons l'heure`,
    '',
    // Always the full date, never "demain" — this message can be read a day
    // after it was sent, and "demain" would then confirm the wrong day.
    `📅 ${formatSlotFr(iso) || iso}`,
    '',
    "C'est bien cela ?",
  ].join('\n');
}

function slotAgreedText(iso) {
  return [
    `${HEADER_BRAND} Créneau enregistré ✅`,
    `📅 ${formatSlotFr(iso) || iso}`,
    '',
    'Nous demanderons au client comment la visite s\'est passée juste après.',
  ].join('\n');
}

/** The agent's own confirmation that their tap registered. */
function acceptedAgentText(listing, viewingRequest, propertyId) {
  return [
    `${HEADER_BRAND} Visite confirmée ✅`,
    `📍 ${listingLabel(listing, propertyId)}`,
    `📅 ${viewingRequest?.requested_time || 'Créneau à convenir'}`,
    '',
    'Le client vient d\'être prévenu sur WhatsApp.',
    schedulerLink(),
  ].join('\n');
}

function tenantAcceptedText(listing, viewingRequest, propertyId) {
  const label = listing?.reference ? `Réf: ${listing.reference}` : listingLabel(listing, propertyId);
  const lines = [
    `${HEADER_BRAND} Bonne nouvelle !`,
    '',
    `L'agent a confirmé votre visite pour ${label}.`,
  ];
  if (viewingRequest?.requested_time) lines.push(`📅 Créneau : ${viewingRequest.requested_time}`);
  if (listing?.agent_name) lines.push(`👤 Agent : ${listing.agent_name}`);
  if (listing?.agent_phone) lines.push(`📞 ${displayPhone(listing.agent_phone)}`);
  lines.push('', listingLink(listing, propertyId));
  return lines.join('\n');
}

function tenantRescheduleText(listing, proposedTime, propertyId) {
  return [
    `${HEADER_BRAND} L'agent propose un autre créneau`,
    '',
    `📍 ${listingLabel(listing, propertyId)}`,
    `📅 Nouvelle proposition : ${proposedTime}`,
    '',
    'Ce créneau vous convient-il ? Répondez à ce message et nous transmettons.',
    listingLink(listing, propertyId),
  ].join('\n');
}

/**
 * The customer's recovery path. Real alternatives or an honest apology —
 * never an empty "here are 3 listings:" followed by nothing.
 */
function tenantAlternativesText(alternatives) {
  const lines = [
    'Bonjour, l\'agent n\'est pas disponible pour ce bien actuellement.',
  ];
  if (alternatives.length) {
    lines.push('', `Voici ${alternatives.length} logement${alternatives.length > 1 ? 's' : ''} similaire${alternatives.length > 1 ? 's' : ''} disponible${alternatives.length > 1 ? 's' : ''} immédiatement à proximité :`, '');
    for (const alt of alternatives) {
      const price = Number.isFinite(Number(alt.price)) ? ` — ${Number(alt.price).toLocaleString('fr-FR')} $` : '';
      lines.push(`📍 ${alt.title || `Bien #${alt.id}`}${price}`);
      lines.push(listingLink(alt, alt.id));
      lines.push('');
    }
  } else {
    lines.push('', "Nous n'avons pas d'équivalent disponible à l'instant, mais nous vous prévenons dès qu'un bien correspondant est publié.");
  }
  lines.push('Répondez à ce message pour affiner votre recherche.');
  return lines.join('\n');
}

/**
 * The customer's side of an agent calling off a visit that was already agreed.
 * No alternatives here, deliberately: that recovery belongs to DECLINED, and
 * cancelling a confirmed visit is a different fact (root CLAUDE.md, "Status
 * vocabulary"). The customer is pointed back to us to re-plan instead.
 */
function tenantCancelledText(listing, viewingRequest, propertyId) {
  const label = listing?.reference ? `Réf: ${listing.reference}` : listingLabel(listing, propertyId);
  const lines = [
    `${HEADER_BRAND} Visite annulée`,
    '',
    `L'agent a dû annuler votre visite pour ${label}.`,
  ];
  if (viewingRequest?.requested_time) lines.push(`📅 Créneau prévu : ${viewingRequest.requested_time}`);
  lines.push(
    '',
    'Répondez à ce message : nous vous aidons à fixer un autre créneau ou à trouver un bien similaire.',
    listingLink(listing, propertyId),
  );
  return lines.join('\n');
}

/**
 * The desk's copy of a decline or cancellation given on the dashboard. Unlike
 * the WhatsApp decline, no reason survey follows, so this is the only moment
 * ops hears about it — and it says plainly whether the customer was reached.
 */
function opsDashboardAnswerText({ listing, viewingRequest, propertyId, status, tenantNotified }) {
  const verdict = status === 'CANCELLED' ? 'Visite annulée' : 'Visite déclinée';
  return [
    `${HEADER_BRAND} ${verdict} depuis le tableau de bord agent`,
    '',
    `📍 ${listingLabel(listing, propertyId)} (#${propertyId})`,
    `📅 ${viewingRequest?.requested_time || 'Créneau non précisé'}`,
    tenantNotified
      ? '✅ Client prévenu sur WhatsApp.'
      : '⚠️ Client NON prévenu — le message n\'a pas pu partir, à recontacter.',
    '',
    `Demande #${viewingRequest?.id}`,
    listingLink(listing, propertyId),
  ].join('\n');
}

function opsDeclineText({ listing, viewingRequest, propertyId, reasonCode, closedPrice, listPrice, delta }) {
  const lines = [
    `${HEADER_BRAND} Visite déclinée`,
    '',
    `📍 ${listingLabel(listing, propertyId)} (#${propertyId})`,
    `Motif : ${DECLINE_REASONS[reasonCode] || 'Non précisé'}`,
  ];
  if (reasonCode === 1) {
    lines.push(
      '',
      closedPrice != null
        ? `💰 Conclu à ${Number(closedPrice).toLocaleString('fr-FR')} $ — annonce retirée des recherches.`
        : "⚠️ L'agent dit le bien déjà loué/vendu, sans prix communiqué.",
    );
    if (closedPrice != null && listPrice != null && delta?.deltaPct != null) {
      lines.push(`🏷️ Affiché ${priceExtraction.formatUsd(listPrice)} — écart ${priceExtraction.formatPct(delta.deltaPct)}`);
    }
    lines.push('👉 À vérifier et archiver sur le storefront.');
  }
  lines.push('', `Demande #${viewingRequest?.id}`, listingLink(listing, propertyId));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

/** Best-effort send that never throws — every handler is fire-and-forget. */
async function trySend(phone, text, label) {
  if (!phone) return false;
  try {
    await chakra.sendWhatsAppMessage(String(phone).replace(/\D/g, ''), text, { previewUrl: true });
    return true;
  } catch (err) {
    console.error(`[viewing] ${label} to ${phone} failed: ${err.message}`);
    return false;
  }
}

/**
 * Buttons where they work, the same question as text where they do not.
 *
 * Whether this account's Chakra plan forwards interactive payloads at all is
 * not something this repo can assert, so nothing is allowed to depend on it.
 * The text fallback asks for the same answer in words, which every handler
 * downstream already accepts — so the loop closes either way.
 */
async function sendWithButtons(phone, text, buttons, label) {
  if (!phone) return false;
  const to = String(phone).replace(/\D/g, '');
  try {
    await chakra.sendInteractiveButtons(to, text, buttons);
    return true;
  } catch (err) {
    console.warn(`[viewing] ${label}: interactive send failed (${err.message}) — falling back to text`);
    return trySend(to, text, label);
  }
}

async function notifyOps(text, label) {
  const ops = opsNumber();
  if (!ops) {
    console.warn(`[viewing] ${label}: OPS_WHATSAPP_NUMBER unset — ops not told`);
    return false;
  }
  return trySend(ops, text, label);
}

/**
 * Resolve the request, its customer and its listing at once, and check the
 * sender is the agent that listing actually belongs to.
 *
 * `authorised` is false rather than throwing so a caller can log a refusal
 * and move on. A request whose listing has no agent is NOT authorised for
 * anybody — an unattributed listing means there is no one whose tap counts.
 */
async function resolveContext(viewingRequestId, from) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { request: null, authorised: false, reason: 'unknown-request' };

  const propertyId = request.property_id;
  let listing = null;
  if (propertyId) {
    try {
      listing = await propertyRepository.getListingContactById(propertyId);
    } catch (err) {
      console.error(`[viewing] context lookup for property #${propertyId} failed: ${err.message}`);
    }
  }

  // Reassigned by an admin: the request now belongs to that agent, and only
  // their taps count — the listing's own agent is no longer authorised on it.
  if (listing && request.reassigned_at && request.agent_id) {
    let assigned = null;
    try {
      assigned = await propertyRepository.getAgentContactById(request.agent_id);
    } catch (err) {
      console.error(`[viewing] assigned agent lookup #${request.agent_id} failed: ${err.message}`);
    }
    listing = withAgent(listing, assigned);
  }

  const senderDigits = String(from || '').replace(/\D/g, '');
  const agentDigits = String(listing?.agent_phone || '').replace(/\D/g, '');
  const authorised = Boolean(agentDigits) && agentDigits === senderDigits;

  return {
    request,
    listing,
    propertyId,
    authorised,
    reason: authorised ? null : 'not-this-listings-agent',
  };
}

// ---------------------------------------------------------------------------
// The three actions
// ---------------------------------------------------------------------------

/**
 * Accepting pins the visit down to a real instant, not just a status.
 *
 * The customer's `requested_time` is free text and stays that way. What the
 * check-in two hours later needs is an actual timestamp, so the accept is
 * where the agent turns "demain matin" into a slot. Two paths:
 *
 *   - parseable ("demain 14h") -> propose it back, one tap to confirm;
 *   - not parseable ("quand vous voulez") -> ask, claiming the agent's next
 *     message.
 *
 * Either way the STATUS is already CONFIRMED and the customer is already
 * told. Scheduling is a refinement on top of an answer that has been given —
 * an agent who ignores the slot question has still accepted the visit, and
 * the customer must not be left waiting on a questionnaire.
 */
/**
 * Stamp the agent's answer for response latency. The SQLite mirror keeps only
 * the first; the Postgres log keeps the first latency and the latest outcome.
 * Never throws — a metrics write must not stop the customer being told.
 */
async function recordAgentResponse(request, outcome, via = 'WHATSAPP') {
  try {
    dbService.recordViewingFirstResponse(request.id);
    dbService.setViewingAgentResponseVia(request.id, via);
  } catch (err) {
    console.error(`[viewing] first-response stamp for #${request.id} failed: ${err.message}`);
  }
  await agentPerformance.logResponse({ viewingRequestId: request.id, outcome });
}

/**
 * Stamp that a customer-facing message about this request left — accepted by
 * Chakra, which is all this repo can know (no delivery receipts). Written from
 * the WhatsApp and dashboard paths alike, so /admin/viewings can tell an
 * answered request whose customer was told from one whose customer was not.
 * Never throws, same posture as recordAgentResponse.
 */
function markCustomerNotified(viewingRequestId) {
  try {
    dbService.markViewingCustomerNotified(viewingRequestId);
  } catch (err) {
    console.error(`[viewing] customer-notified stamp for #${viewingRequestId} failed: ${err.message}`);
  }
}

async function handleAccept({ request, listing, propertyId, from }) {
  dbService.updateViewingRequest(request.id, { status: 'CONFIRMED' });
  await recordAgentResponse(request, 'CONFIRMED');
  dbService.clearPendingAgentAction(from);

  await trySend(from, acceptedAgentText(listing, request, propertyId), 'accept ack');
  const told = await trySend(
    request.lead_wa_id,
    tenantAcceptedText(listing, request, propertyId),
    'accept confirmation',
  );
  if (told) markCustomerNotified(request.id);

  const proposal = parseFrenchSlot(request.requested_time);
  if (proposal) {
    // Stored now so a check-in still fires if the agent never answers the
    // confirmation — it is the customer's own stated time, not an invention.
    dbService.setViewingScheduledAt(request.id, proposal.iso);
    await sendWithButtons(
      from,
      slotConfirmText(proposal.iso),
      slotConfirmButtons(request.id),
      'slot confirm',
    );
  } else {
    dbService.setPendingAgentAction({
      waId: from,
      kind: PENDING_KINDS.scheduleTime,
      viewingRequestId: request.id,
    });
    await trySend(from, SCHEDULE_ASK, 'slot ask');
  }

  console.log(
    `[viewing] request #${request.id} ACCEPTED by agent ${from} — client told: ${told}, ` +
      `slot: ${proposal ? proposal.iso : 'asked'}`,
  );
  return {
    action: 'accept',
    status: 'CONFIRMED',
    tenantNotified: told,
    scheduledAt: proposal ? proposal.iso : null,
    awaiting: proposal ? null : PENDING_KINDS.scheduleTime,
  };
}

/**
 * The agent confirmed the slot we proposed. Nothing to write — handleAccept
 * already stored it — so this is an acknowledgement, which is exactly why it
 * is worth sending: a tap with no visible effect reads as a tap that failed.
 */
async function handleSlotOk({ request, from }) {
  dbService.clearPendingAgentAction(from);
  const when = request.scheduled_at;
  await trySend(from, slotAgreedText(when), 'slot agreed');
  console.log(`[viewing] request #${request.id} slot confirmed by ${from}: ${when}`);
  return { action: 'slot-ok', scheduledAt: when };
}

/** The agent wants a different hour: claim their next message for it. */
async function handleSlotEdit({ request, from }) {
  dbService.setPendingAgentAction({
    waId: from,
    kind: PENDING_KINDS.scheduleTime,
    viewingRequestId: request.id,
  });
  await trySend(from, SCHEDULE_ASK, 'slot re-ask');
  console.log(`[viewing] request #${request.id} slot correction requested by ${from}`);
  return { action: 'slot-edit', awaiting: PENDING_KINDS.scheduleTime };
}

async function handleReschedule({ request, from }) {
  dbService.updateViewingRequest(request.id, { status: 'RESCHEDULED' });
  await recordAgentResponse(request, 'RESCHEDULED');
  // The agent's NEXT message is the slot they are proposing.
  dbService.setPendingAgentAction({
    waId: from,
    kind: PENDING_KINDS.reschedule,
    viewingRequestId: request.id,
  });

  await trySend(from, RESCHEDULE_ASK, 'reschedule prompt');
  console.log(`[viewing] request #${request.id} RESCHEDULE requested by agent ${from} — awaiting a slot`);
  return { action: 'reschedule', status: 'RESCHEDULED', awaiting: PENDING_KINDS.reschedule };
}

async function handleDecline({ request, listing, propertyId, from }) {
  dbService.updateViewingRequest(request.id, { status: 'DECLINED' });
  await recordAgentResponse(request, 'DECLINED');
  dbService.setPendingAgentAction({
    waId: from,
    kind: PENDING_KINDS.declineReason,
    viewingRequestId: request.id,
  });

  // The survey and the customer's recovery run together: the customer should
  // not wait on the agent answering a questionnaire to hear that this
  // particular visit isn't happening.
  await trySend(from, DECLINE_SURVEY_TEXT, 'decline survey');
  const alternatives = await sendAlternativesToTenant({ request, listing, propertyId });

  console.log(
    `[viewing] request #${request.id} DECLINED by agent ${from} — ` +
      `${alternatives.count} alternative(s) sent to the client: ${alternatives.sent}`,
  );
  return { action: 'decline', status: 'DECLINED', alternatives: alternatives.count };
}

/**
 * Three real alternatives for the customer, from the same matching engine the
 * WhatsApp assistant uses — same commune, same transaction type, priced around
 * what they were already looking at, and never the listing just declined.
 */
async function sendAlternativesToTenant({ request, listing, propertyId }) {
  let alternatives = [];
  try {
    const { data } = await propertyMatchingService.matchProperties({
      commune: listing?.commune || undefined,
      limit: 6,
    });
    alternatives = (data || []).filter((row) => String(row.id) !== String(propertyId)).slice(0, 3);
  } catch (err) {
    console.error(`[viewing] alternatives lookup for request #${request.id} failed: ${err.message}`);
  }

  const sent = await trySend(
    request.lead_wa_id,
    tenantAlternativesText(alternatives),
    'decline alternatives',
  );
  if (sent) markCustomerNotified(request.id);
  return { count: alternatives.length, sent };
}

/**
 * What an agent may set from the web dashboard, keyed by the TARGET status,
 * listing the statuses it may come from. web/lib/viewingActions.js carries the
 * same table for the UI (ESM, another app) — change one, change the other.
 */
const DASHBOARD_TRANSITIONS = Object.freeze({
  CONFIRMED: Object.freeze(['PENDING', 'RESCHEDULED']),
  RESCHEDULED: Object.freeze(['PENDING', 'RESCHEDULED', 'CONFIRMED']),
  DECLINED: Object.freeze(['PENDING', 'RESCHEDULED']),
  CANCELLED: Object.freeze(['CONFIRMED']),
});

/**
 * An agent's answer given on the WEB dashboard (the Visites tab) — the twin of
 * the WhatsApp buttons below, reached through
 * POST /admin/viewing-requests/:id/agent-response.
 *
 * Before this the dashboard PATCHed the status and nothing else: the customer
 * who had asked to visit heard nothing, first_response_at stayed NULL (so the
 * admin console's response metrics said the agent never answered), and any
 * WhatsApp question still open about the request stayed answerable.
 *
 * Same customer messages as the WhatsApp path, minus everything addressed to
 * the agent's own phone — they acted on the web, and a WhatsApp questionnaire
 * about an answer they already gave would be noise:
 *   CONFIRMED   tenantAcceptedText; pins scheduled_at from the customer's own
 *               parseable time, exactly as handleAccept does.
 *   RESCHEDULED tenantRescheduleText with the new slot; scheduled_at follows it
 *               and is CLEARED when the phrase names no instant, so a later
 *               confirmation cannot check in against the old slot.
 *   DECLINED    real alternatives to the customer (sendAlternativesToTenant);
 *               ops told, since no decline survey follows.
 *   CANCELLED   only from CONFIRMED; customer and ops told. Not logged as an
 *               agent_performance_logs outcome: that column's CHECK has no
 *               CANCELLED, and the response was already timed at confirmation.
 *
 * Authorisation is by Postgres agents.id — the dashboard session knows the
 * agent's id, not their phone. Once an admin has reassigned the request only
 * the assigned agent counts (the resolveContext rule); otherwise the listing's
 * agent, or the agent_id stamped when the alert went out, which also keeps
 * answering possible while Postgres is unreachable.
 *
 * Repeating the status a request already has is a no-op that sends nothing
 * (RESCHEDULED excepted — a second proposal is a real answer).
 *
 * @returns {Promise<{ok: true, status: string, unchanged: boolean, tenantNotified: boolean, scheduledAt?: string|null, alternatives?: number}
 *   | {ok: false, reason: string, current?: string}>}
 */
async function respondFromDashboard({ viewingRequestId, agentId, status, requestedTime } = {}) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { ok: false, reason: 'unknown-request' };
  if (!Object.prototype.hasOwnProperty.call(DASHBOARD_TRANSITIONS, status)) {
    return { ok: false, reason: 'invalid-status' };
  }

  const propertyId = request.property_id;
  let listing = null;
  if (propertyId) {
    try {
      listing = await propertyRepository.getListingContactById(propertyId);
    } catch (err) {
      console.error(`[viewing] dashboard answer: listing #${propertyId} lookup failed: ${err.message}`);
    }
  }

  const claimant = agentId == null ? '' : String(agentId);
  const stampedAgent = request.agent_id == null ? '' : String(request.agent_id);
  const listingAgent = listing?.agent_id == null ? '' : String(listing.agent_id);
  const authorised = Boolean(claimant) && (
    request.reassigned_at ? stampedAgent === claimant : listingAgent === claimant || stampedAgent === claimant
  );
  if (!authorised) return { ok: false, reason: 'not-this-requests-agent' };

  if (request.status === status && status !== 'RESCHEDULED') {
    return { ok: true, status, unchanged: true, tenantNotified: false };
  }
  if (!DASHBOARD_TRANSITIONS[status].includes(request.status)) {
    return { ok: false, reason: 'invalid-transition', current: request.status };
  }
  const proposed = status === 'RESCHEDULED' ? String(requestedTime || '').trim() : '';
  if (status === 'RESCHEDULED' && !proposed) return { ok: false, reason: 'requested-time-required' };

  // A question still open on WhatsApp about THIS request would otherwise let a
  // "1" typed later re-answer it, and message the customer a contradictory time.
  dbService.clearPendingAgentActionsForViewing(request.id);

  // Reassigned: the customer-facing text names the agent actually handling it.
  if (listing && request.reassigned_at && request.agent_id) {
    try {
      const assigned = await propertyRepository.getAgentContactById(request.agent_id);
      if (assigned) listing = withAgent(listing, assigned);
    } catch (err) {
      console.error(`[viewing] dashboard answer: assigned agent #${request.agent_id} lookup failed: ${err.message}`);
    }
  }

  let tenantNotified = false;
  let alternatives;
  let scheduledAt = request.scheduled_at || null;

  if (status === 'CONFIRMED') {
    dbService.updateViewingRequest(request.id, { status: 'CONFIRMED' });
    await recordAgentResponse(request, 'CONFIRMED', 'DASHBOARD');
    const proposal = parseFrenchSlot(request.requested_time);
    if (proposal) {
      dbService.setViewingScheduledAt(request.id, proposal.iso);
      scheduledAt = proposal.iso;
    }
    tenantNotified = await trySend(
      request.lead_wa_id,
      tenantAcceptedText(listing, request, propertyId),
      'dashboard accept confirmation',
    );
  } else if (status === 'RESCHEDULED') {
    dbService.updateViewingRequest(request.id, { status: 'RESCHEDULED', requestedTime: proposed });
    await recordAgentResponse(request, 'RESCHEDULED', 'DASHBOARD');
    const slot = parseFrenchSlot(proposed);
    scheduledAt = slot ? slot.iso : null;
    dbService.setViewingScheduledAt(request.id, scheduledAt);
    tenantNotified = await trySend(
      request.lead_wa_id,
      tenantRescheduleText(listing, proposed, propertyId),
      'dashboard reschedule proposal',
    );
  } else if (status === 'DECLINED') {
    dbService.updateViewingRequest(request.id, { status: 'DECLINED' });
    await recordAgentResponse(request, 'DECLINED', 'DASHBOARD');
    const sent = await sendAlternativesToTenant({ request, listing, propertyId });
    tenantNotified = sent.sent;
    alternatives = sent.count;
    await notifyOps(
      opsDashboardAnswerText({ listing, viewingRequest: request, propertyId, status, tenantNotified }),
      'dashboard decline ops copy',
    );
  } else {
    dbService.updateViewingRequest(request.id, { status: 'CANCELLED' });
    dbService.setViewingCancelledBy(request.id, 'AGENT');
    try {
      dbService.recordViewingFirstResponse(request.id);
      dbService.setViewingAgentResponseVia(request.id, 'DASHBOARD');
    } catch (err) {
      console.error(`[viewing] response stamp for #${request.id} failed: ${err.message}`);
    }
    tenantNotified = await trySend(
      request.lead_wa_id,
      tenantCancelledText(listing, request, propertyId),
      'dashboard cancellation',
    );
    await notifyOps(
      opsDashboardAnswerText({ listing, viewingRequest: request, propertyId, status, tenantNotified }),
      'dashboard cancellation ops copy',
    );
  }

  // sendAlternativesToTenant stamps its own send; every other branch stamps here.
  if (tenantNotified && status !== 'DECLINED') markCustomerNotified(request.id);

  console.log(
    `[viewing] request #${request.id} ${status} by agent #${claimant} from the dashboard — client told: ${tenantNotified}`,
  );
  return {
    ok: true,
    status,
    unchanged: false,
    tenantNotified,
    scheduledAt,
    ...(alternatives === undefined ? {} : { alternatives }),
  };
}

/**
 * What a CUSTOMER may do to their own viewing request from the Espace Client.
 * The mirror of DASHBOARD_TRANSITIONS, and deliberately smaller:
 *   CANCEL       they changed their plans — from any state still in play.
 *   ACCEPT_SLOT  they take the new time an agent proposed. Until now the only
 *                answer was "reply to this WhatsApp and we pass it on".
 * web/lib/viewingTimeline.js decides which buttons exist from the same rules.
 */
const CUSTOMER_TRANSITIONS = Object.freeze({
  CANCEL: Object.freeze({ from: Object.freeze(['PENDING', 'RESCHEDULED', 'CONFIRMED']), to: 'CANCELLED' }),
  ACCEPT_SLOT: Object.freeze({ from: Object.freeze(['RESCHEDULED']), to: 'CONFIRMED' }),
});

function agentCustomerCancelledText(listing, viewingRequest, propertyId) {
  return [
    `${HEADER_BRAND} Visite annulée par le client`,
    '',
    `📍 ${listingLabel(listing, propertyId)}`,
    `📅 ${viewingRequest?.requested_time || 'Créneau non précisé'}`,
    '',
    "Le client a annulé depuis son Espace Client. Aucune action n'est nécessaire.",
    schedulerLink(),
  ].join('\n');
}

function agentCustomerAcceptedSlotText(listing, viewingRequest, propertyId) {
  return [
    `${HEADER_BRAND} Créneau accepté par le client ✅`,
    '',
    `📍 ${listingLabel(listing, propertyId)}`,
    `📅 ${viewingRequest?.requested_time || 'Créneau à préciser'}`,
    '',
    'La visite est confirmée.',
    schedulerLink(),
  ].join('\n');
}

function opsCustomerAnswerText({ listing, viewingRequest, propertyId, action, agentNotified }) {
  return [
    `${HEADER_BRAND} ${action === 'CANCEL' ? 'Visite annulée' : 'Créneau accepté'} par le client (Espace Client)`,
    '',
    `📍 ${listingLabel(listing, propertyId)} (#${propertyId})`,
    `📅 ${viewingRequest?.requested_time || 'Créneau non précisé'}`,
    agentNotified ? "✅ Agent prévenu sur WhatsApp." : "⚠️ Agent NON prévenu — pas de numéro vérifié ou envoi refusé.",
    '',
    `Demande #${viewingRequest?.id}`,
  ].join('\n');
}

/**
 * A customer's answer from the Espace Client (POST
 * /admin/viewing-requests/:id/customer-response).
 *
 * AUTHORISATION IS THE LEAD'S OWN NUMBER — the customer who asked for the
 * visit, never the listing's agent (that is respondFromDashboard). A request
 * that is not theirs answers exactly like one that does not exist, so a
 * guessed id reveals nothing.
 *
 * The agent and the desk are told; the customer is not messaged on WhatsApp
 * about something they just did on the web.
 */
async function respondFromCustomer({ viewingRequestId, waId, action } = {}) {
  const rule = CUSTOMER_TRANSITIONS[action];
  if (!rule) return { ok: false, reason: 'invalid-action' };

  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  const sender = String(waId || '').replace(/\D/g, '');
  const owner = String(request?.lead_wa_id || '').replace(/\D/g, '');
  if (!request || !owner || owner !== sender) return { ok: false, reason: 'unknown-request' };

  if (request.status === rule.to) {
    return { ok: true, status: rule.to, unchanged: true, agentNotified: false };
  }
  if (!rule.from.includes(request.status)) {
    return { ok: false, reason: 'invalid-transition', current: request.status };
  }

  const propertyId = request.property_id;
  let listing = null;
  if (propertyId) {
    try {
      listing = await propertyRepository.getListingContactById(propertyId);
    } catch (err) {
      console.error(`[viewing] customer answer: listing #${propertyId} lookup failed: ${err.message}`);
    }
  }
  if (listing && request.reassigned_at && request.agent_id) {
    try {
      const assigned = await propertyRepository.getAgentContactById(request.agent_id);
      if (assigned) listing = withAgent(listing, assigned);
    } catch (err) {
      console.error(`[viewing] customer answer: assigned agent #${request.agent_id} lookup failed: ${err.message}`);
    }
  }

  // Nothing still open on WhatsApp may answer this request afterwards.
  dbService.clearPendingAgentActionsForViewing(request.id);
  dbService.clearPendingCustomerActionsForViewing(request.id);

  let agentText;
  if (action === 'CANCEL') {
    dbService.updateViewingRequest(request.id, { status: 'CANCELLED' });
    dbService.setViewingCancelledBy(request.id, 'CUSTOMER');
    agentText = agentCustomerCancelledText(listing, request, propertyId);
  } else {
    dbService.updateViewingRequest(request.id, { status: 'CONFIRMED' });
    // The instant the check-in will be asked against — same parser, same
    // refusal of a day with no hour, as the agent's own confirmation.
    const slot = parseFrenchSlot(request.requested_time);
    if (slot) dbService.setViewingScheduledAt(request.id, slot.iso);
    agentText = agentCustomerAcceptedSlotText(listing, request, propertyId);
  }

  // getListingContactById only returns a number for a phone-verified agent
  // (see its doc comment), so an unverified claim is never messaged.
  const agentPhone = listing?.phone_verified_at ? listing.agent_phone : null;
  const agentNotified = await trySend(agentPhone, agentText, `customer ${action.toLowerCase()} agent copy`);
  await notifyOps(
    opsCustomerAnswerText({ listing, viewingRequest: request, propertyId, action, agentNotified }),
    `customer ${action.toLowerCase()} ops copy`,
  );

  console.log(`[viewing] request #${request.id} ${rule.to} by its customer from the Espace Client — agent told: ${agentNotified}`);
  return { ok: true, status: rule.to, unchanged: false, agentNotified };
}

/**
 * One tapped button. Returns `{ handled: false }` for anything that isn't
 * ours so routes/webhook.js can carry on with its normal processing.
 */
async function handleViewingButtonReply({ from, replyId }) {
  const parsed = parseViewingButtonId(replyId);
  if (!parsed) return { handled: false };

  const ctx = await resolveContext(parsed.viewingRequestId, from);
  if (!ctx.request) {
    console.warn(`[viewing] button '${replyId}' from ${from} names no real request`);
    return { handled: true, ignored: 'unknown-request' };
  }
  if (!ctx.authorised) {
    // Not an error worth telling the sender about: answering a stranger with
    // "that request belongs to someone else" confirms the id is real.
    console.warn(`[viewing] button '${replyId}' from ${from} refused — ${ctx.reason}`);
    return { handled: true, ignored: ctx.reason };
  }

  const args = { ...ctx, from };
  if (parsed.action === 'accept') return { handled: true, ...(await handleAccept(args)) };
  if (parsed.action === 'reschedule') return { handled: true, ...(await handleReschedule(args)) };
  if (parsed.action === 'slot_ok') return { handled: true, ...(await handleSlotOk(args)) };
  if (parsed.action === 'slot_edit') return { handled: true, ...(await handleSlotEdit(args)) };
  return { handled: true, ...(await handleDecline(args)) };
}

// ---------------------------------------------------------------------------
// Typed answers to a question we asked
// ---------------------------------------------------------------------------

/**
 * The agent typed something and we are waiting on an answer from them.
 *
 * Returns `{ handled: false }` whenever the text is not a plausible answer,
 * so the message falls through to the normal listing-intake pipeline. That is
 * the same posture routes/webhook.js's sale-price follow-up already takes,
 * and it is what keeps a real property advert from being eaten because a
 * questionnaire happened to be open.
 */
async function handleAgentTextReply({ from, text }) {
  const pending = dbService.getPendingAgentAction(from);
  if (!pending) return { handled: false };

  const ctx = await resolveContext(pending.viewing_request_id, from);
  if (!ctx.request) {
    dbService.clearPendingAgentAction(from);
    return { handled: false };
  }

  if (pending.kind === PENDING_KINDS.viewingResponse) {
    const choice = parseNumberedChoice(text);
    if (!choice) return { handled: false };
    const args = { ...ctx, from };
    if (choice === 1) return { handled: true, ...(await handleAccept(args)) };
    if (choice === 2) return { handled: true, ...(await handleReschedule(args)) };
    return { handled: true, ...(await handleDecline(args)) };
  }

  if (pending.kind === PENDING_KINDS.scheduleTime) {
    // Typed answer to "what date and time exactly?". Unparseable text falls
    // through to ordinary intake rather than being eaten — the same posture
    // every other branch here takes, and what stops a real property advert
    // being swallowed because a question happened to be open.
    const slot = parseFrenchSlot(text);
    if (!slot) return { handled: false };

    dbService.setViewingScheduledAt(ctx.request.id, slot.iso);
    dbService.clearPendingAgentAction(from);
    await trySend(from, slotAgreedText(slot.iso), 'slot agreed');
    console.log(`[viewing] request #${ctx.request.id} scheduled for ${slot.iso} by ${from}`);
    return { handled: true, action: 'slot-set', scheduledAt: slot.iso };
  }

  if (pending.kind === PENDING_KINDS.reschedule) {
    const proposed = String(text || '').trim().slice(0, 200);
    if (!proposed) return { handled: false };
    dbService.updateViewingRequest(ctx.request.id, { requestedTime: proposed });
    // A reschedule that names a real instant also pins the check-in to it.
    // The customer still has to agree, so the status stays RESCHEDULED — but
    // when they do, there is already a slot to count from.
    const rescheduled = parseFrenchSlot(proposed);
    if (rescheduled) dbService.setViewingScheduledAt(ctx.request.id, rescheduled.iso);
    dbService.clearPendingAgentAction(from);

    const told = await trySend(
      ctx.request.lead_wa_id,
      tenantRescheduleText(ctx.listing, proposed, ctx.propertyId),
      'reschedule proposal',
    );
    if (told) markCustomerNotified(ctx.request.id);
    await trySend(
      from,
      `${HEADER_BRAND} Nouveau créneau transmis au client : ${proposed} ✅`,
      'reschedule ack',
    );
    console.log(`[viewing] request #${ctx.request.id} rescheduled to "${proposed}" — client told: ${told}`);
    return { handled: true, action: 'reschedule-proposed', proposed, tenantNotified: told };
  }

  if (pending.kind === PENDING_KINDS.declineReason) {
    const reason = parseDeclineReason(text);
    if (!reason) return { handled: false };
    dbService.setViewingDeclineReason(ctx.request.id, `${reason} — ${DECLINE_REASONS[reason]}`);
    dbService.setViewingDeclineCode(ctx.request.id, AGENT_DECLINE_REASON_CODES[reason], 'AGENT');

    if (reason === 1) {
      // The property is gone. Retire it now on what the agent told us, and
      // ask for the figure that upgrades 'under_offer' to a real 'closed'
      // transaction record — the same two-step the WhatsApp status flow in
      // routes/webhook.js already performs, landing on the same columns.
      await retireListing(ctx, from);
      return { handled: true, action: 'declined-already-taken', awaiting: PENDING_KINDS.closingPrice };
    }

    dbService.clearPendingAgentAction(from);
    await trySend(from, DECLINE_THANKS, 'decline thanks');
    await notifyOps(
      opsDeclineText({ ...ctx, viewingRequest: ctx.request, reasonCode: reason, closedPrice: null }),
      'ops decline note',
    );
    console.log(`[viewing] request #${ctx.request.id} decline reason = ${reason} (${DECLINE_REASONS[reason]})`);
    return { handled: true, action: 'declined-reason-recorded', reason };
  }

  if (pending.kind === PENDING_KINDS.closingPrice) {
    // services/priceExtraction.js: a bare figure is written straight away,
    // exactly as before; one read out of a sentence or by the model is read
    // back first; a property advert or a franc amount is never taken as one.
    const parsed = await priceExtraction.parseAgentPriceResponse(text);
    if (parsed.declined) return { handled: true, ...(await skipClosingPrice(ctx, from)) };
    if (parsed.amount === null) {
      if (parsed.reason === 'cdf') {
        await trySend(from, CLOSING_PRICE_USD_ONLY, 'closing price usd only');
        return { handled: true, action: 'closing-price-needs-usd' };
      }
      return { handled: false };
    }
    if (parsed.needsConfirmation) {
      dbService.setPendingAgentAction({
        waId: from,
        kind: PENDING_KINDS.closingPriceConfirm,
        viewingRequestId: ctx.request.id,
        amount: parsed.amount,
      });
      await trySend(from, closingPriceConfirmText(parsed.amount), 'closing price confirm');
      console.log(`[viewing] property #${ctx.propertyId} closing price ${parsed.amount} read (${parsed.source}) — awaiting OUI`);
      return {
        handled: true,
        action: 'closing-price-confirm-asked',
        amount: parsed.amount,
        source: parsed.source,
        awaiting: PENDING_KINDS.closingPriceConfirm,
      };
    }
    return { handled: true, ...(await recordClosingPrice(ctx, from, parsed.amount)) };
  }

  if (pending.kind === PENDING_KINDS.closingPriceConfirm) {
    const amount = Number(pending.amount);
    if (priceExtraction.isAffirmative(text) && Number.isFinite(amount) && amount > 0) {
      return { handled: true, ...(await recordClosingPrice(ctx, from, amount)) };
    }
    // A corrected figure replaces the one we read back — it is the agent's
    // own bare answer, which is the most certain form there is.
    const corrected = priceExtraction.parseBarePrice(text);
    if (corrected !== null) return { handled: true, ...(await recordClosingPrice(ctx, from, corrected)) };
    if (/^(non|no)[\s!.]*$/.test(fold(text))) {
      dbService.setPendingAgentAction({
        waId: from,
        kind: PENDING_KINDS.closingPrice,
        viewingRequestId: ctx.request.id,
      });
      await trySend(from, CLOSING_PRICE_REASK, 'closing price re-ask');
      return { handled: true, action: 'closing-price-reasked', awaiting: PENDING_KINDS.closingPrice };
    }
    if (priceExtraction.isPriceDeclined(text)) return { handled: true, ...(await skipClosingPrice(ctx, from)) };
    return { handled: false };
  }

  return { handled: false };
}

/**
 * Write the close: sold_price + sold_at + price_source in one UPDATE, the
 * asking price back for the delta, and a receipt stating both. The delta is
 * computed here for the message only — it is derived again at read time
 * everywhere else and never stored.
 */
async function recordClosingPrice(ctx, from, amount) {
  dbService.clearPendingAgentAction(from);
  let recorded = false;
  let listPrice = ctx.listing?.price != null ? Number(ctx.listing.price) : null;
  try {
    const result = await require('./postgres').recordSoldPrice(remotePropertyIdFor(ctx), amount, {
      source: PRICE_SOURCE_WHATSAPP,
    });
    recorded = result.updated;
    if (result.listPrice != null) listPrice = result.listPrice;
  } catch (err) {
    console.error(`[viewing] could not close property #${ctx.propertyId}: ${err.message}`);
  }
  const delta = priceExtraction.computePriceDelta(listPrice, amount);

  await trySend(from, closingPriceThanksText(amount, listPrice, delta), 'closing price thanks');
  await notifyOps(
    opsDeclineText({ ...ctx, viewingRequest: ctx.request, reasonCode: 1, closedPrice: amount, listPrice, delta }),
    'ops closed note',
  );
  console.log(
    `[viewing] property #${ctx.propertyId} closed at ${amount} (list ${listPrice ?? '?'}, `
      + `delta ${delta.deltaPct ?? '?'}%, written: ${recorded})`,
  );
  return {
    action: 'closing-price-recorded',
    amount,
    recorded,
    listPrice,
    deltaUsd: delta.deltaUsd,
    deltaPct: delta.deltaPct,
    source: PRICE_SOURCE_WHATSAPP,
  };
}

/** Stays 'under_offer': off the market, transaction not recorded, no price invented. */
async function skipClosingPrice(ctx, from) {
  dbService.clearPendingAgentAction(from);
  await trySend(from, CLOSING_PRICE_SKIPPED, 'closing price skipped');
  await notifyOps(
    opsDeclineText({ ...ctx, viewingRequest: ctx.request, reasonCode: 1, closedPrice: null }),
    'ops closed note',
  );
  return { action: 'closing-price-skipped' };
}

/** The engine-side listing row behind a Postgres property, if we have one. */
function remotePropertyIdFor(ctx) {
  return Number(ctx.propertyId);
}

/**
 * Take the listing off the market and ask what it went for.
 *
 * markPropertyUnderOffer, not markPropertySold: 'closed' must carry a real
 * sold_price, because the institutional market export (asking vs achieved) is
 * built on that figure and a closed row with a NULL price silently corrupts
 * it. 'under_offer' needs no figure, retires the listing from active browsing
 * immediately, and is honest about what we actually know.
 */
async function retireListing(ctx, from) {
  let retired = false;
  try {
    retired = await require('./postgres').markPropertyUnderOffer(remotePropertyIdFor(ctx));
  } catch (err) {
    console.error(`[viewing] could not retire property #${ctx.propertyId}: ${err.message}`);
  }
  console.log(`[viewing] property #${ctx.propertyId} marked under_offer (written: ${retired})`);

  dbService.setPendingAgentAction({
    waId: from,
    kind: PENDING_KINDS.closingPrice,
    viewingRequestId: ctx.request.id,
  });
  await trySend(from, CLOSING_PRICE_ASK, 'closing price ask');
}

module.exports = {
  notifyViewingRequest,
  notifyViewingRequestInBackground,
  reassignViewing,
  nudgeViewingAgent,
  AGENT_DECLINE_REASON_CODES,
  closingPriceConfirmText,
  closingPriceThanksText,
  CLOSING_PRICE_USD_ONLY,
  PRICE_SOURCE_WHATSAPP,
  opsNumber,
  warnIfOpsUnconfigured,
  notifyOps,
  // Exposed for scripts/verify-pipeline.js.
  agentMessage,
  opsMessage,
  listingLabel,
  displayPhone,
  listingLink,
  HEADER,
  viewingButtons,
  buttonFallbackText,
  BUTTON_PREFIX,
  slotConfirmButtons,
  slotConfirmText,
  slotAgreedText,
  SCHEDULE_ASK,
  // The feedback loop.
  handleViewingButtonReply,
  handleAgentTextReply,
  respondFromDashboard,
  DASHBOARD_TRANSITIONS,
  respondFromCustomer,
  CUSTOMER_TRANSITIONS,
  tenantCancelledText,
  opsDashboardAnswerText,
  parseViewingButtonId,
  parseNumberedChoice,
  parseDeclineReason,
  parseClosingPrice,
  isPriceDeclined,
  tenantAcceptedText,
  tenantRescheduleText,
  tenantAlternativesText,
  opsDeclineText,
  DECLINE_SURVEY_TEXT,
  CLOSING_PRICE_ASK,
  DECLINE_REASONS,
  PENDING_KINDS,
};
