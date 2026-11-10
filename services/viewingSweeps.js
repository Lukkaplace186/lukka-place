/**
 * services/viewingSweeps.js
 *
 * The two time-driven halves of speed-to-lead, registered as scheduler jobs.
 *
 *   1. A viewing request an agent has not answered in 15 minutes escalates to
 *      ops AND sends the customer real alternatives.
 *   2. Two hours after a confirmed visit, the customer is asked how it went.
 *
 * WHY A SWEEP RATHER THAN A TIMER PER REQUEST
 * A setTimeout dies with the process, and this engine restarts on every
 * deploy. The state that matters therefore lives in columns on the row —
 * `sla_alerted_at`, `checkin_sent_at` — and the sweep re-derives what is due
 * from the database each minute. A deploy at minute 14 of a 15-minute SLA
 * costs nothing; the next tick picks it up.
 *
 * IDEMPOTENCE IS PER ROW, NOT PER JOB
 * `job_runs` is keyed by job name and can only answer "did the sweep run".
 * "Have we already alerted on request #47" is a fact about the request, and
 * the two must not be confused — see services/scheduler.js.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * The SLA sweep does not change `viewing_requests.status`. A request that has
 * gone unanswered is still PENDING: the agent can still accept it, and
 * inventing an "EXPIRED" state would make agent response RATE unmeasurable
 * by collapsing "never answered" into the same bucket as "answered late".
 */

const dbService = require('./db');
const propertyRepository = require('./propertyRepository');
const propertyMatchingService = require('./propertyMatching');
const viewingNotifications = require('./viewingNotifications');
const agentPerformance = require('./agentPerformance');
const agentReviews = require('./agentReviews');

/**
 * How long an agent has before a request escalates.
 *
 * Fifteen minutes is a product promise about speed-to-lead, not a technical
 * constant — which is why services/scheduler.js ticks every 60 seconds. A
 * coarser tick cannot enforce a deadline finer than itself.
 */
const SLA_MS = 15 * 60 * 1000;

/**
 * When to ask the agent "Avez-vous déjà contacté le client ?". Reported
 * 2026-11-07: an agent had answered the customer on WhatsApp from their own
 * phone while our side showed no reply. Two hours (owner decision, same day —
 * ten minutes was too soon to chase an agent): it comes AFTER the 15-minute
 * escalation, so it no longer prevents that; it tells the desk, before anyone
 * phones the agent, whether the customer was in fact reached.
 */
const CONTACT_CHECK_MS = 2 * 60 * 60 * 1000;

/**
 * Requests older than this are never asked about: a question about a
 * days-old request reads as noise, and the first run after a deploy must not
 * chase every request that ever went unanswered.
 */
const CONTACT_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** VIEWING_CONTACT_CHECK=off disables the check; unset is on. Read at call time. */
function contactCheckEnabled() {
  return String(process.env.VIEWING_CONTACT_CHECK || '').trim().toLowerCase() !== 'off';
}

/**
 * How long after the agreed slot to ask the customer how it went.
 *
 * Two hours: long enough that a visit running late has still happened, short
 * enough that the visit is fresh. Counted from `scheduled_at`, which is a
 * real instant the agent confirmed — never from `requested_time`, which is
 * free text, nor from `created_at`, which says nothing about when anyone met.
 */
const CHECKIN_AFTER_MS = 2 * 60 * 60 * 1000;

const CHECKIN_PREFIX = {
  good: 'visit_feedback_good',
  bad: 'visit_feedback_bad',
  noshow: 'visit_feedback_noshow',
};

/** Reply id -> the value stored in viewing_requests.checkin_response. */
const CHECKIN_RESPONSE_BY_ACTION = {
  good: 'GOOD',
  bad: 'BAD',
  noshow: 'AGENT_ABSENT',
};

/** The numbered fallback, in the same order as the buttons. */
const CHECKIN_RESPONSE_BY_CHOICE = { 1: 'GOOD', 2: 'BAD', 3: 'AGENT_ABSENT' };

const PENDING_CUSTOMER_KIND = 'VISIT_FEEDBACK';

const HEADER_BRAND = '🏠 [Lukka Place]';

