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
const HEADER = '🏠 [Lukka Place] Nouvelle demande de visite';

function agentMessage({ listing, lead, viewingRequest, propertyId }) {
  const lines = [
    HEADER,
    '',
    `Bonjour ${listing?.agent_name || ''}`.trim() + ',',
    '',
    `• Bien : ${listingLabel(listing, propertyId)}`,
  ];
  if (listing?.commune) lines.push(`• Commune : ${listing.commune}`);
  if (listing?.reference) lines.push(`• Référence : ${listing.reference}`);
  lines.push(`• Client : ${lead?.name || 'Non précisé'} (${displayPhone(lead?.wa_id)})`);
  if (viewingRequest?.requested_time) lines.push(`• Créneau souhaité : ${viewingRequest.requested_time}`);
  lines.push('', `L'annonce : ${listingLink(listing, propertyId)}`, `Confirmer la visite : ${schedulerLink()}`);
  return lines.join('\n');
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
async function send(phone, text, templateParams) {
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
      );
      agentNotified = true;
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
};
