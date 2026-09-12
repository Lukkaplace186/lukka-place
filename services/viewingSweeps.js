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

/**
 * How long an agent has before a request escalates.
 *
 * Fifteen minutes is a product promise about speed-to-lead, not a technical
 * constant — which is why services/scheduler.js ticks every 60 seconds. A
 * coarser tick cannot enforce a deadline finer than itself.
 */
const SLA_MS = 15 * 60 * 1000;

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

/** Best-effort outbound; never throws into a sweep. */
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
    const toldCustomer = await trySendCustomer(
      request.lead_wa_id,
      alternativesText(alternatives),
      null,
      `sla alternatives #${request.id}`,
    );

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

    const ok = await trySendCustomer(
      request.lead_wa_id,
      checkinText(label, false),
      checkinButtons(request.id),
      `checkin #${request.id}`,
    );

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
  BAD: `${HEADER_BRAND} Merci de votre retour — nous le transmettons à notre équipe.`,
  AGENT_ABSENT:
    `${HEADER_BRAND} Nous sommes désolés, ce n'est pas normal. Notre équipe vous rappelle.`,
};

/**
 * Record one answer and tell whoever needs to know.
 *
 * AUTHORISATION IS THE LEAD'S OWN NUMBER, not the listing's agent. This is the
 * mirror image of the agent feedback loop's rule and must not reuse its
 * resolveContext: the only person entitled to say how a visit went is the
 * customer who attended it.
 */
async function recordCheckinResponse({ from, viewingRequestId, response }) {
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

  // A completed visit is a real lead milestone, and VIEWING_COMPLETED has sat
  // in LEAD_STATUSES unreachable by any code path until now.
  try {
    dbService.updateLeadStatus(request.lead_row_id, 'VIEWING_COMPLETED');
  } catch (err) {
    console.error(`[sweep] lead #${request.lead_row_id} status update failed: ${err.message}`);
  }

  await trySendCustomer(request.lead_wa_id, FEEDBACK_THANKS[response], null, 'checkin thanks');

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
async function handleCustomerTextReply({ from, text }) {
  const pending = dbService.getPendingCustomerAction(from);
  if (!pending || pending.kind !== PENDING_CUSTOMER_KIND) return { handled: false };

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

const checkinJob = {
  name: 'viewing-checkin',
  shouldRun: (now = new Date()) =>
    dbService.listViewingRequestsDueForCheckin(CHECKIN_AFTER_MS, now.toISOString()).length > 0,
  run: () => runCheckinSweep(),
};

module.exports = {
  runSlaSweep,
  runCheckinSweep,
  handleCheckinButtonReply,
  handleCustomerTextReply,
  parseCheckinButtonId,
  checkinButtons,
  checkinText,
  alternativesText,
  slaJob,
  checkinJob,
  SLA_MS,
  CHECKIN_AFTER_MS,
  CHECKIN_PREFIX,
};