function checkinButtons(viewingRequestId) {
  return [
    { id: `${CHECKIN_PREFIX.good}:${viewingRequestId}`, title: '👍 Bien' },
    { id: `${CHECKIN_PREFIX.bad}:${viewingRequestId}`, title: '👎 Déçu' },
    { id: `${CHECKIN_PREFIX.noshow}:${viewingRequestId}`, title: '⚠️ Agent absent' },
  ];
}

const CHECKIN_TEXT_FOOTER = [
  '',
  'Répondez :',
  '1️⃣ Bien',
  '2️⃣ Déçu',
  '3️⃣ Agent non présent',
].join('\n');

function checkinText(listingLabel, withFooter) {
  const lines = [
    `${HEADER_BRAND} Comment s'est passée votre visite ?`,
    '',
    `📍 ${listingLabel}`,
  ];
  if (withFooter) lines.push(CHECKIN_TEXT_FOOTER);
  return lines.join('\n');
}

/**
 * `visit_feedback_good:47` -> { action: 'good', viewingRequestId: 47 }.
 *
 * Returns null for anything else on purpose, exactly like
 * viewingNotifications.parseViewingButtonId — an unrelated button from
 * another feature must fall through rather than being swallowed here.
 */
function parseCheckinButtonId(replyId) {
  const match = /^visit_feedback_(good|bad|noshow):(\d+)$/.exec(String(replyId || '').trim());
  if (!match) return null;
  return { action: match[1], viewingRequestId: Number.parseInt(match[2], 10) };
}

/** Plain-text send in the shape agentReviews expects: (to, text) -> boolean. */
const sendCustomerText = (to, text) => trySendCustomer(to, text, null, 'agent rating');

/** Best-effort outbound; never throws into a sweep. */
/**
 * The post-visit check-in as a template (`VISIT_FEEDBACK_TEMPLATE`, read at
 * call time, unset by default): body {{1}} customer first name, {{2}} the
 * listing; quick replies Bien passée / Pas convaincu / Agent absent carrying
 * the visit_feedback_good|bad|noshow payloads. Only outside the customer's
 * 24 h window — inside it the session buttons arrive and read better.
 * Returns false (never throws) when it did not go, so the caller falls back.
 */
async function sendCheckinTemplate(request, listingLabel) {
  const name = (process.env.VISIT_FEEDBACK_TEMPLATE || '').trim();
  const to = String(request?.lead_wa_id || '').replace(/\D/g, '');
  if (!name || !to) return false;
  // eslint-disable-next-line global-require
  if (require('./sessionWindow').insideSessionWindow(to)) return false;
  // eslint-disable-next-line global-require
  const chakra = require('./chakra');
  const firstName = String(request.lead_name || '').trim().split(/\s+/)[0] || 'Bonjour';
  try {
    await chakra.sendTemplate(to, name, {
      languageCode: process.env.VISIT_FEEDBACK_TEMPLATE_LANG || 'fr',
      bodyParams: [firstName.slice(0, 60), String(listingLabel).replace(/\s+/g, ' ').slice(0, 120)],
      buttons: checkinButtons(request.id).map((b) => ({ id: b.id })),
    });
    return true;
  } catch (err) {
    console.warn(`[sweep] checkin #${request.id}: template '${name}' failed (${err.message}) — session buttons instead`);
    return false;
  }
}

async function trySendCustomer(phone, text, buttons, label) {
  if (!phone) return false;
  const to = String(phone).replace(/\D/g, '');
  const chakra = require('./chakra');
  if (buttons) {
    try {
      await chakra.sendInteractiveButtons(to, text, buttons);
      return true;
    } catch (err) {
      console.warn(`[sweep] ${label}: interactive failed (${err.message}) — falling back to text`);
    }
  }
  try {
    await chakra.sendWhatsAppMessage(to, buttons ? `${text}${CHECKIN_TEXT_FOOTER}` : text, {
      previewUrl: true,
    });
    return true;
  } catch (err) {
    console.error(`[sweep] ${label} to ${to} failed: ${err.message}`);
    return false;
  }
}

