/**
 * services/customerAlerts.js
 *
 * The customer alerts that did not exist before the Lukka Place app
 * (owner-approved plan, part 2 phase 2, 2026-11-10). Each tells the customer
 * something they were never told — mostly in the app only, since no Meta
 * template covers them; where a WhatsApp text exists it goes only to a
 * customer inside the 24 h window, the one case where it can arrive.
 *
 *   B1  visit request received                        push only
 *   B2  visit reminders: the evening before, 2 h before   push, WhatsApp in window
 *   B3  the desk changed the time, cancelled, or reassigned the visit   push only
 *   B4  the customer's own cancel / accept, confirmed  push only
 *   B7  no agency took the request: the team is on it  push, WhatsApp in window
 *   B8  move project: the team is calling              push, WhatsApp in window
 *   B12 project enquiry passed on                      push only
 *
 * B5 (an agent proposed a listing) is sent by web (proposeListingAction), and
 * B9–B11 (saved listings let / under offer / back on the market) by
 * services/favoriteStatus.js. Everything here is fire-and-forget: it never
 * throws into its caller and logs what reached whom.
 */

const pushNotify = require('./pushNotify');
const { insideSessionWindow } = require('./sessionWindow');
const { formatSlotFr } = require('./visitSchedule');

const KINSHASA_OFFSET_H = 1;
const REMINDER_SOON_MS = 2 * 60 * 60 * 1000;
const REMINDER_LOOKAHEAD_MS = 30 * 60 * 60 * 1000;
/** The evening-before reminder goes between 18 h and 21 h Kinshasa. */
const EVE_FROM_H = 18;
const EVE_TO_H = 21;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function visitPath(id) {
  return id ? `/compte/client/visites?visite=${id}` : '/compte/client/visites';
}

function remindersEnabled() {
  return String(process.env.VISIT_REMINDERS || '').trim().toLowerCase() !== 'off';
}

/** Push only — nothing to do on WhatsApp. Never throws. */
async function pushToCustomer({ phone, customerId, kind, category, refId, title, body, url }) {
  const to = digits(phone);
  if (!to && !customerId) return { pushed: false, reason: 'no-recipient' };
  const outcome = await pushNotify.pushOnly({
    userType: 'customer',
    customerId,
    phone: to || undefined,
    kind,
    category,
    refId,
    title,
    body,
    url,
  });
  if (outcome.pushed) console.log(`[customer-alerts] ${kind} #${refId ?? '-'} pushed to customer …${to.slice(-4)}`);
  return outcome;
}

/**
 * Push, else a WhatsApp text — only to a customer inside the 24 h window,
 * where a session message can arrive; outside it nothing is sent and the log
 * says so (no template covers these messages). Never throws.
 * @returns {Promise<'push'|'whatsapp'|'none'>}
 */
async function tellCustomerInWindow({ phone, kind, category, refId, title, body, url, text, now = new Date() }) {
  const to = digits(phone);
  if (!to) return 'none';
  try {
    const outcome = await pushNotify.pushFirst({
      userType: 'customer',
      phone: to,
      kind,
      category,
      refId,
      title,
      body,
      url,
      urgent: false,
      sendWhatsApp: async () => {
        if (!text || !insideSessionWindow(to, now)) return false;
        // eslint-disable-next-line global-require
        await require('./chakra').sendWhatsAppMessage(to, text, { previewUrl: true });
        return true;
      },
    });
    if (outcome.pushed) return 'push';
    if (outcome.whatsapp) return 'whatsapp';
    console.log(`[customer-alerts] ${kind} #${refId ?? '-'}: …${to.slice(-4)} has no app and is outside the 24 h window — not sent`);
    return 'none';
  } catch (err) {
    console.error(`[customer-alerts] ${kind} #${refId ?? '-'} for …${to.slice(-4)} failed: ${err.message}`);
    return 'none';
  }
}

// ---------------------------------------------------------------------------
// B1 — visit request received
// ---------------------------------------------------------------------------

/** After a NEW visit request reached (or did not reach) its agent. */
function notifyVisitRequested({ viewingRequest, lead, listingLabel }) {
  return pushToCustomer({
    phone: lead?.wa_id || viewingRequest?.lead_wa_id,
    kind: 'visit_requested',
    category: 'visits',
    refId: viewingRequest?.id,
    title: 'Demande de visite envoyée',
    body: `Votre demande pour ${listingLabel || 'ce bien'} a été transmise à l'agent. Vous serez prévenu dès sa réponse.`,
    url: visitPath(viewingRequest?.id),
  }).catch(() => ({ pushed: false }));
}

