/**
 * services/contactTapAlert.js
 *
 * "Un client vous contacte" — the agent is told the moment a customer taps
 * their WhatsApp or "Appeler" button on a listing page.
 *
 * WHY (reported 2026-11-07/08)
 * A tap on a verified agent's button opens a chat or a call between two
 * personal numbers. Nothing of it reaches this engine: the desk chased an
 * agent about a customer who, it turned out, the agent had already answered on
 * WhatsApp. The tap itself IS known (web stores it in Postgres
 * `whatsapp_clicks` / `listing_events`), so web calls POST /admin/contact-taps
 * and this module:
 *
 *   1. tells the listing's agent straight away, from our number, which
 *      listing a customer is about to write or call about;
 *   2. asks them, with two buttons, whether they answered — and stores the
 *      answer on the row. That answer is the only way a direct conversation
 *      ever becomes visible here.
 *
 * WHAT IT DOES NOT KNOW
 * Who the customer is. A tap is anonymous (a visitor cookie at most), and a
 * tap is not a message: the customer may close WhatsApp without writing. The
 * text says "vient d'appuyer", never "vous a écrit".
 *
 * DELIVERY
 * A session message: it reaches an agent who messaged our number in the last
 * 24 h. Outside that window Chakra accepts it and nothing arrives (root
 * CLAUDE.md, "WhatsApp delivery"); a template is the follow-up. When the
 * buttons cannot be sent the alert still goes out as plain text, without the
 * question — telling the agent is the point, the answer is a bonus.
 *
 * NOISE
 * One alert per listing per visitor per 24 h, and at most one per listing
 * every 30 minutes whoever tapped: a popular listing must not turn into a
 * stream of messages. CONTACT_TAP_ALERT=off stops it (read at call time).
 */

const dbService = require('./db');
const propertyRepository = require('./propertyRepository');
const { listingLabel, listingLink } = require('./viewingNotifications');

const HEADER_BRAND = '🏠 [Lukka Place]';

const KINDS = ['whatsapp', 'call'];

/** Same visitor, same listing: one alert per this window. */
const SAME_VISITOR_MS = 24 * 60 * 60 * 1000;

/** Same listing, anyone: one alert per this window. */
const SAME_LISTING_MS = 30 * 60 * 1000;

const ANSWERS = { replied: 'REPLIED', nothing: 'NOTHING' };

