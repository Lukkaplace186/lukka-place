/**
 * services/directVisit.js
 *
 * A visit agreed on the agent's own WhatsApp becomes a visit here (owner,
 * 2026-11-20: "the contacts page shows customers asking for visits, but this
 * is not translated to our viewing page").
 *
 * Since 2026-11-15 the listing's WhatsApp button opens the agent's own chat,
 * so a customer who chooses « Je veux le visiter » never creates a
 * viewing_requests row — and every visit follow-up (the agent's "la visite
 * a-t-elle eu lieu ?", the bon de visite, the customer's check-in and rating,
 * "déjà loué" taking the listing off, the closing price) hangs off that row.
 * Measured 2026-11-20: 0 visit requests after 2026-11-15, 0 « Visite fixée ».
 *
 * WHAT HAPPENS
 * When the agent answers the "Un client veut visiter votre bien" alert with
 * « Visite fixée » (button, a typed "visite demain 10h", or "Faites le
 * point"), ensureDirectVisit() creates the lead and the visit:
 *   - the lead is the one the customer's number made at the tap
 *     (contact_tap_alerts.lead_id) or a new one, source
 *     'listing-direct-visit'; its wa_id is the customer's number when they
 *     left it, '' when they did not ("client du site") — every customer send
 *     skips an empty number (viewingNotifications.tellCustomer, trySend);
 *   - the visit is PENDING, routing DIRECT_WA to the alerted agent, with a
 *     direct contact recorded (so the 15-minute SLA and the 2-hour "avez-vous
 *     contacté le client ?" leave it alone: the agent and the customer are
 *     already talking).
 * Then the agent is asked « Quand a lieu la visite ? ». A typed answer with a
 * day AND an hour (services/visitSchedule.js, never a guessed hour) confirms
 * it: CONFIRMED at that instant — the agent's "visite effectuée ?" and, when
 * the customer left a number, their confirmation and check-in follow as for
 * any visit. The agent can also set the time from their Visites tab.
 */

const dbService = require('./db');
const propertyRepository = require('./propertyRepository');
const { parseFrenchSlot, formatSlotFr } = require('./visitSchedule');
const { utcOffsetForCommune } = require('./cities');

/** How long « Quand a lieu la visite ? » stays answerable by a typed reply. */
const VISIT_TIME_TTL_MS = 24 * 60 * 60 * 1000;

/** A typed slot is short; anything longer is an advert or a conversation. */
const MAX_SLOT_TEXT = 120;