/**
 * Alternatives that actually match what the customer asked for.
 *
 * The lead row carries transaction_type, price range and bedrooms, and they
 * are passed through — offering a rental to somebody buying, or a $3,000/mo
 * villa to a $400 budget, reads as a system that was not listening. The
 * existing decline-path helper passed only the commune; this is the version
 * that uses what we already know.
 */
async function alternativesFor(request, excludePropertyId) {
  try {
    const { data } = await propertyMatchingService.matchProperties({
      transactionType: request.lead_transaction_type || undefined,
      commune: request.lead_commune || undefined,
      priceMin: request.lead_price_min ?? undefined,
      priceMax: request.lead_price_max ?? undefined,
      bedsMin: request.lead_bedrooms ?? undefined,
      limit: 6,
    });
    return (data || [])
      .filter((row) => String(row.id) !== String(excludePropertyId))
      .slice(0, 3);
  } catch (err) {
    console.error(`[sweep] alternatives lookup failed: ${err.message}`);
    return [];
  }
}

function alternativesText(alternatives) {
  if (!alternatives.length) {
    // An honest empty answer, never a fabricated list.
    return [
      `${HEADER_BRAND} Nous n'avons pas encore de réponse de l'agent.`,
      '',
      "Nous n'avons pas d'équivalent à vous proposer pour le moment, mais notre équipe "
        + 'revient vers vous très vite.',
    ].join('\n');
  }
  const site = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
  const lines = [
    `${HEADER_BRAND} Nous n'avons pas encore de réponse de l'agent.`,
    '',
    'En attendant, voici des biens similaires :',
    '',
  ];
  for (const row of alternatives) {
    const label = row.title || (row.reference ? `Réf: ${row.reference}` : `bien #${row.id}`);
    const price = row.price ? ` — ${Number(row.price).toLocaleString('fr-FR')} $` : '';
    lines.push(`• ${label}${price}`);
    lines.push(`  ${site}/listings/${row.slug || row.id}`);
  }
  return lines.join('\n');
}

/**
 * Why the agent did not answer, in words ops can act on.
 *
 * "The agent never received it because their number is unverified" and "the
 * agent received it and ignored it" need completely different responses, and
 * must not read the same in an alert.
 */
async function agentReachability(propertyId) {
  try {
    const listing = await propertyRepository.getListingContactById(propertyId);
    if (!listing) return { listing: null, note: 'annonce introuvable ou non approuvée' };
    if (!listing.agent_phone) return { listing, note: 'aucun agent rattaché à cette annonce' };
    if (!listing.phone_verified_at) return { listing, note: 'numéro agent non vérifié' };
    return { listing, note: null };
  } catch (err) {
    return { listing: null, note: `recherche agent impossible (${err.message})` };
  }
}

function slaOpsText(request, listing, note, alternativesSent) {
  const minutes = Math.round(SLA_MS / 60000);
  return [
    `${HEADER_BRAND} ⏱️ Demande de visite sans réponse (${minutes} min)`,
    '',
    `• Demande : #${request.id} (bien #${request.property_id})`,
    `• Bien : ${listing?.title || listing?.reference || `#${request.property_id}`}`,
    `• Client : ${request.lead_name || 'Non précisé'} (+${String(request.lead_wa_id || '').replace(/\D/g, '')})`,
    `• Créneau souhaité : ${request.requested_time || 'Non précisé'}`,
    '',
    note
      ? `⚠️ L'agent n'a jamais reçu l'alerte : ${note}.`
      : `L'agent a bien été alerté (${listing?.agent_name || `#${listing?.agent_id}`}) et n'a pas répondu.`,
    alternativesSent
      ? 'Le client a reçu des alternatives.'
      : "Le client n'a PAS pu être joint.",
  ].join('\n');
}

/**
 * Requests an agent has left unanswered past the SLA.
 *
 * @param {Date} [now]
 */
