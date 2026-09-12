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
 */
const OPS_NUMBER = (process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '') || null;

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
};

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
async function notifyViewingRequest({ viewingRequest, lead, propertyId } = {}) {
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

  // Same gate as services/postgres.js's resolveAgentId and
  // agentOnboarding's identifySender, for the same reason: an unverified
  // number is a claim somebody typed, not a confirmed destination.
  let agentSkipReason = null;
  if (!listing) agentSkipReason = 'listing introuvable ou non approuvée';
  else if (!listing.agent_phone) agentSkipReason = 'aucun agent rattaché à cette annonce';
  else if (!listing.phone_verified_at) agentSkipReason = 'numéro agent non vérifié';

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

  let opsNotified = false;
  if (OPS_NUMBER) {
    try {
      await chakra.sendWhatsAppMessage(
        OPS_NUMBER,
        opsMessage({ listing, lead, viewingRequest, propertyId: id, agentNotified, agentSkipReason }),
        { previewUrl: true },
      );
      opsNotified = true;
    } catch (err) {
      console.error(`[viewing] ops copy for request #${viewingRequest?.id} failed: ${err.message}`);
    }
  } else if (!agentNotified) {
    // The one combination where a request reaches nobody at all. Worth a
    // louder line than the per-recipient warnings above, because it is the
    // state the visitor's "l'agent vous répondra" is silently false in.
    console.error(
      `[viewing] request #${viewingRequest?.id} (property #${id}) reached NOBODY — ` +
        `no agent (${agentSkipReason}) and OPS_WHATSAPP_NUMBER is unset`,
    );
  }

  return { agentNotified, opsNotified, reason: agentSkipReason || undefined };
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
};

const DECLINE_REASONS = {
  1: 'Bien déjà loué / vendu',
  2: 'Non disponible aux dates demandées',
  3: 'Autre raison',
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
  const match = /^viewing_(accept|reschedule|decline):(\d+)$/.exec(String(replyId || '').trim());
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
  '📊 Félicitations ! À quel prix final le bien a-t-il été conclu ? (ex: 700$)\n\n' +
  'Répondez _passer_ si vous préférez ne pas le communiquer.';

const CLOSING_PRICE_THANKS = `${HEADER_BRAND} Merci, la transaction est enregistrée. 🎉`;
const CLOSING_PRICE_SKIPPED =
  `${HEADER_BRAND} Très bien — le bien reste retiré des recherches. Merci de nous avoir prévenus ! 🙌`;
const RESCHEDULE_ASK =
  `${HEADER_BRAND} Quel créneau proposez-vous ? Répondez avec la date et l'heure ` +
  "(ex. _samedi 14h_) et nous le transmettons au client.";
const DECLINE_THANKS = `${HEADER_BRAND} C'est noté, merci de votre réponse. 🙏`;

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

function opsDeclineText({ listing, viewingRequest, propertyId, reasonCode, closedPrice }) {
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
      '👉 À vérifier et archiver sur le storefront.',
    );
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

async function notifyOps(text, label) {
  if (!OPS_NUMBER) {
    console.warn(`[viewing] ${label}: OPS_WHATSAPP_NUMBER unset — ops not told`);
    return false;
  }
  return trySend(OPS_NUMBER, text, label);
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

async function handleAccept({ request, listing, propertyId, from }) {
  dbService.updateViewingRequest(request.id, { status: 'CONFIRMED' });
  dbService.clearPendingAgentAction(from);

  await trySend(from, acceptedAgentText(listing, request, propertyId), 'accept ack');
  const told = await trySend(
    request.lead_wa_id,
    tenantAcceptedText(listing, request, propertyId),
    'accept confirmation',
  );

  console.log(`[viewing] request #${request.id} ACCEPTED by agent ${from} — client told: ${told}`);
  return { action: 'accept', status: 'CONFIRMED', tenantNotified: told };
}

async function handleReschedule({ request, from }) {
  dbService.updateViewingRequest(request.id, { status: 'RESCHEDULED' });
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
  return { count: alternatives.length, sent };
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

  if (pending.kind === PENDING_KINDS.reschedule) {
    const proposed = String(text || '').trim().slice(0, 200);
    if (!proposed) return { handled: false };
    dbService.updateViewingRequest(ctx.request.id, { requestedTime: proposed });
    dbService.clearPendingAgentAction(from);

    const told = await trySend(
      ctx.request.lead_wa_id,
      tenantRescheduleText(ctx.listing, proposed, ctx.propertyId),
      'reschedule proposal',
    );
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
    const amount = parseClosingPrice(text);
    if (amount !== null) {
      dbService.clearPendingAgentAction(from);
      let recorded = false;
      try {
        recorded = await require('./postgres').markPropertySold(remotePropertyIdFor(ctx), amount);
      } catch (err) {
        console.error(`[viewing] could not close property #${ctx.propertyId}: ${err.message}`);
      }
      await trySend(from, CLOSING_PRICE_THANKS, 'closing price thanks');
      await notifyOps(
        opsDeclineText({ ...ctx, viewingRequest: ctx.request, reasonCode: 1, closedPrice: amount }),
        'ops closed note',
      );
      console.log(`[viewing] property #${ctx.propertyId} closed at ${amount} (written: ${recorded})`);
      return { handled: true, action: 'closing-price-recorded', amount, recorded };
    }
    if (isPriceDeclined(text)) {
      // Stays 'under_offer': off the market, transaction not recorded. Honest,
      // and it keeps the market export free of a fabricated price.
      dbService.clearPendingAgentAction(from);
      await trySend(from, CLOSING_PRICE_SKIPPED, 'closing price skipped');
      await notifyOps(
        opsDeclineText({ ...ctx, viewingRequest: ctx.request, reasonCode: 1, closedPrice: null }),
        'ops closed note',
      );
      return { handled: true, action: 'closing-price-skipped' };
    }
    return { handled: false };
  }

  return { handled: false };
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
  // The feedback loop.
  handleViewingButtonReply,
  handleAgentTextReply,
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
