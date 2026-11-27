/**
 * Which "Un client vous contacte" alert belongs to which WhatsApp tap
 * (2026-11-15, owner: questions go straight to the agent again, and
 * /admin/telemetry must show per tap that the agent was told and what they
 * answered).
 *
 * The tap is a Postgres `whatsapp_clicks` row; the alert is the engine's
 * SQLite `contact_tap_alerts` row (services/contactTapAlert.js), written by
 * the same request a moment later (web's lead-click route calls the engine in
 * `after()`). Nothing links the two rows, so they are matched on what both
 * carry: the listing, the visitor id (when both have one) and the time.
 *
 * The engine sends at most one alert per listing per visitor per 24 h and one
 * per listing per 30 min, so most repeat taps have no alert of their own:
 * those are shown as covered by the earlier one, never as "not told".
 *
 * Pure: no I/O, so it is unit-tested directly.
 */

/** An alert written this long before the tap (clock skew) still counts as its own. */
export const ALERT_BEFORE_TAP_MS = 5 * 1000;
/** An alert written within this long after the tap is that tap's. */
export const ALERT_AFTER_TAP_MS = 2 * 60 * 1000;
/** Mirror the engine's dedupe windows (services/contactTapAlert.js). */
export const SAME_VISITOR_MS = 24 * 60 * 60 * 1000;
export const SAME_LISTING_MS = 30 * 60 * 1000;

const time = (value) => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
};

/** The routing a tap must have taken to alert the agent, per alert kind. */
const DIRECT_ROUTING = { whatsapp: 'DIRECT_WA', call: 'DIRECT' };

/**
 * Only a customer's tap on an agent's own WhatsApp (or, for `kind: 'call'`,
 * the agent's own "Appeler", listing_events routing DIRECT) can have alerted
 * the agent.
 */
export function tapCanAlert(click, kind = 'whatsapp') {
  return click?.routing_type === DIRECT_ROUTING[kind] && (click.viewer_kind || 'visitor') === 'visitor' && Boolean(click.listing_id);
}

/**
 * What to ask the engine for one page of taps: the listings on it and a
 * start early enough to see the alert that covered the oldest tap.
 *
 * @returns {{propertyIds: number[], since: string}|null} null when no tap on the page can have alerted.
 */
export function tapAlertQuery(clicks) {
  const taps = (clicks || []).filter((c) => tapCanAlert(c));
  const times = taps.map((c) => time(c.created_at)).filter((ms) => ms != null);
  if (taps.length === 0 || times.length === 0) return null;
  const propertyIds = [...new Set(taps.map((c) => Number(c.listing_id)))];
  return { propertyIds, since: new Date(Math.min(...times) - SAME_VISITOR_MS).toISOString() };
}

function alertState(alert) {
  if (!alert.sent_via) return 'failed';
  if (alert.answer === 'REPLIED') return 'replied';
  // The customer asked to visit and the agent says a visit is set (2026-11-16).
  if (alert.answer === 'VISIT_SET') return 'visitSet';
  if (alert.answer === 'NOTHING') return 'nothing';
  return 'waiting';
}

/**
 * @param {Array<Object>} clicks rows of the tap log (`id`, `listing_id`, `created_at`, `routing_type`, `viewer_kind`, `visitor_id`)
 * @param {Array<Object>} alerts the engine's rows (`id`, `property_id`, `kind`, `visitor_key`, `created_at`, `sent_via`, `answer`, `answered_at`)
 * @param {{kind?: 'whatsapp'|'call'}} [options] which taps and alerts to pair (call taps: listing_events, routing DIRECT)
 * @returns {Map<string, {state: 'replied'|'visitSet'|'nothing'|'waiting'|'failed'|'earlier', via: string|null,
 *   answeredAt: string|null, alertAt: string}>} keyed by click id; a tap with no entry had no alert.
 */
export function matchTapAlerts(clicks, alerts, { kind = 'whatsapp' } = {}) {
  const result = new Map();
  const pool = (alerts || [])
    .filter((a) => a && a.kind === kind && time(a.created_at) != null)
    .map((a) => ({ ...a, at: time(a.created_at), propertyId: Number(a.property_id) }))
    .sort((x, y) => x.at - y.at);
  const used = new Set();

  // Oldest tap first, so each alert goes to the first tap that caused it.
  const taps = (clicks || [])
    .filter((c) => tapCanAlert(c, kind))
    .map((c) => ({ click: c, at: time(c.created_at), propertyId: Number(c.listing_id) }))
    .filter((t) => t.at != null)
    .sort((x, y) => x.at - y.at);

  const sameVisitor = (tap, alert) => !tap.click.visitor_id || !alert.visitor_key
    || String(tap.click.visitor_id).slice(0, 80) === String(alert.visitor_key);

  for (const tap of taps) {
    const own = pool.find((a) => !used.has(a.id)
      && a.propertyId === tap.propertyId
      && a.at >= tap.at - ALERT_BEFORE_TAP_MS
      && a.at <= tap.at + ALERT_AFTER_TAP_MS
      && sameVisitor(tap, a));
    if (own) {
      used.add(own.id);
      result.set(String(tap.click.id), {
        state: alertState(own), via: own.sent_via || null, answeredAt: own.answered_at || null, alertAt: own.created_at,
        // 2026-11-20: the customer's optional name + number from « Je veux le
        // visiter », the visit « Visite fixée » created, and what came of it.
        alertId: own.id ?? null,
        customer: own.customer_phone
          ? { customerId: null, phone: String(own.customer_phone).replace(/\D/g, ''), name: own.customer_name || null }
          : null,
        viewingId: own.viewing_request_id ?? null,
        outcome: own.outcome || null,
      });
      continue;
    }
    // No alert of its own: was the agent already told about this listing?
    const earlier = [...pool].reverse().find((a) => a.propertyId === tap.propertyId
      && a.sent_via
      && a.at < tap.at
      && ((tap.click.visitor_id && a.visitor_key === String(tap.click.visitor_id).slice(0, 80) && a.at >= tap.at - SAME_VISITOR_MS)
        || a.at >= tap.at - SAME_LISTING_MS));
    if (earlier) {
      result.set(String(tap.click.id), {
        state: 'earlier', via: earlier.sent_via, answeredAt: earlier.answered_at || null, alertAt: earlier.created_at,
      });
    }
  }
  return result;
}