async function runSlaSweep(now = new Date()) {
  const due = dbService.listViewingRequestsAwaitingSla(SLA_MS, now.toISOString());
  let alerted = 0;

  for (const request of due) {
    const { listing, note } = await agentReachability(request.property_id);

    const alternatives = await alternativesFor(request, request.property_id);
    const slaText = alternativesText(alternatives);
    // The app first (viewingNotifications.tellCustomer); WhatsApp as before.
    const toldCustomer = await viewingNotifications.tellCustomer(request, {
      kind: 'visit_sla',
      text: alternatives.length
        ? `L'agent n'a pas encore répondu à votre demande de visite. ${alternatives.length} bien(s) similaire(s) disponibles.`
        : "L'agent n'a pas encore répondu à votre demande de visite. Notre équipe s'en occupe.",
      expectStatus: 'PENDING',
      fallback: { text: slaText, label: `sla alternatives #${request.id}` },
      whatsapp: () => trySendCustomer(request.lead_wa_id, slaText, null, `sla alternatives #${request.id}`),
    });

    await viewingNotifications.notifyOps(
      slaOpsText(request, listing, note, toldCustomer),
      `sla alert #${request.id}`,
    );

    // Stamped LAST, and unconditionally: a send that failed is still an
    // escalation that happened, and re-alerting every minute would be worse
    // than the original silence.
    dbService.markSlaAlerted(request.id, now.toISOString());
    alerted += 1;
    console.log(
      `[sweep] viewing #${request.id} breached the ${SLA_MS / 60000}min SLA — ` +
        `ops told, client told: ${toldCustomer}, alternatives: ${alternatives.length}`,
    );
  }

  return { due: due.length, alerted };
}

/**
 * Requests whose agent has said nothing for 2 hours: ask whether they
 * already contacted the customer directly. Stamped whether or not the send
 * went out — once per request, like the SLA stamp.
 */
async function runContactCheckSweep(now = new Date()) {
  if (!contactCheckEnabled()) return { due: 0, asked: 0, disabled: true };
  const due = dbService.listViewingRequestsDueForContactCheck(CONTACT_CHECK_MS, now.toISOString(), CONTACT_CHECK_MAX_AGE_MS);
  let asked = 0;
  for (const request of due) {
    const result = await viewingNotifications.askAgentContactCheck(request.id);
    dbService.markContactCheckSent(request.id, now.toISOString());
    if (result.sent) asked += 1;
    console.log(
      `[sweep] viewing #${request.id} contact check: ${result.sent ? `sent (${result.channel})` : `not sent — ${result.reason}`}`,
    );
  }
  return { due: due.length, asked };
}

/** Confirmed visits whose 2-hour check-in window has opened. */
async function runCheckinSweep(now = new Date()) {
  const due = dbService.listViewingRequestsDueForCheckin(CHECKIN_AFTER_MS, now.toISOString());
  let sent = 0;

  for (const request of due) {
    let label = `bien #${request.property_id}`;
    try {
      const listing = await propertyRepository.getListingContactById(request.property_id);
      if (listing?.title) label = listing.title;
      else if (listing?.reference) label = `Réf: ${listing.reference}`;
    } catch {
      // The check-in is worth sending even if the listing lookup fails; the
      // customer knows which property they visited.
    }

    // Outside the customer's 24 h window (a web-form visitor never wrote to
    // us) the session buttons never arrive: VISIT_FEEDBACK_TEMPLATE, approved
    // with the three quick replies in order, carries the same payloads.
    // In the app the visit card carries the same three answers (VisitCheckin):
    // pushed, no WhatsApp copy. Without the app, WhatsApp as before.
    const ok = await viewingNotifications.tellCustomer(request, {
      kind: 'visit_checkin',
      text: `Votre visite de ${label} s'est-elle bien passée ? Dites-le-nous en un geste.`,
      urgent: false,
      whatsapp: async () => (await sendCheckinTemplate(request, label))
        || (await trySendCustomer(
          request.lead_wa_id,
          checkinText(label, false),
          checkinButtons(request.id),
          `checkin #${request.id}`,
        )),
    });

    // Claims the customer's next message, so a typed "1" resolves without a
    // button id. Set regardless of channel: the text fallback is precisely
    // the case that needs it.
    if (request.lead_wa_id) {
      dbService.setPendingCustomerAction({
        waId: request.lead_wa_id,
        kind: PENDING_CUSTOMER_KIND,
        viewingRequestId: request.id,
      });
    }

    dbService.markCheckinSent(request.id, now.toISOString());
    sent += 1;
    console.log(`[sweep] viewing #${request.id} check-in sent: ${ok}`);
  }

  return { due: due.length, sent };
}