// ---------------------------------------------------------------------------
// B3 / B4 — changes the customer did not make on WhatsApp
// ---------------------------------------------------------------------------

/** The desk (console PATCH) or the customer (Espace Client) changed a visit. */
function notifyVisitChanged(request, change, { agentName = null, scheduledAt = null } = {}) {
  const copy = {
    'desk-cancelled': ['Visite annulée', "L'équipe Lukka Place a annulé cette visite. Contactez-nous si vous souhaitez en programmer une autre."],
    'desk-rescheduled': ['Horaire de visite mis à jour', `Votre visite est maintenant prévue ${formatSlotFr(scheduledAt) || 'à un nouvel horaire'}.`],
    reassigned: ['Un autre agent s’occupe de votre visite', `${agentName || 'Un autre agent'} prend en charge votre demande de visite et va vous répondre.`],
    'customer-cancelled': ['Visite annulée', "Vous avez annulé cette visite. L'agent a été prévenu."],
    'customer-accepted': ['Horaire accepté', "Vous avez accepté l'horaire proposé. L'agent a été prévenu."],
  }[change];
  if (!copy || !request) return Promise.resolve({ pushed: false });
  return pushToCustomer({
    phone: request.lead_wa_id,
    kind: change.startsWith('customer') || change === 'desk-cancelled' ? 'visit_cancelled' : 'visit_updated',
    category: 'visits',
    refId: request.id,
    title: copy[0],
    body: copy[1],
    url: visitPath(request.id),
  }).catch(() => ({ pushed: false }));
}

// ---------------------------------------------------------------------------
// B2 — visit reminders
// ---------------------------------------------------------------------------

function kinshasaDayKey(date) {
  return new Date(date.getTime() + KINSHASA_OFFSET_H * 3600 * 1000).toISOString().slice(0, 10);
}

function kinshasaHour(date) {
  return (date.getUTCHours() + KINSHASA_OFFSET_H) % 24;
}

/**
 * Which reminder a confirmed visit is due, if any:
 *   'soon' — it starts within 2 h (and has not started);
 *   'eve'  — it is tomorrow (Kinshasa) and it is now 18–21 h.
 * A visit confirmed too late for the evening one simply gets the 2 h one.
 */
function reminderDue(row, now = new Date()) {
  const at = new Date(row.scheduled_at);
  if (Number.isNaN(at.getTime())) return null;
  const ahead = at.getTime() - now.getTime();
  if (ahead <= 0) return null;
  if (ahead <= REMINDER_SOON_MS) return row.reminder_soon_sent_at ? null : 'soon';
  if (row.reminder_eve_sent_at) return null;
  const tomorrow = kinshasaDayKey(new Date(now.getTime() + 24 * 3600 * 1000));
  const hour = kinshasaHour(now);
  return kinshasaDayKey(at) === tomorrow && hour >= EVE_FROM_H && hour < EVE_TO_H ? 'eve' : null;
}

function reminderCopy(kind, row, label) {
  const when = formatSlotFr(row.scheduled_at) || 'bientôt';
  const place = label ? ` (${label})` : '';
  if (kind === 'soon') {
    return {
      title: 'Votre visite approche',
      body: `Votre visite${place} est prévue ${when}. Pensez à prévenir l'agent en cas de retard.`,
      text: `🏠 [Lukka Place] Rappel : votre visite${place} est prévue ${when}. En cas de retard ou d'empêchement, prévenez l'agent.`,
    };
  }
  return {
    title: 'Visite demain',
    body: `Rappel : votre visite${place} est prévue ${when}.`,
    text: `🏠 [Lukka Place] Rappel : votre visite${place} est prévue ${when}. À demain !`,
  };
}

/**
 * The `visit-reminders` job. Each reminder is stamped on the row before it
 * is sent, so a crash never sends it twice; a 2 h reminder also stamps the
 * evening one, which would otherwise arrive after it.
 */
