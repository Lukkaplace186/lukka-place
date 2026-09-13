/**
 * services/listingEnquiry.js
 *
 * The reply to somebody who tapped "Contacter sur WhatsApp" on a listing
 * page, and the alert that tells a real human they did.
 *
 * THE BUG THIS FIXES
 * The storefront builds the message (web/lib/whatsapp.js's
 * buildWhatsAppMessage) and opens WhatsApp with it pre-typed:
 *
 *   Bonjour, je vous contacte via Lukka Place au sujet de ce bien :
 *   Appartement à Limete — 1 100 $ / mois
 *   Réf. Petit Boulevard, 2ᵉ Rue Industrielle
 *
 *   Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?
 *
 *   https://lukkaplace.com/listings/293
 *
 * (Its wording has changed since this module was written; recognition only
 * ever depended on the link, and the older "je suis intéressé par l'annonce
 * Ref: … Voir l'annonce : <link>" shape still parses.)
 *
 * That message reached the intake pipeline, was classified `is_listing:
 * false` with `intent: 'question'`, matched no branch, and fell through to
 * gpt-4o's generic `whatsapp_reply`. What the model wrote back, verbatim
 * from a real production transcript:
 *
 *   « Pour vérifier la disponibilité, veuillez consulter directement
 *     l'annonce sur notre site ou contacter l'agent responsable via le lien
 *     fourni. »
 *
 * — sent to a customer who was standing on that page thirty seconds
 * earlier, and who arrived here through exactly that link. It is a closed
 * loop: the answer to "is it still available?" is "go and look at the thing
 * you just came from". Nobody at Lukka Place was told the enquiry existed
 * either, so nothing else was going to break the loop afterwards.
 *
 * WHY THIS IS DETERMINISTIC AND NOT A PROMPT CHANGE
 * We wrote this message ourselves. Its shape is known, it carries our own
 * listing URL, and the listing id in that URL resolves against real data —
 * so the correct reply needs no model at all, costs no extraction call, and
 * cannot drift the way a prompt instruction can. Anything that does NOT
 * carry one of our real listing links returns `handled: false` and falls
 * straight through to normal processing, the same posture every other
 * interception in routes/webhook.js takes.
 *
 * WHAT IT PROMISES
 * The reply says an agent will come back to the customer. That has to be
 * true, so it is written from what actually happened: the promise is only
 * made when this module genuinely reached a human (the listing's own
 * phone-verified agent, or Lukka Place's desk). When it reached nobody, the
 * customer is told plainly to contact the number on the listing instead —
 * an honest dead end beats a promised call that no one has been asked to
 * make.
 */

const chakra = require('./chakra');
const db = require('./db');
const propertyRepository = require('./propertyRepository');

/**
 * Lukka Place's own desk. Same variable, same no-default reasoning as
 * services/viewingNotifications.js: the obvious candidate
 * (NEXT_PUBLIC_WHATSAPP_NUMBER) is this engine's own WABA sender, and a
 * WABA number cannot message itself.
 */
const OPS_NUMBER = (process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '') || null;

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

const HEADER = '🏠 [Lukka Place] Nouvelle demande sur une annonce';

/**
 * The listing id out of one of our own listing URLs.
 *
 * Host-anchored rather than a bare `/listings/(\d+)` match: an agent
 * pasting a competitor's link, or quoting a path in prose, must not be read
 * as a customer enquiry about one of ours. Accepts http/https, an optional
 * `www.`, and any of the hosts this site is really reachable on — the
 * storefront builds these links from NEXT_PUBLIC_SITE_URL, which is
 * lukkaplace.com in production and a localhost origin in dev, and QA sends
 * real messages from both.
 *
 * Only a NUMERIC id is accepted. `/listings/[id]` also resolves a slug on
 * the site, but a slug cannot be told apart from a path segment with any
 * confidence here, and looking one up would mean a database round trip on
 * every inbound message. Every link buildWhatsAppMessage emits uses the id.
 */
const LISTING_URL = /https?:\/\/(?:www\.)?(?:lukkaplace\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)\/listings\/(\d+)\b/i;