function enabled() {
  return String(process.env.CONTACT_TAP_ALERT || '').trim().toLowerCase() !== 'off';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function buttons(alertId, kind) {
  return kind === 'call'
    ? [
      { id: `contact_tap_replied:${alertId}`, title: "✅ On s'est parlé" },
      { id: `contact_tap_nothing:${alertId}`, title: '❌ Aucun appel' },
    ]
    : [
      { id: `contact_tap_replied:${alertId}`, title: "✅ J'ai répondu" },
      { id: `contact_tap_nothing:${alertId}`, title: '❌ Rien reçu' },
    ];
}

/** The alert. `withQuestion` false is the plain-text fallback. */
function alertText({ listing, propertyId, kind, withQuestion = true }) {
  const lines = [
    `${HEADER_BRAND} Un client vous contacte`,
    '',
    `📍 Bien: ${listingLabel(listing, propertyId)}`,
    '',
    kind === 'call'
      ? "Il vient d'appuyer sur « Appeler » sur votre annonce Lukka Place : attendez-vous à son appel."
      : "Il vient d'appuyer sur « WhatsApp » sur votre annonce Lukka Place : son message devrait arriver sur ce numéro.",
  ];
  if (withQuestion) {
    lines.push(
      '',
      kind === 'call'
        ? 'Après votre échange, dites-le-nous ci-dessous : nous ne voyons pas vos appels.'
        : 'Répondez-lui vite, puis dites-le-nous ci-dessous : nous ne voyons pas vos échanges.',
    );
  }
  lines.push('', listingLink(listing, propertyId));
  return lines.join('\n');
}

const THANKS = {
  REPLIED: `${HEADER_BRAND} Merci, c'est noté. 🙏`,
  NOTHING: `${HEADER_BRAND} Merci, c'est noté : le client n'est peut-être pas allé au bout.`,
};

/**
 * Tell the listing's agent a customer just tapped their button. Never throws.
 *
 * @param {{propertyId: number|string, kind: 'whatsapp'|'call', visitorKey?: string|null, now?: Date}} input
 * @returns {Promise<{sent: boolean, reason?: string, alertId?: number, channel?: string}>}
 */
async function alertAgentOfTap({ propertyId, kind, visitorKey = null, now = new Date() } = {}) {
  try {
    if (!enabled()) return { sent: false, reason: 'disabled' };
    const id = Number.parseInt(propertyId, 10);
    if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid-listing' };
    if (!KINDS.includes(kind)) return { sent: false, reason: 'invalid-kind' };
    const visitor = visitorKey ? String(visitorKey).slice(0, 80) : null;

    // Cheap SQLite checks first: a repeated tap costs no Postgres round trip.
    const recent = dbService.recentContactTapAlert({
      propertyId: id,
      visitorKey: visitor,
      sameVisitorSince: new Date(now.getTime() - SAME_VISITOR_MS).toISOString(),
      sameListingSince: new Date(now.getTime() - SAME_LISTING_MS).toISOString(),
    });
    if (recent) return { sent: false, reason: recent };

    // The public gate (getListingContactById) and the shared agent gate:
    // verified number, routing not switched off, account not deleted.
    const listing = await propertyRepository.getListingContactById(id);
    if (!listing) return { sent: false, reason: 'listing-not-public' };
    const blocker = propertyRepository.directRoutingBlocker(listing);
    if (blocker) return { sent: false, reason: blocker };
    const agent = listing.agent_id ? await propertyRepository.getAgentContactById(listing.agent_id) : null;
    if (agent?.deleted) return { sent: false, reason: 'agent-deleted' };

    const to = digits(listing.agent_phone);
    // Written before the send, so two taps a second apart cannot both alert.
    const alertId = dbService.createContactTapAlert({
      propertyId: id,
      agentId: listing.agent_id,
      agentWa: to,
      kind,
      visitorKey: visitor,
      at: now.toISOString(),
    });

    const chakra = require('./chakra');
    let channel = null;
    try {
      await chakra.sendInteractiveButtons(to, alertText({ listing, propertyId: id, kind }), buttons(alertId, kind));
      channel = 'buttons';
    } catch (err) {
      console.warn(`[contact-tap] alert #${alertId}: interactive failed (${err.message}) — plain text`);
      try {
        await chakra.sendWhatsAppMessage(to, alertText({ listing, propertyId: id, kind, withQuestion: false }), { previewUrl: true });
        channel = 'text';
      } catch (textErr) {
        console.error(`[contact-tap] alert #${alertId} to ${to} failed: ${textErr.message}`);
      }
    }
    dbService.markContactTapAlertSent(alertId, channel);
    console.log(
      `[contact-tap] ${kind} tap on listing #${id} -> agent #${listing.agent_id}: ${channel ? `sent (${channel})` : 'NOT sent'}`,
    );
    return channel ? { sent: true, alertId, channel } : { sent: false, alertId, reason: 'send-failed' };
  } catch (err) {
    console.error(`[contact-tap] listing #${propertyId}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/** `contact_tap_replied:12` -> { answer: 'REPLIED', alertId: 12 }; anything else null. */
function parseTapButtonId(replyId) {
  const match = /^contact_tap_(replied|nothing):(\d+)$/.exec(String(replyId || '').trim());
  if (!match) return null;
  return { answer: ANSWERS[match[1]], alertId: Number.parseInt(match[2], 10) };
}

/**
 * The agent's tap on "J'ai répondu" / "Rien reçu". Only the number the alert
 * went to may answer it, and silently otherwise (an answer to a stranger
 * confirms the id is real). The first answer stands.
 */
async function handleTapButtonReply({ from, replyId }) {
  const parsed = parseTapButtonId(replyId);
  if (!parsed) return { handled: false };
  const row = dbService.getContactTapAlert(parsed.alertId);
  if (!row) return { handled: true, ignored: 'unknown-alert' };
  if (digits(from) !== digits(row.agent_wa)) {
    console.warn(`[contact-tap] '${replyId}' from ${from} refused — not the alerted agent`);
    return { handled: true, ignored: 'not-this-agent' };
  }
  const recorded = dbService.answerContactTapAlert(row.id, parsed.answer);
  try {
    // eslint-disable-next-line global-require
    await require('./chakra').sendWhatsAppMessage(digits(from), THANKS[parsed.answer]);
  } catch (err) {
    console.error(`[contact-tap] thanks to ${from} failed: ${err.message}`);
  }
  console.log(`[contact-tap] alert #${row.id}: agent answered ${parsed.answer} (recorded: ${recorded})`);
  return { handled: true, answer: parsed.answer, recorded };
}

module.exports = {
  alertAgentOfTap,
  handleTapButtonReply,
  parseTapButtonId,
  alertText,
  buttons,
  KINDS,
  SAME_VISITOR_MS,
  SAME_LISTING_MS,
};