async function runVisitReminders(now = new Date(), { listingLabel = defaultListingLabel } = {}) {
  const summary = { due: 0, pushed: 0, whatsapp: 0, none: 0 };
  if (!remindersEnabled()) return { ...summary, off: true };
  // eslint-disable-next-line global-require
  const { db } = require('./db');
  const rows = db
    .prepare(
      `SELECT v.id, v.property_id, v.scheduled_at, v.commune, v.reminder_eve_sent_at, v.reminder_soon_sent_at,
              l.wa_id AS lead_wa_id
         FROM viewing_requests v
         JOIN leads l ON l.id = v.lead_id
        WHERE v.status = 'CONFIRMED'
          AND v.scheduled_at IS NOT NULL
          AND v.scheduled_at > ?
          AND v.scheduled_at <= ?
          AND (v.reminder_soon_sent_at IS NULL OR v.reminder_eve_sent_at IS NULL)
        ORDER BY v.scheduled_at
        LIMIT 200`,
    )
    .all(now.toISOString(), new Date(now.getTime() + REMINDER_LOOKAHEAD_MS).toISOString());

  for (const row of rows) {
    const kind = reminderDue(row, now);
    if (!kind) continue;
    const stamp = now.toISOString();
    const claimed = kind === 'soon'
      ? db.prepare(
        `UPDATE viewing_requests SET reminder_soon_sent_at = ?, reminder_eve_sent_at = COALESCE(reminder_eve_sent_at, ?)
          WHERE id = ? AND reminder_soon_sent_at IS NULL`,
      ).run(stamp, stamp, row.id)
      : db.prepare('UPDATE viewing_requests SET reminder_eve_sent_at = ? WHERE id = ? AND reminder_eve_sent_at IS NULL').run(stamp, row.id);
    if (!claimed.changes) continue;
    summary.due += 1;
    const label = await listingLabel(row.property_id).catch(() => null);
    const copy = reminderCopy(kind, row, label);
    const via = await tellCustomerInWindow({
      phone: row.lead_wa_id,
      kind: 'visit_reminder',
      category: 'visits',
      refId: row.id,
      title: copy.title,
      body: copy.body,
      url: visitPath(row.id),
      text: copy.text,
      now,
    });
    summary[via === 'push' ? 'pushed' : via === 'whatsapp' ? 'whatsapp' : 'none'] += 1;
    console.log(`[customer-alerts] visit #${row.id} ${kind} reminder: ${via}`);
  }
  return summary;
}

async function defaultListingLabel(propertyId) {
  if (!propertyId) return null;
  // eslint-disable-next-line global-require
  const listing = await require('./propertyRepository').getListingContactById(propertyId);
  return listing?.title || null;
}

const visitRemindersJob = {
  name: 'visit-reminders',
  // Every 5 minutes is fine-grained enough for a 2 h reminder and cheap.
  shouldRun: (now = new Date()) => remindersEnabled() && now.getUTCMinutes() % 5 === 0,
  run: () => runVisitReminders(),
};

// ---------------------------------------------------------------------------
// B7 / B8 / B12 — requests
// ---------------------------------------------------------------------------

/** The desk was told nobody took the request (leadDispatch.alertDeskOnce). */
function notifyRequestWithTeam(lead, reason) {
  if (!['unclaimed', 'no-coverage'].includes(reason)) return Promise.resolve('none');
  return tellCustomerInWindow({
    phone: lead?.wa_id,
    kind: 'request_with_team',
    category: 'requests',
    refId: lead?.id,
    title: 'Notre équipe s’occupe de votre recherche',
    body: 'Aucune agence n’a encore répondu à votre demande : notre équipe prend le relais et vous contacte.',
    url: '/compte/client/messages',
    text: '🏠 [Lukka Place] Aucune agence n’a encore répondu à votre recherche : notre équipe prend le relais et vous contacte très vite.',
  });
}

/** The desk was told a move request had no answer for 24 h (moveFollowup). */
function notifyMoveFollowup(lead) {
  return tellCustomerInWindow({
    phone: lead?.wa_id,
    kind: 'move_followup',
    category: 'requests',
    refId: lead?.id,
    title: 'Votre déménagement',
    body: 'Notre équipe reprend votre projet de déménagement et va vous appeler.',
    url: '/compte/client/projet',
    text: '🏠 [Lukka Place] Notre équipe reprend votre projet de déménagement et va vous appeler très vite.',
  });
}

/** A project enquiry reached the developer or the desk (projectEnquiry). */
function notifyProjectEnquiry({ waId, leadId, projectName }) {
  return pushToCustomer({
    phone: waId,
    kind: 'project_enquiry',
    category: 'requests',
    refId: leadId,
    title: 'Demande envoyée',
    body: `Votre demande pour le projet « ${projectName || 'neuf'} » a été transmise. Vous serez recontacté rapidement.`,
    url: '/compte/client/messages',
  }).catch(() => ({ pushed: false }));
}

module.exports = {
  notifyVisitRequested,
  notifyVisitChanged,
  runVisitReminders,
  visitRemindersJob,
  notifyRequestWithTeam,
  notifyMoveFollowup,
  notifyProjectEnquiry,
  // Exposed for scripts/verify-pipeline.js.
  reminderDue,
  reminderCopy,
  tellCustomerInWindow,
};
