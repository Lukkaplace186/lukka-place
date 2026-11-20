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
 * INTENT (2026-11-16, owner: "we want to know if the customer is simply
 * enquiring or requested an appointment")
 * Since WhatsApp goes straight to the agent, the tap is all we see. Web now
 * asks the customer, before WhatsApp opens, what they want — visit, "toujours
 * disponible ?", or another question (components/WhatsAppIntentSheet.js) —
 * and pre-types the matching message. The choice arrives here as `intent`,
 * is stored on the alert, and leads the agent's message ("Un client veut
 * visiter votre bien"). A visit request gets a third answer, « Visite
 * fixée » (VISIT_SET), so the console can count appointments made, not only
 * replies. The approved template carries the intent in {{3}} ("pour : une
 * demande de visite — Appartement à Limete"): no new template needed. A call
 * tap has no intent (nothing is asked before the dialer opens).
 *
 * NOISE
 * One alert per listing per visitor per 24 h, and at most one per listing
 * every 30 minutes whoever tapped: a popular listing must not turn into a
 * stream of messages. CONTACT_TAP_ALERT=off stops it (read at call time).
 *
 * THE CUSTOMER'S NUMBER, WHEN THEY GIVE IT (2026-11-20, owner)
 * « Je veux le visiter » now offers two optional fields, name and WhatsApp
 * number, "pour recevoir la confirmation de la visite". When filled:
 *   - the alert names the customer (session text, and the template's {{3}});
 *   - a lead is made with that number (source 'listing-direct-visit', the
 *     agent's Demandes; the 24 h « Un agent vous a-t-il contacté ? » follows);
 *   - a tap that would be deduped still attaches the number to the alert it
 *     was deduped against, and a 30-minute listing dedupe (another visitor)
 *     never swallows a customer who left their number.
 * « Visite fixée » then creates the visit (services/directVisit.js) under that
 * lead, so the customer gets the confirmation, the reminders and the check-in.
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

const ANSWERS = { replied: 'REPLIED', nothing: 'NOTHING', visit: 'VISIT_SET' };

/** What the customer chose before WhatsApp opened (web lib/whatsappIntent.js). */
const INTENTS = ['visit', 'video_visit', 'availability', 'question'];

/** Both ask for an appointment: the agent gets the « Visite fixée » answer. */
const VISIT_INTENTS = ['visit', 'video_visit'];

/** The intent as the agent reads it, in the alert's title and the template's {{3}}. */
const INTENT_TITLE = {
  visit: 'Un client veut visiter votre bien',
  video_visit: 'Un client veut visiter votre bien par appel vidéo',
  availability: 'Un client demande si votre bien est disponible',
  question: 'Un client a une question sur votre bien',
};
const INTENT_PURPOSE = {
  visit: 'une demande de visite',
  video_visit: 'une visite par appel vidéo WhatsApp',
  availability: 'savoir si le bien est disponible',
  question: 'une question',
};

function cleanIntent(value) {
  return INTENTS.includes(value) ? value : null;
}

function enabled() {
  return String(process.env.CONTACT_TAP_ALERT || '').trim().toLowerCase() !== 'off';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** A customer number as sent by web (E.164 digits); 7–15 digits or nothing. */
function cleanCustomerPhone(value) {
  const d = digits(value);
  return d.length >= 7 && d.length <= 15 ? d : null;
}

function cleanCustomerName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return name || null;
}

/** "Kera · +243812345678" for the agent, or null. */
function customerLabel({ name = null, phone = null } = {}) {
  if (!phone) return null;
  return `${name ? `${name} · ` : ''}+${phone}`;
}

/**
 * The lead a customer's number makes at the tap (once per alert): the agent's
 * Demandes, the 24 h follow-up to the customer, the visit's lead later.
 */
function leadForCustomer({ alertId, propertyId, agentId, name, phone }) {
  try {
    const existing = dbService.getContactTapAlert(alertId);
    if (existing?.lead_id) return existing.lead_id;
    const lead = dbService.createDirectContactLead({
      waId: phone,
      name,
      propertyId,
      agentId,
      status: 'NEW',
      summary: 'Demande de visite via le bouton WhatsApp de l’annonce (le client écrit à l’agent sur WhatsApp)',
    });
    dbService.setContactTapAlertLead(alertId, lead.id);
    return lead.id;
  } catch (err) {
    console.error(`[contact-tap] alert #${alertId}: lead for the customer's number failed — ${err.message}`);
    return null;
  }
}

function buttons(alertId, kind, intent = null) {
  if (kind !== 'call' && VISIT_INTENTS.includes(intent)) {
    return [
      { id: `contact_tap_visit:${alertId}`, title: '📅 Visite fixée' },
      { id: `contact_tap_replied:${alertId}`, title: "✅ J'ai répondu" },
      { id: `contact_tap_nothing:${alertId}`, title: '❌ Rien reçu' },
    ];
  }
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
function alertText({ listing, propertyId, kind, intent = null, withQuestion = true, customer = null }) {
  const wanted = kind === 'call' ? null : cleanIntent(intent);
  const lines = [
    `${HEADER_BRAND} ${wanted ? INTENT_TITLE[wanted] : 'Un client vous contacte'}`,
    '',
    `📍 Bien: ${listingLabel(listing, propertyId)}`,
    ...(customer ? [`👤 Client: ${customer}`] : []),
    '',
    kind === 'call'
      ? "Il vient d'appuyer sur « Appeler » sur votre annonce Lukka Place : attendez-vous à son appel."
      : "Il vient d'appuyer sur « WhatsApp » sur votre annonce Lukka Place : son message devrait arriver sur ce numéro.",
  ];
  if (withQuestion) {
    let ask;
    if (kind === 'call') ask = 'Après votre échange, dites-le-nous ci-dessous : nous ne voyons pas vos appels.';
    else if (wanted === 'video_visit') ask = 'Proposez-lui un créneau et appelez-le en vidéo sur WhatsApp depuis le bien, puis dites-le-nous ci-dessous : nous ne voyons pas vos échanges.';
    else if (wanted === 'visit') ask = 'Proposez-lui un créneau, puis dites-le-nous ci-dessous : nous ne voyons pas vos échanges.';
    else ask = 'Répondez-lui vite, puis dites-le-nous ci-dessous : nous ne voyons pas vos échanges.';
    lines.push('', ask);
  }
  lines.push('', listingLink(listing, propertyId));
  return lines.join('\n');
}

const THANKS = {
  REPLIED: `${HEADER_BRAND} Merci, c'est noté. 🙏`,
  NOTHING: `${HEADER_BRAND} Merci, c'est noté : le client n'est peut-être pas allé au bout.`,
  VISIT_SET: `${HEADER_BRAND} Merci, visite notée. Bonne visite ! 🙏`,
};

/**
 * Tell the listing's agent a customer just tapped their button. Never throws.
 *
 * @param {{propertyId: number|string, kind: 'whatsapp'|'call', visitorKey?: string|null,
 *   intent?: 'visit'|'video_visit'|'availability'|'question'|null, now?: Date}} input
 * @returns {Promise<{sent: boolean, reason?: string, alertId?: number, channel?: string}>}
 */
async function alertAgentOfTap({
  propertyId, kind, visitorKey = null, intent = null, customerName = null, customerPhone = null, now = new Date(),
} = {}) {
  try {
    if (!enabled()) return { sent: false, reason: 'disabled' };
    const id = Number.parseInt(propertyId, 10);
    if (!Number.isFinite(id) || id <= 0) return { sent: false, reason: 'invalid-listing' };
    if (!KINDS.includes(kind)) return { sent: false, reason: 'invalid-kind' };
    const visitor = visitorKey ? String(visitorKey).slice(0, 80) : null;
    const wanted = kind === 'call' ? null : cleanIntent(intent);
    // The number is only asked with « Je veux le visiter »; anything else carries none.
    const phone = VISIT_INTENTS.includes(wanted) ? cleanCustomerPhone(customerPhone) : null;
    const name = phone ? cleanCustomerName(customerName) : null;

    // Cheap SQLite checks first: a repeated tap costs no Postgres round trip.
    const sameVisitorSince = new Date(now.getTime() - SAME_VISITOR_MS).toISOString();
    const recent = dbService.recentContactTapAlert({
      propertyId: id,
      visitorKey: visitor,
      sameVisitorSince,
      sameListingSince: new Date(now.getTime() - SAME_LISTING_MS).toISOString(),
    });
    if (recent === 'duplicate-visitor' && phone) {
      // Same customer again, this time with their number: it goes on the
      // alert the agent already has, and the agent is told who it is.
      const earlier = dbService.findContactTapAlertForVisitor({ propertyId: id, visitorKey: visitor, since: sameVisitorSince });
      if (earlier && !earlier.customer_phone) {
        dbService.attachCustomerToContactTapAlert(earlier.id, { name, phone });
        leadForCustomer({ alertId: earlier.id, propertyId: id, agentId: earlier.agent_id, name, phone });
        try {
          // eslint-disable-next-line global-require
          await require('./chakra').sendWhatsAppMessage(earlier.agent_wa, [
            `${HEADER_BRAND} Le client qui veut visiter votre bien a laissé son numéro`,
            '',
            `👤 ${customerLabel({ name, phone })}`,
            `📍 Bien n° ${id}`,
          ].join('\n'));
        } catch (err) {
          console.warn(`[contact-tap] alert #${earlier.id}: customer-number note not sent (${err.message})`);
        }
        return { sent: false, reason: recent, alertId: earlier.id, customerAttached: true };
      }
    }
    // Another visitor's alert 30 min ago never swallows a customer who left their number.
    if (recent && !(recent === 'recent-alert' && phone)) return { sent: false, reason: recent };

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
      intent: wanted,
      customerName: name,
      customerPhone: phone,
      at: now.toISOString(),
    });
    const customer = customerLabel({ name, phone });
    if (phone) leadForCustomer({ alertId, propertyId: id, agentId: listing.agent_id, name, phone });

    const chakra = require('./chakra');
    let channel = null;
    // Outside the agent's 24 h window: CONTACT_TAP_TEMPLATE
    // (`client_vous_contacte_agent`: agent, which button, listing; quick
    // replies « Oui, on s'est parlé » / « Non, rien reçu » = the same payloads).
    // eslint-disable-next-line global-require
    const { sendTemplateOutsideWindow, firstName } = require('./templateOutsideWindow');
    // A visit request outside the window: CONTACT_TAP_VISIT_TEMPLATE when
    // approved (draft `client_veut_visiter_agent`: agent, listing; quick
    // replies « Visite fixée » / « J'ai répondu » / « Rien reçu » = the three
    // payloads), so the appointment can be answered from a cold chat too.
    // Unset → the two-button template below, intent in {{3}}.
    // A video visit rides the same template, the mode written after the listing.
    if (VISIT_INTENTS.includes(wanted) && await sendTemplateOutsideWindow({
      to,
      envName: 'CONTACT_TAP_VISIT_TEMPLATE',
      bodyParams: [
        firstName(listing.agent_name, 'cher partenaire'),
        [
          wanted === 'video_visit' ? `${listingLabel(listing, id)} · par appel vidéo` : listingLabel(listing, id),
          customer ? `client : ${customer}` : null,
        ].filter(Boolean).join(' · '),
      ],
      buttons: buttons(alertId, kind, wanted),
      label: `contact tap #${alertId} (visit)`,
      now,
    })) {
      channel = 'template';
    }
    if (!channel && await sendTemplateOutsideWindow({
      to,
      envName: 'CONTACT_TAP_TEMPLATE',
      // {{3}} follows "pour :" — the customer's intent leads when they chose one.
      bodyParams: [
        firstName(listing.agent_name, 'cher partenaire'),
        kind === 'call' ? 'Appeler' : 'WhatsApp',
        [
          wanted ? `${INTENT_PURPOSE[wanted]} — ${listingLabel(listing, id)}` : listingLabel(listing, id),
          customer ? `client : ${customer}` : null,
        ].filter(Boolean).join(' · '),
      ],
      // The approved template has two quick replies: never the visit button.
      buttons: buttons(alertId, kind),
      label: `contact tap #${alertId}`,
      now,
    })) {
      channel = 'template';
    }
    if (!channel) try {
      await chakra.sendInteractiveButtons(to, alertText({ listing, propertyId: id, kind, intent: wanted, customer }), buttons(alertId, kind, wanted));
      channel = 'buttons';
    } catch (err) {
      console.warn(`[contact-tap] alert #${alertId}: interactive failed (${err.message}) — plain text`);
      try {
        await chakra.sendWhatsAppMessage(to, alertText({
          listing, propertyId: id, kind, intent: wanted, withQuestion: false, customer,
        }), { previewUrl: true });
        channel = 'text';
      } catch (textErr) {
        console.error(`[contact-tap] alert #${alertId} to ${to} failed: ${textErr.message}`);
      }
    }
    dbService.markContactTapAlertSent(alertId, channel);
    console.log(
      `[contact-tap] ${kind} tap${wanted ? ` (${wanted})` : ''} on listing #${id} -> agent #${listing.agent_id}: ${channel ? `sent (${channel})` : 'NOT sent'}`,
    );
    return channel ? { sent: true, alertId, channel } : { sent: false, alertId, reason: 'send-failed' };
  } catch (err) {
    console.error(`[contact-tap] listing #${propertyId}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/** `contact_tap_replied:12` -> { answer: 'REPLIED', alertId: 12 } (visit -> VISIT_SET); anything else null. */
function parseTapButtonId(replyId) {
  const match = /^contact_tap_(replied|nothing|visit):(\d+)$/.exec(String(replyId || '').trim());
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
  if (parsed.answer === 'VISIT_SET') {
    // The visit itself, then « Quand a lieu la visite ? » (services/directVisit.js).
    // eslint-disable-next-line global-require
    const visit = await require('./directVisit').onVisitSet(row, { from });
    if (visit.ok) {
      console.log(`[contact-tap] alert #${row.id}: agent answered VISIT_SET — visit #${visit.viewingRequestId}`);
      return { handled: true, answer: parsed.answer, recorded, viewingRequestId: visit.viewingRequestId };
    }
  }
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
  cleanIntent,
  cleanCustomerPhone,
  customerLabel,
  THANKS,
  HEADER_BRAND,
  VISIT_INTENTS,
  KINDS,
  INTENTS,
  SAME_VISITOR_MS,
  SAME_LISTING_MS,
};