function viewing() {
  // eslint-disable-next-line global-require
  return require('./viewingNotifications');
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalise(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The lead and the visit behind « Visite fixée », created once per alert.
 * Never throws; returns the visit joined to its lead, or null.
 *
 * @param {Object} alert a contact_tap_alerts row
 * @param {{by?: 'AGENT_WHATSAPP'|'AGENT_DASHBOARD', listing?: Object|null}} [options]
 */
async function ensureDirectVisit(alert, { by = 'AGENT_WHATSAPP', listing = null } = {}) {
  try {
    if (!alert) return null;
    const fresh = dbService.getContactTapAlert(alert.id) || alert;
    if (fresh.viewing_request_id) return dbService.getViewingRequestWithLead(fresh.viewing_request_id) || null;

    const place = listing || await propertyRepository.getListingContactById(fresh.property_id).catch(() => null);
    let lead = fresh.lead_id ? dbService.getLead(fresh.lead_id) : null;
    if (lead && lead.status === 'NEW') lead = dbService.updateLeadStatus(lead.id, 'CONTACTED');
    if (!lead) {
      lead = dbService.createDirectContactLead({
        waId: fresh.customer_phone || '',
        name: fresh.customer_name || null,
        propertyId: fresh.property_id,
        agentId: fresh.agent_id,
        status: 'CONTACTED',
        summary: 'Visite fixée par l’agent après un contact WhatsApp direct depuis l’annonce',
      });
      dbService.setContactTapAlertLead(fresh.id, lead.id);
    }

    const request = dbService.createViewingRequest({
      leadId: lead.id,
      propertyId: fresh.property_id,
      requestedTime: null,
      visitMode: fresh.intent === 'video_visit' ? 'video' : null,
    });
    dbService.setViewingRouting(request.id, {
      agentId: fresh.agent_id,
      routingType: 'DIRECT_WA',
      commune: place?.commune || null,
    });
    dbService.recordViewingDirectContact(request.id, { channel: 'whatsapp', by });
    dbService.setContactTapAlertViewing(fresh.id, request.id);
    console.log(`[direct-visit] alert #${fresh.id}: visit #${request.id} created on listing #${fresh.property_id} (customer ${fresh.customer_phone ? 'known' : 'unknown'})`);
    return dbService.getViewingRequestWithLead(request.id) || null;
  } catch (err) {
    console.error(`[direct-visit] alert #${alert?.id}: could not create the visit — ${err.message}`);
    return null;
  }
}

function askTimeText(listing, propertyId, customer) {
  const { HEADER_BRAND, listingLabel, schedulerLink } = viewing();
  return [
    `${HEADER_BRAND} Visite notée ✅`,
    `📍 ${listingLabel(listing, propertyId)}`,
    customer ? `👤 ${customer}` : null,
    '',
    'Quand a-t-elle lieu ? Répondez avec le jour et l’heure, par exemple « demain 10h ».',
    'Nous vous demanderons ensuite si elle a eu lieu.',
    '',
    `Ou fixez-la dans votre espace : ${schedulerLink()}`,
  ].filter((line) => line !== null).join('\n');
}

function customerLine(alert) {
  if (!alert?.customer_phone) return null;
  return `${alert.customer_name ? `${alert.customer_name} · ` : ''}+${digits(alert.customer_phone)}`;
}

/**
 * « Visite fixée » from any channel: the visit, then « Quand ? ». When the
 * agent's own words already carry a day and an hour (`text`), it is confirmed
 * straight away instead. Never throws.
 *
 * @returns {Promise<{ok: boolean, viewingRequestId?: number, confirmed?: boolean}>}
 */
async function onVisitSet(alert, { from, text = null, by = 'AGENT_WHATSAPP', via = 'WHATSAPP', now = new Date() } = {}) {
  try {
    const listing = await propertyRepository.getListingContactById(alert.property_id).catch(() => null);
    const request = await ensureDirectVisit(alert, { by, listing });
    if (!request) return { ok: false };
    try {
      dbService.recordContactTapOutcome(alert.id, 'VISIT_PLANNED', via, now.toISOString());
    } catch (err) {
      console.error(`[direct-visit] alert #${alert.id}: outcome not recorded — ${err.message}`);
    }
    const to = digits(from || alert.agent_wa);
    if (text) {
      const slot = parseFrenchSlot(text, now, { utcOffset: utcOffsetForCommune(request.commune || listing?.commune || null) });
      if (slot) {
        await confirmDirectVisit({ alert, request, listing, iso: slot.iso, to, now });
        return { ok: true, viewingRequestId: request.id, confirmed: true };
      }
    }
    if (to && via === 'WHATSAPP') {
      dbService.markContactTapVisitTimeAsked(alert.id, now.toISOString());
      await viewing().trySend(to, askTimeText(listing, alert.property_id, customerLine(alert)), 'direct visit: when?');
    }
    return { ok: true, viewingRequestId: request.id, confirmed: false };
  } catch (err) {
    console.error(`[direct-visit] alert #${alert?.id}: ${err.message}`);
    return { ok: false };
  }
}

/**
 * The agreed instant: CONFIRMED, scheduled_at, the agent's answer stamped as
 * given on WhatsApp, the customer told when we have their number. The agent
 * gets the date read back in full.
 */
async function confirmDirectVisit({ alert, request, listing, iso, to, now = new Date() }) {
  const v = viewing();
  const current = dbService.getViewingRequestWithLead(request.id);
  if (!current || current.status !== 'PENDING') return false;
  dbService.updateViewingRequest(current.id, { status: 'CONFIRMED' });
  dbService.setViewingScheduledAt(current.id, iso);
  try {
    dbService.recordViewingFirstResponse(current.id, now.toISOString());
    dbService.setViewingAgentResponseVia(current.id, 'WHATSAPP');
  } catch (err) {
    console.error(`[direct-visit] visit #${current.id}: response stamp failed — ${err.message}`);
  }

  let customerTold = false;
  if (digits(current.lead_wa_id)) {
    const text = v.tenantAcceptedText(listing, current, current.property_id, iso);
    const template = v.confirmedTemplate(listing, current, current.property_id, iso);
    customerTold = await v.tellCustomer(current, {
      kind: 'visit_confirmed',
      text,
      expectStatus: 'CONFIRMED',
      fallback: { template, text, label: 'direct visit confirmation' },
      whatsapp: () => v.trySend(current.lead_wa_id, text, 'direct visit confirmation', template),
    });
    if (customerTold) v.markCustomerNotified(current.id);
  }

  const slot = formatSlotFr(iso, v.visitClock(current, listing)) || iso;
  if (to) {
    await v.trySend(to, [
      `${v.HEADER_BRAND} Visite du ${slot} notée ✅`,
      `📍 ${v.listingLabel(listing, current.property_id)}`,
      '',
      customerTold
        ? 'Le client a reçu la confirmation. Nous vous demanderons après la visite si elle a eu lieu.'
        : 'Nous vous demanderons après la visite si elle a eu lieu.',
    ].join('\n'), 'direct visit confirmed');
  }
  console.log(`[direct-visit] visit #${current.id} (alert #${alert?.id}) CONFIRMED for ${iso} — customer told: ${customerTold}`);
  return true;
}

/**
 * A typed answer to « Quand a lieu la visite ? ». Day and hour → confirmed;
 * a day without an hour → asked again for both; anything else is not an
 * answer and falls through (an advert sent meanwhile reaches intake).
 */
async function handleVisitTimeReply({ from, text, hasMedia = false, now = new Date() }) {
  if (hasMedia || !text || String(text).length > MAX_SLOT_TEXT) return { handled: false };
  // A short advert ("samedi 10h visite, 600$") is listing intake, not this answer.
  if (/\$|usd|chambres?|appartement|parcelle|prix|loyer/.test(normalise(text))) return { handled: false };
  const since = new Date(now.getTime() - VISIT_TIME_TTL_MS).toISOString();
  const alert = dbService.contactTapAwaitingVisitTime(from, since);
  if (!alert) return { handled: false };
  const request = dbService.getViewingRequestWithLead(alert.viewing_request_id);
  if (!request) return { handled: false };
  const listing = await propertyRepository.getListingContactById(alert.property_id).catch(() => null);
  const clock = { utcOffset: utcOffsetForCommune(request.commune || listing?.commune || null) };
  const slot = parseFrenchSlot(text, now, clock);
  if (slot) {
    await confirmDirectVisit({ alert, request, listing, iso: slot.iso, to: digits(from), now });
    return { handled: true, confirmed: true, viewingRequestId: request.id };
  }
  const t = normalise(text);
  const namesDay = /\b(aujourd'hui|demain|apres[- ]demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(t)
    || /\ble \d{1,2}\b/.test(t);
  if (namesDay) {
    await viewing().trySend(
      digits(from),
      `${viewing().HEADER_BRAND} À quelle heure ? Écrivez le jour et l’heure ensemble, par exemple « ${t.includes('demain') ? 'demain' : 'samedi'} 10h ».`,
      'direct visit: which hour?',
    );
    return { handled: true, confirmed: false };
  }
  return { handled: false };
}

module.exports = {
  ensureDirectVisit,
  onVisitSet,
  confirmDirectVisit,
  handleVisitTimeReply,
  askTimeText,
  VISIT_TIME_TTL_MS,
};