// ---------------------------------------------------------------------------
// The customer's answer
// ---------------------------------------------------------------------------

const FEEDBACK_THANKS = {
  GOOD: `${HEADER_BRAND} Merci ! Ravis que la visite se soit bien passée. 🙌`,
  BAD: [
    `${HEADER_BRAND} Merci de votre retour — nous le transmettons à notre équipe.`,
    '',
    "Qu'est-ce qui n'a pas convenu ?",
    '1️⃣ Prix trop élevé',
    '2️⃣ Emplacement',
    '3️⃣ Conditions (garantie, contrat…)',
    '4️⃣ Autre',
  ].join('\n'),
  AGENT_ABSENT:
    `${HEADER_BRAND} Nous sommes désolés, ce n'est pas normal. Notre équipe vous rappelle.`,
};

/**
 * Why a visit the customer attended did not work out — asked only after 👎.
 *
 * These are the CUSTOMER's reasons and the reason they are collected here:
 * PRICE_TOO_HIGH, LOCATION_DESELECTED and TERMS_UNACCEPTABLE are things only
 * the person who visited can say. The agent's decline survey keeps its own
 * three options (services/viewingNotifications.js), and the two are stored
 * with `decline_reason_by` so they never blur into one statistic.
 */
const PENDING_FALLOFF_KIND = 'VISIT_FALLOFF_REASON';
const FALLOFF_REASON_BY_CHOICE = {
  1: 'PRICE_TOO_HIGH',
  2: 'LOCATION_DESELECTED',
  3: 'TERMS_UNACCEPTABLE',
  4: 'OTHER',
};
const FALLOFF_THANKS = `${HEADER_BRAND} Merci, c'est noté. Répondez à ce message si vous souhaitez que nous vous proposions d'autres biens.`;

/** After a visit that did not work out: real alternatives, or the honest thanks when there are none. */
function falloffNextText(alternatives) {
  if (!alternatives.length) return FALLOFF_THANKS;
  const site = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
  const lines = [`${HEADER_BRAND} Merci, c'est noté. Voici d'autres biens qui correspondent à votre recherche :`, ''];
  for (const row of alternatives) {
    const label = row.title || (row.reference ? `Réf: ${row.reference}` : `bien #${row.id}`);
    const price = row.price ? ` — ${Number(row.price).toLocaleString('fr-FR')} $` : '';
    lines.push(`• ${label}${price}`);
    lines.push(`  ${site}/listings/${row.slug || row.id}`);
  }
  lines.push('', 'Répondez à ce message si vous souhaitez que nous cherchions autre chose avec vous.');
  return lines.join('\n');
}

/**
 * "1".."4", keycaps, or the words themselves. Short replies only — a customer
 * who sends a real message while the question is open must reach intake.
 */
function parseFalloffReason(text) {
  const raw = String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[️⃣]/g, '')
    .replace(/[.)\]]+$/, '')
    .trim();
  if (!raw || raw.length > 60) return null;
  if (/^[1-4]$/.test(raw)) return FALLOFF_REASON_BY_CHOICE[raw];
  if (/\b(prix|cher|chere|trop\s+eleve|budget)\b/.test(raw)) return 'PRICE_TOO_HIGH';
  if (/\b(emplacement|quartier|loin|endroit|zone|localisation|commune)\b/.test(raw)) return 'LOCATION_DESELECTED';
  if (/\b(conditions?|garantie|contrat|avance|commission|caution)\b/.test(raw)) return 'TERMS_UNACCEPTABLE';
  if (/^autre/.test(raw)) return 'OTHER';
  return null;
}

/**
 * Record one answer and tell whoever needs to know.
 *
 * AUTHORISATION IS THE LEAD'S OWN NUMBER, not the listing's agent. This is the
 * mirror image of the agent feedback loop's rule and must not reuse its
 * resolveContext: the only person entitled to say how a visit went is the
 * customer who attended it.
 */
