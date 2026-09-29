import { kinshasaDayKey, slotPhraseFr, toTime } from './visitAgenda';

/**
 * The customer's visit agenda (/compte/client/visites), as pure functions over
 * getCustomerInquiries' rows. Kinshasa calendar days, whatever the phone's
 * timezone — the visit happens in Kinshasa.
 *
 * WHEN a visit is:
 *  - `scheduled_at` once the agent accepted (the agreed instant);
 *  - the customer's own pick (`preferred_slot_at`) while it is still PENDING,
 *    labelled "demandé", never "confirmé";
 *  - nothing otherwise (a free-text request, or a new slot the agent proposed
 *    in words) — listed as "heure à préciser", never placed on a guessed day.
 */

export const CLOSED_STATUSES = ['CANCELLED', 'DECLINED'];
const PAST_GRACE_MS = 3 * 3600 * 1000;

/** 'pending' | 'confirmed' | 'rescheduled' | 'cancelled' | 'done' — the badge. */
export function visitTone(visit) {
  if (CLOSED_STATUSES.includes(visit.status)) return 'cancelled';
  if (visit.status === 'COMPLETED' || visit.agent_visit_outcome === 'DONE') return 'done';
  if (visit.status === 'CONFIRMED') return 'confirmed';
  if (visit.status === 'RESCHEDULED') return 'rescheduled';
  return 'pending';
}

/** The instant this visit happens, and whether that instant was agreed. */
export function visitWhen(visit) {
  if (visit.scheduled_at && visit.status !== 'RESCHEDULED') return { at: visit.scheduled_at, agreed: visit.status === 'CONFIRMED' || visit.status === 'COMPLETED' };
  if (visit.status === 'PENDING' && visit.preferred_slot_at) return { at: visit.preferred_slot_at, agreed: false };
  return { at: null, agreed: false };
}

/**
 * @param {{lead: Object, listing: Object|null, viewings: Object[]}[]} inquiries
 * @returns {{today: Object[], tomorrow: Object[], upcoming: Object[], unscheduled: Object[], past: Object[]}}
 */
export function groupCustomerVisits(inquiries = [], now = new Date()) {
  const todayKey = kinshasaDayKey(now);
  const tomorrowKey = kinshasaDayKey(now.getTime() + 24 * 3600 * 1000);
  const groups = { today: [], tomorrow: [], upcoming: [], unscheduled: [], past: [] };

  for (const { lead, listing, viewings = [] } of inquiries) {
    for (const viewing of viewings) {
      const when = visitWhen(viewing);
      const item = {
        id: viewing.id,
        status: viewing.status,
        tone: visitTone(viewing),
        at: when.at,
        agreed: when.agreed,
        phrase: when.at ? slotPhraseFr(when.at) : viewing.requested_time || null,
        requestedTime: viewing.requested_time || null,
        leadId: lead?.id ?? viewing.lead_id,
        listing,
        receiptSentAt: viewing.visit_receipt_sent_at || null,
      };
      const at = toTime(when.at);
      const closed = CLOSED_STATUSES.includes(viewing.status) || viewing.status === 'COMPLETED';
      if (at == null) {
        (closed ? groups.past : groups.unscheduled).push(item);
      } else if (at < now.getTime() - PAST_GRACE_MS || (closed && at < now.getTime())) {
        groups.past.push(item);
      } else {
        const key = kinshasaDayKey(at);
        if (key === todayKey) groups.today.push(item);
        else if (key === tomorrowKey) groups.tomorrow.push(item);
        else if (key < todayKey) groups.past.push(item);
        else groups.upcoming.push(item);
      }
    }
  }

  const byTime = (a, b) => (toTime(a.at) ?? 0) - (toTime(b.at) ?? 0);
  groups.today.sort(byTime);
  groups.tomorrow.sort(byTime);
  groups.upcoming.sort(byTime);
  groups.past.sort((a, b) => byTime(b, a));
  return groups;
}

/**
 * The customer's WhatsApp to the agent about THIS visit. French always: the
 * agent in Kinshasa reads it.
 */
export function customerToAgentMessage({ agentName, phrase, listing }) {
  const greeting = agentName ? `Bonjour ${agentName.split(/\s+/)[0]}` : 'Bonjour';
  const what = listing?.reference ? `Réf. ${listing.reference}` : listing?.title || 'votre bien';
  const when = phrase ? ` ${phrase}` : '';
  return `${greeting}, concernant notre visite${when} pour ${what} (via Lukka Place)…`;
}