/**
 * The quoted reference, in either shape the storefront has written it:
 * "Réf. X" on its own line (current), or "Ref: X (…)" inline (links already
 * sitting in people's chats). Ends at a line break, "(" or "—" — NOT at "-",
 * which cut "Ngiri-Ngiri" to "Ngiri" and the old slug fallback to "2".
 */
const REFERENCE = /\bR[ée]f\s*[.:]\s*([^(\n—]+?)\s*(?:\(|—|\n|$)/i;

/**
 * Does this message look like somebody asking about a specific listing of
 * ours?
 *
 * @param {string} text
 * @returns {{propertyId: number, reference: string|null}|null}
 */
function parseListingEnquiry(text) {
  if (!text || typeof text !== 'string') return null;

  const link = text.match(LISTING_URL);
  if (!link) return null;

  const propertyId = Number.parseInt(link[1], 10);
  if (!Number.isFinite(propertyId) || propertyId <= 0) return null;

  const ref = text.match(REFERENCE);
  return { propertyId, reference: ref ? ref[1].trim() : null };
}

/** "+243 82 112 29 37" is what a person dials; `243821122937` is what we store. */
function displayPhone(waId) {
  const digits = String(waId || '').replace(/\D/g, '');
  return digits ? `+${digits}` : 'numéro inconnu';
}

function listingLink(listing, propertyId) {
  return listing?.slug ? `${SITE_URL}/listings/${listing.slug}` : `${SITE_URL}/listings/${propertyId}`;
}

/**
 * How the listing is named in the alerts. Its own `reference` when it has
 * one (that is what the page shows), the title otherwise, and the bare id as
 * the last honest fallback — never "Ref: null", which is what a naive
 * interpolation produced on the ~60 % of live listings that carry no
 * reference code.
 *
 * The listing's own fields win over whatever the customer's message quoted:
 * the listing always resolves by the time this runs, and a quoted reference
 * is only as good as the message it came from — the storefront's old slug
 * fallback made it "2-chambres-appartement-a-louer-a-limete-286".
 */
function listingLabel(listing, propertyId, quotedReference) {
  return listing?.reference || listing?.title || quotedReference || `#${propertyId}`;
}

/**
 * "le bien « 2 chambres — Appartement à louer à Limete » (Réf. Demiap)".
 * The title and reference each appear once — the old
 * "Ref: {label} ({title})" printed the title twice whenever a listing had
 * no reference, since the label had fallen back to that same title.
 */
function listingPhrase(listing, propertyId) {
  const name = listing?.title ? `le bien « ${listing.title} »` : `l'annonce #${propertyId}`;
  return listing?.reference ? `${name} (Réf. ${listing.reference})` : name;
}

/**
 * The reply the customer gets.
 *
 * `reached` is not cosmetic — it is the difference between a promise we
 * have arranged to keep and one we have not. See the module comment.
 */
function customerReply({ listing, propertyId, reached }) {
  const phrase = listingPhrase(listing, propertyId);

  if (!reached) {
    return (
      `Bonjour ! Merci pour votre intérêt pour ${phrase}.\n\n`
      + "Nous n'avons pas pu joindre l'agent responsable dans l'immédiat. "
      + "Le numéro de contact direct figure sur la fiche de l'annonce : "
      + `${listingLink(listing, propertyId)}\n\n`
      + 'Vous pouvez aussi nous décrire ce que vous cherchez ici, nous vous proposerons des biens similaires.'
    );
  }

  return (
    `Bonjour ! Merci pour votre intérêt pour ${phrase}.\n\n`
    + "Un de nos agents partenaires vérifie la disponibilité auprès du bailleur "
    + 'et vous recontactera très rapidement.\n\n'
    + 'Souhaitez-vous programmer une visite ?'
  );
}

/** The alert the listing's own agent gets. Everything needed to call back is above the fold. */
function agentMessage({ listing, propertyId, from, quotedReference }) {
  const lines = [
    HEADER,
    `📍 Bien: ${listingLabel(listing, propertyId, quotedReference)}`
      + (listing?.title ? ` — ${listing.title}` : ''),
    `👤 Client: ${displayPhone(from)}`,
    '❓ Demande: disponibilité du bien',
  ];
  if (listing?.commune) lines.push(`🗺️ Commune: ${listing.commune}`);
  lines.push(
    '',
    'Le client a été informé que vous le recontactez rapidement.',
    listingLink(listing, propertyId),
  );
  return lines.join('\n');
}

/** The desk copy. Says out loud whether the agent was reached — that is what decides who acts. */
function opsMessage({ listing, propertyId, from, quotedReference, agentNotified, agentSkipReason }) {
  const lines = [
    HEADER,
    '',
    `• Bien : ${listingLabel(listing, propertyId, quotedReference)} (#${propertyId})`,
  ];
  if (listing?.title) lines.push(`• Titre : ${listing.title}`);
  if (listing?.commune) lines.push(`• Commune : ${listing.commune}`);
  lines.push(
    `• Client : ${displayPhone(from)}`,
    '',
    agentNotified
      ? `Agent prévenu : ${listing?.agent_name || `#${listing?.agent_id}`}`
      : `⚠️ Agent NON prévenu (${agentSkipReason}) — à traiter manuellement.`,
    listingLink(listing, propertyId),
  );
  return lines.join('\n');
}

/**
 * Tell the listing's agent and the desk. Never throws; returns whether
 * anybody was actually reached, because the customer's reply depends on it.
 *
 * Deliberately NOT services/leadDispatch.js. That module answers "who might
 * have a property like this?" and pushes to seven ranked agencies; this
 * enquiry names one specific listing, and broadcasting it to competitors
 * would be the wrong message to the wrong people — the same separation
 * services/viewingNotifications.js already documents and must keep.
 *
 * @returns {Promise<{agentNotified: boolean, opsNotified: boolean, reason?: string}>}
 */
async function notifyEnquiry({ listing, propertyId, from, quotedReference }) {
  // Same gate as services/postgres.js's resolveAgentId and
  // agentOnboarding's identifySender: an unverified number is somebody's
  // claim, and messaging it would tell a stranger who is asking about an
  // agency's properties.
  let agentSkipReason = null;
  // Plus the team's direct-routing switch: an agent switched to central
  // fallback is not alerted directly, and the desk handles the enquiry.
  if (!listing) agentSkipReason = 'annonce introuvable ou non approuvée';
  else agentSkipReason = propertyRepository.directRoutingBlocker(listing);

  let agentNotified = false;
  if (!agentSkipReason) {
    try {
      await chakra.sendWhatsAppMessage(
        String(listing.agent_phone).replace(/\D/g, ''),
        agentMessage({ listing, propertyId, from, quotedReference }),
        { previewUrl: true },
      );
      agentNotified = true;
      console.log(`[enquiry] property #${propertyId} -> agent #${listing.agent_id} notified`);
    } catch (err) {
      agentSkipReason = `échec de l'envoi : ${err.message}`;
      console.error(`[enquiry] notifying agent #${listing.agent_id} for property #${propertyId} failed: ${err.message}`);
    }
  } else {
    console.warn(`[enquiry] property #${propertyId} — agent not notified: ${agentSkipReason}`);
  }

  let opsNotified = false;
  if (OPS_NUMBER) {
    try {
      await chakra.sendWhatsAppMessage(
        OPS_NUMBER,
        opsMessage({ listing, propertyId, from, quotedReference, agentNotified, agentSkipReason }),
        { previewUrl: true },
      );
      opsNotified = true;
    } catch (err) {
      console.error(`[enquiry] ops copy for property #${propertyId} failed: ${err.message}`);
    }
  } else if (!agentNotified) {
    console.error(
      `[enquiry] property #${propertyId} from ${from} reached NOBODY — `
        + `no agent (${agentSkipReason}) and OPS_WHATSAPP_NUMBER is unset`,
    );
  }

  return { agentNotified, opsNotified, reason: agentSkipReason || undefined };
}

/**
 * Record the enquiry so it is countable and shows up where leads show up.
 *
 * `source: 'listing-whatsapp-enquiry'` keeps it distinguishable from
 * 'listing-visit-request' (the "Demander une visite" form) and from the
 * assistant's own enquiries — they are different actions with different
 * follow-ups, and collapsing them would make the WhatsApp CTA's real
 * conversion unmeasurable, the same reason lead_matches and lead_proposals
 * stay separate tables.
 *
 * Best-effort: a failed insert must not cost the customer their reply. The
 * message going out is the part that matters to them.
 */
function recordEnquiryLead({ from, propertyId, listing, conversationId }) {
  try {
    return db.createLead({
      conversation_id: conversationId ?? null,
      wa_id: from,
      source: 'listing-whatsapp-enquiry',
      property_id: propertyId,
      commune: listing?.commune ?? null,
      requirements_summary: `Demande de disponibilité — ${listing?.title || `annonce #${propertyId}`}`,
      status: 'NEW',
    });
  } catch (err) {
    console.error(`[enquiry] could not record a lead for property #${propertyId}: ${err.message}`);
    return null;
  }
}

/**
 * Handle one inbound message that might be a listing enquiry.
 *
 * @param {Object} params
 * @param {string} params.from   Sender's WhatsApp id (E.164 digits, no '+').
 * @param {string} params.text
 * @param {string} [params.primaryWamid]
 * @returns {Promise<{handled: boolean, propertyId?: number}>}
 *   `handled: false` means this was not a listing enquiry (or named a
 *   listing that is not live) and the caller must carry on with ordinary
 *   processing. That fall-through is what stops a real property advert
 *   being swallowed because it happened to quote a listing URL.
 */
async function handleListingEnquiry({ from, text, primaryWamid } = {}) {
  const parsed = parseListingEnquiry(text);
  if (!parsed) return { handled: false };

  const { propertyId, reference: quotedReference } = parsed;

  // getListingContactById applies the same `status = 1 AND approve_status = 1`
  // gate as every other read there, so a link to a pending or retired
  // listing resolves to nothing. It catches its own query errors and
  // returns null, but the pool it builds first can throw outside that try
  // (a malformed DB_HOST), so the call is guarded here too.
  let listing = null;
  try {
    listing = await propertyRepository.getListingContactById(propertyId);
  } catch (err) {
    console.error(`[enquiry] listing lookup for property #${propertyId} failed: ${err.message}`);
  }

  if (!listing) {
    // The link named a listing we cannot confirm is live. Answering "an
    // agent will call you about it" would be a promise about a property
    // that may not exist, so this falls through to ordinary processing
    // rather than inventing a reply.
    console.warn(`[enquiry] ${from} quoted property #${propertyId}, which is not live — falling through`);
    return { handled: false };
  }

  // Fire the alert BEFORE replying: the customer's reply states whether
  // somebody was reached, so it cannot be written until we know.
  const { agentNotified, opsNotified } = await notifyEnquiry({
    listing, propertyId, from, quotedReference,
  });
  const reached = agentNotified || opsNotified;

  // An existing thread with this customer is reused rather than forked —
  // they may well have been mid-search when they tapped the button, and a
  // second conversation row would split one person's transcript in two.
  let conversation = null;
  try {
    conversation = db.getActiveConversation(from) || db.createConversation(from);
    db.recordMessage(conversation.id, 'inbound', { wamid: primaryWamid, text });
    db.setSelectedProperty(conversation.id, propertyId);
  } catch (err) {
    console.error(`[enquiry] could not record the conversation for ${from}: ${err.message}`);
  }

  recordEnquiryLead({ from, propertyId, listing, conversationId: conversation?.id ?? null });

  const reply = customerReply({ listing, propertyId, quotedReference, reached });

  try {
    await chakra.sendWhatsAppMessage(from, reply, {
      replyToMessageId: primaryWamid || undefined,
      previewUrl: true,
    });
    if (conversation) db.recordMessage(conversation.id, 'outbound', { text: reply });
    console.log(
      `[enquiry] property #${propertyId} from ${from} — replied `
        + `(agent=${agentNotified}, ops=${opsNotified})`,
    );
  } catch (err) {
    // The alert already went out, so a human still knows. Reported, not
    // rethrown — and still `handled: true`, because re-running the intake
    // pipeline on this message would produce exactly the circular reply
    // this module exists to stop.
    console.error(`[enquiry] replying to ${from} about property #${propertyId} failed: ${err.message}`);
  }

  return { handled: true, propertyId };
}

module.exports = {
  handleListingEnquiry,
  parseListingEnquiry,
  notifyEnquiry,
  customerReply,
  agentMessage,
  opsMessage,
  listingLabel,
  HEADER,
};