async function recordCheckinResponse({ from, viewingRequestId, response, notifyCustomer = true }) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { handled: true, ignored: 'unknown-request' };

  const senderDigits = String(from || '').replace(/\D/g, '');
  const leadDigits = String(request.lead_wa_id || '').replace(/\D/g, '');
  if (!leadDigits || leadDigits !== senderDigits) {
    // Silent, for the same reason the agent loop is: answering "that belongs
    // to somebody else" confirms the id is real.
    console.warn(`[sweep] check-in reply for #${viewingRequestId} from ${from} refused`);
    return { handled: true, ignored: 'not-this-requests-customer' };
  }

  dbService.setCheckinResponse(request.id, response);
  dbService.clearPendingCustomerAction(from);

  // 👍 and 👎 both say the visit HAPPENED — that is what COMPLETED means.
  // "Agent absent" says the opposite and must never complete a request.
  if (response === 'GOOD' || response === 'BAD') {
    try {
      dbService.updateViewingRequest(request.id, { status: 'COMPLETED' });
    } catch (err) {
      console.error(`[sweep] viewing #${request.id} COMPLETED update failed: ${err.message}`);
    }
    await agentPerformance.logOutcome({ viewingRequestId: request.id, outcome: 'COMPLETED' });
  }
  // Answered on the web (notifyCustomer: false), the page asks the reason
  // itself — a WhatsApp question as well would be the same question twice.
  if (response === 'BAD' && notifyCustomer) {
    dbService.setPendingCustomerAction({
      waId: from,
      kind: PENDING_FALLOFF_KIND,
      viewingRequestId: request.id,
    });
  }

  // A completed visit is a real lead milestone, and VIEWING_COMPLETED has sat
  // in LEAD_STATUSES unreachable by any code path until now.
  try {
    dbService.updateLeadStatus(request.lead_row_id, 'VIEWING_COMPLETED');
  } catch (err) {
    console.error(`[sweep] lead #${request.lead_row_id} status update failed: ${err.message}`);
  }

  if (notifyCustomer) {
    // 👍: the thank-you and "notez l'agent" go as one message. 👎: the
    // property question comes first, and the agent rating follows its answer
    // (recordFalloffReason) — the house disappointing is not the agent's fault.
    const asked = response === 'GOOD'
      && await agentReviews.askForRating(
        dbService.getViewingRequestWithLead(request.id),
        { prefix: FEEDBACK_THANKS.GOOD, send: sendCustomerText },
      );
    if (!asked) await trySendCustomer(request.lead_wa_id, FEEDBACK_THANKS[response], null, 'checkin thanks');
  }

  if (response === 'AGENT_ABSENT') {
    // The one answer that needs a human the same day.
    await viewingNotifications.notifyOps(
      [
        `${HEADER_BRAND} ⚠️ Agent non présent à une visite`,
        '',
        `• Demande : #${request.id} (bien #${request.property_id})`,
        `• Client : ${request.lead_name || 'Non précisé'} (+${leadDigits})`,
        `• Créneau : ${request.scheduled_at || request.requested_time || 'Non précisé'}`,
        '',
        'À rappeler aujourd\'hui.',
      ].join('\n'),
      `no-show #${request.id}`,
    );
  }

  console.log(`[sweep] viewing #${request.id} feedback: ${response}`);
  return { handled: true, action: 'checkin-response', response, viewingRequestId: request.id };
}

/** The customer's reason after 👎, same authorisation rule as the check-in itself. */
async function recordFalloffReason({ from, viewingRequestId, code, notifyCustomer = true }) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { handled: true, ignored: 'unknown-request' };
  const senderDigits = String(from || '').replace(/\D/g, '');
  const leadDigits = String(request.lead_wa_id || '').replace(/\D/g, '');
  if (!leadDigits || leadDigits !== senderDigits) {
    return { handled: true, ignored: 'not-this-requests-customer' };
  }

  dbService.setViewingDeclineCode(request.id, code, 'CUSTOMER');
  dbService.clearPendingCustomerAction(from);
  if (notifyCustomer) {
    const asked = await agentReviews.askForRating(
      dbService.getViewingRequestWithLead(request.id),
      { prefix: `${HEADER_BRAND} Merci, c'est noté.`, send: sendCustomerText },
    );
    // The next step comes from us, not "write back if you want more"
    // (2026-11-07): real homes matching what they asked for, or an honest
    // "nothing equivalent yet". The customer just wrote to us, so a session
    // message arrives.
    if (!asked) {
      const alternatives = await alternativesFor(request, request.property_id);
      await trySendCustomer(request.lead_wa_id, falloffNextText(alternatives), null, 'falloff next step');
    }
  }
  console.log(`[sweep] viewing #${request.id} fall-through reason (customer): ${code}`);
  return { handled: true, action: 'falloff-reason', code, viewingRequestId: request.id };
}

