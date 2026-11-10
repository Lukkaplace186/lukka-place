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
const deskAlert = require('./deskAlert');
const agentEnquiryAlert = require('./agentEnquiryAlert');
const db = require('./db');
const propertyRepository = require('./propertyRepository');
const { placeLabel, placeKey } = require('./locations');
const { agentHandoffReply } = require('./contactHandoff');

/**
 * Lukka Place's own desk. Same variable, same no-default reasoning as
 * services/viewingNotifications.js: the obvious candidate
 * (NEXT_PUBLIC_WHATSAPP_NUMBER) is this engine's own WABA sender, and a
 * WABA number cannot message itself.
 */
// Read at call time and normalised in one place (services/opsDesk.js), like
// every other desk reader; this one was frozen at module load.
const opsNumber = () => require('./opsDesk').opsNumber();

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

// ---------------------------------------------------------------------------
// The same message WITHOUT its link (2026-11-10)
// ---------------------------------------------------------------------------
//
// +243 828 553 557 sent the storefront's text with no URL at all (removed in
// the chat before sending — no web builder omits it: every caller passes the
// listing id). It fell through to the agent "Pour publier un bien…" help, the
// customer's screenshot became a draft, and their next sentence became an
// agent's name. The opening line is ours and no agent's advert carries it, so
// it identifies a customer by itself; the facts line and the Réf. line find
// the listing among live ones.

/** Accent-, case- and apostrophe-insensitive, single-spaced. */
function foldText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The fixed opening web/lib/whatsapp.js buildWhatsAppMessage writes. */
const ENQUIRY_OPENING = /je vous contacte via lukka ?place au sujet de ce bien/;

/** Does the text carry the storefront enquiry's own opening line? */
function carriesEnquiryOpening(text) {
  return ENQUIRY_OPENING.test(foldText(text));
}

/** "1 100 $", "120 $" (fr-FR groups with spaces, NBSP or narrow NBSP). */
const PRICE_IN_FACTS = /(\d[\d\s  .]*)\s*\$/;

/**
 * The listing as the message describes it, or null when the text is not
 * the storefront enquiry. Every field is null when the message did not
 * state it — nothing is filled in.
 *
 * @returns {{facts: string|null, reference: string|null, propertyType: string|null,
 *            placeParts: string[], price: number|null}|null}
 */
function parseLinklessEnquiry(text) {
  if (!text || typeof text !== 'string' || !carriesEnquiryOpening(text)) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => ENQUIRY_OPENING.test(foldText(line)));
  let facts = null;
  let reference = null;
  for (const line of lines.slice(start + 1)) {
    if (!line) continue;
    const ref = line.match(/^R[ée]f\s*[.:]\s*(.+)$/i);
    if (ref) {
      reference = ref[1].trim() || null;
      continue;
    }
    if (/disponible|visiter|https?:\/\//i.test(line)) break;
    if (!facts) facts = line;
  }

  let propertyType = null;
  let placeParts = [];
  let price = null;
  for (const part of facts ? facts.split(/\s+[—–]\s+/) : []) {
    const amount = part.match(PRICE_IN_FACTS);
    if (amount) {
      const n = Number.parseInt(amount[1].replace(/\D/g, ''), 10);
      price = Number.isFinite(n) && n > 0 ? n : null;
      continue;
    }
    // "Studio à Industriel, Limete" — type, then "quartier, commune[, ville]".
    const at = part.indexOf(' à ');
    const place = at >= 0 ? part.slice(at + 3) : part;
    if (at >= 0) propertyType = part.slice(0, at).trim() || null;
    placeParts = place.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
  }
  return { facts, reference, propertyType, placeParts, price };
}

/**
 * Which live candidates fit what the message states. Only what the message
 * states is compared; a fact the listing lacks never disqualifies it except
 * the commune, which the message always names when it has a place.
 *
 * @returns {number[]} property ids
 */