/** A tapped check-in button. */
async function handleCheckinButtonReply({ from, replyId }) {
  const parsed = parseCheckinButtonId(replyId);
  if (!parsed) return { handled: false };
  return recordCheckinResponse({
    from,
    viewingRequestId: parsed.viewingRequestId,
    response: CHECKIN_RESPONSE_BY_ACTION[parsed.action],
  });
}

/**
 * A typed "1" / "2" / "3" from a customer we asked.
 *
 * Returns `{ handled: false }` for anything that is not a plausible answer, so
 * an ordinary message still reaches the normal pipeline.
 */
async function handleCustomerTextReply({ from, text, hasMedia = false }) {
  const pending = dbService.getPendingCustomerAction(from);
  if (!pending) return { handled: false };

  if (pending.kind === agentReviews.PENDING_RATING_KIND || pending.kind === agentReviews.PENDING_COMMENT_KIND) {
    // Photos are a listing in this pipeline, never a star or a comment.
    if (hasMedia) return { handled: false };
    return agentReviews.handlePendingText({
      from,
      text,
      pending,
      send: sendCustomerText,
      notifyOps: viewingNotifications.notifyOps,
    });
  }

  if (pending.kind === PENDING_FALLOFF_KIND) {
    const code = parseFalloffReason(text);
    if (!code) return { handled: false };
    return recordFalloffReason({ from, viewingRequestId: pending.viewing_request_id, code });
  }

  // "oui" / "non" / 1 / 2 to the agent's new-time proposal.
  if (pending.kind === viewingNotifications.PROPOSAL_PENDING_KIND) {
    if (hasMedia) return { handled: false };
    return viewingNotifications.handleProposalTextReply({ from, text, pending });
  }

  if (pending.kind !== PENDING_CUSTOMER_KIND) return { handled: false };

  const choice = viewingNotifications.parseNumberedChoice(text);
  if (!choice) return { handled: false };

  return recordCheckinResponse({
    from,
    viewingRequestId: pending.viewing_request_id,
    response: CHECKIN_RESPONSE_BY_CHOICE[choice],
  });
}

// ---------------------------------------------------------------------------
// Scheduler jobs
// ---------------------------------------------------------------------------

/**
 * `shouldRun` is deliberately the cheap "is anything due?" question rather
 * than `true`. It runs once a minute forever, and answering honestly keeps
 * `job_runs` a record of real work instead of a heartbeat.
 */
const slaJob = {
  name: 'viewing-sla',
  shouldRun: (now = new Date()) =>
    dbService.listViewingRequestsAwaitingSla(SLA_MS, now.toISOString()).length > 0,
  run: () => runSlaSweep(),
};

// ---------------------------------------------------------------------------
// The customer has not answered the agent's new time (2026-11-09)
// ---------------------------------------------------------------------------

/** Silence after a proposal before the one reminder and the desk alert. */
const PROPOSAL_FOLLOWUP_MS = 3 * 60 * 60 * 1000;
/** Proposals older than this are never chased (a deploy must not wake old ones). */
const PROPOSAL_FOLLOWUP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** `VIEWING_PROPOSAL_FOLLOWUP=off` stops it; unset is on. Read at call time. */
function proposalFollowupEnabled() {
  return String(process.env.VIEWING_PROPOSAL_FOLLOWUP || '').trim().toLowerCase() !== 'off';
}

/** Kinshasa daytime (UTC+1, no DST): nobody is reminded about a visit at 2 am. */
function isKinshasaDaytime(now = new Date()) {
  const hour = (now.getUTCHours() + 1) % 24;
  return hour >= 8 && hour < 20;
}

/**
 * One reminder to the customer (the same proposal, buttons included) and one
 * desk alert per proposal left unanswered for PROPOSAL_FOLLOWUP_MS. Stamped
 * proposal_reminded_at whatever the send did, so it is never repeated; a new
 * proposal from the agent starts the clock again.
 */
async function runProposalFollowupSweep(now = new Date()) {
  if (!proposalFollowupEnabled() || !isKinshasaDaytime(now)) return { reminded: 0 };
  const due = dbService.listViewingProposalsAwaitingCustomer(
    PROPOSAL_FOLLOWUP_MS, now.toISOString(), PROPOSAL_FOLLOWUP_MAX_AGE_MS,
  );
  let reminded = 0;
  for (const row of due) {
    const request = dbService.getViewingRequestWithLead(row.id);
    if (!request) continue;
    dbService.markViewingProposalReminded(request.id, now.toISOString());
    let listing = null;
    try {
      listing = await propertyRepository.getListingContactById(request.property_id);
    } catch (err) {
      console.error(`[sweep] proposal follow-up: listing #${request.property_id} lookup failed: ${err.message}`);
    }
    const told = await viewingNotifications.sendProposalToCustomer({
      request, listing, propertyId: request.property_id, proposed: request.requested_time, reminder: true,
    });
    const hours = Math.round(PROPOSAL_FOLLOWUP_MS / 3600000);
    await viewingNotifications.notifyOps(
      viewingNotifications.opsProposalText({
        listing,
        request,
        propertyId: request.property_id,
        proposed: request.requested_time,
        headline: `⏳ Le client n'a pas répondu au nouveau créneau (${hours} h)`,
        footer: told ? 'Rappel envoyé au client. À appeler si toujours rien.' : "⚠️ Le rappel au client n'a pas pu partir — à appeler.",
      }),
      'proposal follow-up ops copy',
    );
    console.log(`[sweep] viewing #${request.id} proposal unanswered — client reminded: ${told}`);
    reminded += 1;
  }
  return { reminded };
}

const proposalFollowupJob = {
  name: 'viewing-proposal-followup',
  shouldRun: (now = new Date()) =>
    proposalFollowupEnabled()
    && isKinshasaDaytime(now)
    && dbService.listViewingProposalsAwaitingCustomer(PROPOSAL_FOLLOWUP_MS, now.toISOString(), PROPOSAL_FOLLOWUP_MAX_AGE_MS).length > 0,
  run: () => runProposalFollowupSweep(),
};

const contactCheckJob = {
  name: 'viewing-contact-check',
  shouldRun: (now = new Date()) =>
    contactCheckEnabled()
    && dbService.listViewingRequestsDueForContactCheck(CONTACT_CHECK_MS, now.toISOString(), CONTACT_CHECK_MAX_AGE_MS).length > 0,
  run: () => runContactCheckSweep(),
};

const checkinJob = {
  name: 'viewing-checkin',
  shouldRun: (now = new Date()) =>
    dbService.listViewingRequestsDueForCheckin(CHECKIN_AFTER_MS, now.toISOString()).length > 0,
  run: () => runCheckinSweep(),
};

module.exports = {
  runSlaSweep,
  runContactCheckSweep,
  contactCheckJob,
  CONTACT_CHECK_MS,
  CONTACT_CHECK_MAX_AGE_MS,
  runCheckinSweep,
  handleCheckinButtonReply,
  handleCustomerTextReply,
  // The Espace Client answers through these too (routes/admin.js).
  recordCheckinResponse,
  recordFalloffReason,
  parseCheckinButtonId,
  checkinButtons,
  checkinText,
  alternativesText,
  falloffNextText,
  parseFalloffReason,
  FALLOFF_REASON_BY_CHOICE,
  PENDING_FALLOFF_KIND,
  FEEDBACK_THANKS,
  slaJob,
  checkinJob,
  proposalFollowupJob,
  runProposalFollowupSweep,
  PROPOSAL_FOLLOWUP_MS,
  isKinshasaDaytime,
  SLA_MS,
  CHECKIN_AFTER_MS,
  CHECKIN_PREFIX,
};