function matchEnquiryCandidates(parsed, rows) {
  if (!parsed || !Array.isArray(rows)) return [];
  const type = parsed.propertyType ? foldText(parsed.propertyType) : null;
  const placeKeys = parsed.placeParts.map((p) => placeKey(p));
  return rows
    .filter((row) => {
      if (type && row.category_name && foldText(row.category_name) !== type) return false;
      if (placeKeys.length) {
        // A single segment with no " à " may be the type alone.
        const single = placeKeys.length === 1 && !type;
        const communeOk = row.commune && placeKeys.includes(placeKey(row.commune));
        const typeOk = single && row.category_name && foldText(row.category_name) === foldText(parsed.placeParts[0]);
        if (!communeOk && !typeOk) return false;
        if (placeKeys.length >= 2 && row.quartier && placeKey(row.quartier) !== placeKeys[0]) return false;
      }
      return true;
    })
    .map((row) => Number(row.id));
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
  if (placeLabel(listing || {})) lines.push(`🗺️ Lieu : ${placeLabel(listing)}`);
  lines.push(
    '',
    'Le client a reçu votre numéro WhatsApp : écrivez-lui vite, il attend votre réponse.',
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
  if (placeLabel(listing || {})) lines.push(`• Lieu : ${placeLabel(listing)}`);
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
async function notifyEnquiry({ listing, propertyId, from, quotedReference, leadId = null }) {
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
      const { via } = await agentEnquiryAlert.sendAgentEnquiryAlert(
        String(listing.agent_phone),
        agentMessage({ listing, propertyId, from, quotedReference }),
        {
          agentName: listing.agent_name,
          subject: [listing.title || `annonce n° ${propertyId}`, placeLabel(listing)].filter(Boolean).join(', '),
          client: displayPhone(from),
          message: 'Est-il toujours disponible ? Le client souhaite le visiter.',
          leadId,
          label: `listing enquiry #${propertyId}`,
        },
      );
      agentNotified = true;
      console.log(`[enquiry] property #${propertyId} -> agent #${listing.agent_id} notified (${via})`);
    } catch (err) {
      agentSkipReason = `échec de l'envoi : ${err.message}`;
      console.error(`[enquiry] notifying agent #${listing.agent_id} for property #${propertyId} failed: ${err.message}`);
    }
  } else {
    console.warn(`[enquiry] property #${propertyId} — agent not notified: ${agentSkipReason}`);
  }

  let opsNotified = false;
  const OPS_NUMBER = opsNumber();
  if (OPS_NUMBER) {
    try {
      await deskAlert.sendDeskAlert(
        OPS_NUMBER,
        opsMessage({ listing, propertyId, from, quotedReference, agentNotified, agentSkipReason }),
        { label: 'listing enquiry' },
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
  let parsed = parseListingEnquiry(text);
  // No link: our own opening line still says it is a customer asking about
  // one of our listings. One live match is that listing; none or several is
  // a customer whose listing we cannot name — never the agent path.
  let linkless = null;
  if (!parsed) {
    linkless = parseLinklessEnquiry(text);
    if (!linkless) return { handled: false };
    const rows = await propertyRepository.findLiveListingsForEnquiry({ price: linkless.price, reference: linkless.reference });
    const ids = matchEnquiryCandidates(linkless, rows);
    if (ids.length !== 1) {
      return handleUnidentifiedEnquiry({ from, text, primaryWamid, linkless, candidateIds: ids });
    }
    console.log(`[enquiry] ${from} — enquiry with no link matched property #${ids[0]} by its text`);
    parsed = { propertyId: ids[0], reference: linkless.reference };
  }

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

  if (!listing && linkless) {
    return handleUnidentifiedEnquiry({ from, text, primaryWamid, linkless, candidateIds: [] });
  }
  if (!listing) {
    // The link named a listing we cannot confirm is live. Answering "an
    // agent will call you about it" would be a promise about a property
    // that may not exist, so this falls through to ordinary processing
    // rather than inventing a reply.
    console.warn(`[enquiry] ${from} quoted property #${propertyId}, which is not live — falling through`);
    return { handled: false };
  }

  // An existing thread with this customer is reused rather than forked —
  // they may well have been mid-search when they tapped the button, and a
  // second conversation row would split one person's transcript in two.
  let conversation = null;
  try {
    conversation = db.getActiveConversation(from) || db.createConversation(from);
    db.recordMessage(conversation.id, 'inbound', { wamid: primaryWamid, text, intent: 'listing_enquiry' });
    db.setSelectedProperty(conversation.id, propertyId);
  } catch (err) {
    console.error(`[enquiry] could not record the conversation for ${from}: ${err.message}`);
  }

  // The same customer about the same listing within 24 h (a second tap, a
  // follow-up): one lead and one agent alert, not one per message.
  // An open visit on this listing counts the same way: the customer is
  // following it up (Espace Client "Écrire à l'agent"), not asking afresh.
  let recent = null;
  try {
    recent = db.findRecentLeadFor({ waId: from, propertyId }) || db.findOpenViewingFor({ waId: from, propertyId });
  } catch (err) {
    console.error(`[enquiry] recent-lead lookup for ${from} failed: ${err.message}`);
  }
  const routable = !propertyRepository.directRoutingBlocker(listing);

  let agentNotified = false;
  let opsNotified = false;
  if (!recent) {
    // Recorded before the alert: the agent's template button opens this lead.
    const lead = recordEnquiryLead({ from, propertyId, listing, conversationId: conversation?.id ?? null });
    if (lead && routable) {
      try {
        db.assignLead(lead.id, { agentId: listing.agent_id, assignedAgent: listing.agent_name || null });
      } catch (err) {
        console.error(`[enquiry] could not assign lead #${lead.id} to agent #${listing.agent_id}: ${err.message}`);
      }
    }
    // Fire the alert BEFORE replying: the customer's reply states whether
    // somebody was reached, so it cannot be written until we know.
    ({ agentNotified, opsNotified } = await notifyEnquiry({
      listing, propertyId, from, quotedReference, leadId: lead?.id ?? null,
    }));
  } else {
    console.log(`[enquiry] property #${propertyId} from ${from} — follow-up of #${recent.id} (${recent.lead_id ? "visit" : "lead"}), no new alert`);
  }
  const reached = agentNotified || opsNotified || Boolean(recent);

  // Via Lukka Place (2026-11-09): when the listing's verified agent was told
  // (or already was), the customer gets that agent's WhatsApp at once.
  const reply = routable && (agentNotified || recent)
    ? agentHandoffReply({
      agentName: listing.agent_name,
      agentPhone: listing.agent_phone,
      about: listingPhrase(listing, propertyId),
      repeat: Boolean(recent),
    })
    : customerReply({ listing, propertyId, quotedReference, reached });

  try {
    await chakra.sendWhatsAppMessage(from, reply, {
      replyToMessageId: primaryWamid || undefined,
      previewUrl: true,
    });
    // 'system', not 'ai': this reply is the deterministic template above, and
    // no model was involved in writing it.
    if (conversation) db.recordMessage(conversation.id, 'outbound', { text: reply, sender: 'system' });
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

/** How the customer quoted the listing, their own words: facts line + Réf. */
function quotedListing(linkless) {
  return [linkless.facts, linkless.reference ? `Réf. ${linkless.reference}` : null].filter(Boolean).join('\n');
}

/** The reply when we cannot tell which listing the customer means. */
function unidentifiedReply({ linkless, several, reached }) {
  const quoted = quotedListing(linkless);
  const lines = [
    quoted ? `Bonjour ! Merci pour votre message au sujet de ce bien :\n${quoted}` : 'Bonjour ! Merci pour votre message.',
    '',
    several
      ? 'Plusieurs annonces correspondent à cette description. Pouvez-vous nous envoyer le *lien de l’annonce* (bouton « Partager » sur la page) ?'
      : 'Nous n’avons pas retrouvé cette annonce en ligne. Pouvez-vous nous envoyer le *lien de l’annonce* (bouton « Partager » sur la page) ?',
  ];
  lines.push('', reached
    ? 'Notre équipe a reçu votre demande et vous répond très rapidement.'
    : 'Vous pouvez aussi nous décrire ce que vous cherchez ici : commune, budget, nombre de chambres.');
  return lines.join('\n');
}

/** The desk copy for an enquiry whose listing is not identified. */
function unidentifiedOpsMessage({ linkless, from, candidateIds }) {
  return [
    HEADER,
    '',
    '⚠️ Annonce non identifiée (message sans lien).',
    quotedListing(linkless) || '(aucun détail du bien dans le message)',
    `• Client : ${displayPhone(from)}`,
    candidateIds.length
      ? `• Annonces possibles : ${candidateIds.map((id) => `#${id}`).join(', ')}`
      : '• Aucune annonce en ligne ne correspond.',
    '',
    'À traiter manuellement : le client a été invité à envoyer le lien.',
  ].join('\n');
}

/**
 * A storefront enquiry with no link whose listing we cannot name (none or
 * several live matches). Still a customer: a lead, the desk, and a reply
 * asking for the link. Same 24 h de-duplication as an identified enquiry.
 *
 * @returns {Promise<{handled: true, propertyId: null, unidentified: true}>}
 */
async function handleUnidentifiedEnquiry({ from, text, primaryWamid, linkless, candidateIds = [] }) {
  let conversation = null;
  try {
    conversation = db.getActiveConversation(from) || db.createConversation(from);
    db.recordMessage(conversation.id, 'inbound', { wamid: primaryWamid, text, intent: 'listing_enquiry' });
  } catch (err) {
    console.error(`[enquiry] could not record the conversation for ${from}: ${err.message}`);
  }

  let recent = null;
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
    recent = db.db
      .prepare(
        `SELECT id FROM leads WHERE wa_id = ? AND source = 'listing-whatsapp-enquiry' AND property_id IS NULL
            AND datetime(created_at) >= datetime(?) ORDER BY id DESC LIMIT 1`,
      )
      .get(String(from).replace(/\D/g, ''), since) || null;
  } catch (err) {
    console.error(`[enquiry] recent-lead lookup for ${from} failed: ${err.message}`);
  }

  let opsNotified = false;
  if (!recent) {
    try {
      db.createLead({
        conversation_id: conversation?.id ?? null,
        wa_id: from,
        source: 'listing-whatsapp-enquiry',
        property_id: null,
        requirements_summary: `Demande de disponibilité — annonce non identifiée : ${(linkless.facts || '').slice(0, 200)}`
          + (linkless.reference ? ` (Réf. ${linkless.reference.slice(0, 80)})` : ''),
        status: 'NEW',
      });
    } catch (err) {
      console.error(`[enquiry] could not record a lead for ${from}: ${err.message}`);
    }
    const OPS_NUMBER = opsNumber();
    if (OPS_NUMBER) {
      try {
        await deskAlert.sendDeskAlert(OPS_NUMBER, unidentifiedOpsMessage({ linkless, from, candidateIds }), {
          label: 'listing enquiry (unidentified)',
        });
        opsNotified = true;
      } catch (err) {
        console.error(`[enquiry] ops copy for ${from}'s unidentified enquiry failed: ${err.message}`);
      }
    } else {
      console.error(`[enquiry] unidentified enquiry from ${from} reached NOBODY — OPS_WHATSAPP_NUMBER is unset`);
    }
  }

  const reply = unidentifiedReply({ linkless, several: candidateIds.length > 1, reached: opsNotified || Boolean(recent) });
  try {
    await chakra.sendWhatsAppMessage(from, reply, { replyToMessageId: primaryWamid || undefined });
    if (conversation) db.recordMessage(conversation.id, 'outbound', { text: reply, sender: 'system' });
  } catch (err) {
    console.error(`[enquiry] replying to ${from} about an unidentified listing failed: ${err.message}`);
  }
  console.log(
    `[enquiry] ${from} — enquiry with no link, listing not identified `
      + `(${candidateIds.length} candidate(s), ops=${opsNotified}${recent ? `, follow-up of lead #${recent.id}` : ''})`,
  );
  return { handled: true, propertyId: null, unidentified: true };
}

module.exports = {
  handleListingEnquiry,
  parseLinklessEnquiry,
  matchEnquiryCandidates,
  carriesEnquiryOpening,
  unidentifiedReply,
  parseListingEnquiry,
  notifyEnquiry,
  customerReply,
  agentMessage,
  opsMessage,
  listingLabel,
  HEADER,
};
