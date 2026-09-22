import { confirmPrefill, toTime, visitSlotAt } from './visitAgenda';

/**
 * "À faire aujourd'hui" — one ranked list of what is waiting on the agent,
 * pure so the ranking can be tested without a session, an engine or a clock.
 *
 * Why one list and not four panels: the production picture that prompted it
 * was 0 of 6 visit requests answered, 3 of them already past the time the
 * customer asked for. Nothing on the overview said so; the requests sat one
 * tab away. A single ranked list puts the most expensive silence first.
 *
 * RANKING — the order is the product decision, not a tidy-up:
 *   0  overdue visits    the customer's time (or the agent's own proposal)
 *                        has gone by with no agreement — the customer may be
 *                        standing outside the property. Oldest slot first.
 *   1  open visits       PENDING / RESCHEDULED, oldest request first — a
 *                        request answered in 5 minutes converts, one answered
 *                        tomorrow mostly does not.
 *   2  new leads         status NEW, oldest first, for the same reason.
 *   3  listings to confirm   longest since last confirmation first.
 *   4  incomplete listings   most gaps first.
 *
 * Each item carries ONE primary action and no text: labels are i18n keys
 * resolved at render (a module constant cannot hold translated text — see
 * components/navItems.js).
 *
 * A visit's primary action depends on what we actually know:
 *   - a slot still ahead (the engine's parse of the customer's phrase, or the
 *     agent's own proposal): `confirm-visit` with that slot, one tap;
 *   - the slot has passed: `propose-slot` — confirming a time that has gone by
 *     is refused by the engine, and asking for a new one is the real answer;
 *   - no known slot: `confirm-visit` with no prefill, which opens the date +
 *     time form (a confirmation must carry an instant; a day with no hour is
 *     refused, never guessed).
 */

export const TODO_KINDS = Object.freeze({
  VISIT: 'visit',
  LEAD: 'lead',
  LISTING_CONFIRM: 'listing-confirm',
  LISTING_INCOMPLETE: 'listing-incomplete',
});

export const TODO_VISIBLE_DEFAULT = 6;

/** Where "voir tout" goes for each kind. */
export const TODO_SEE_ALL_HREF = Object.freeze({
  [TODO_KINDS.VISIT]: '/compte/agent/demandes?tab=visites',
  [TODO_KINDS.LEAD]: '/compte/agent/demandes?status=NEW',
  [TODO_KINDS.LISTING_CONFIRM]: '/compte/agent/biens',
  [TODO_KINDS.LISTING_INCOMPLETE]: '/compte/agent/biens',
});

const OPEN_VISIT_STATUSES = new Set(['PENDING', 'RESCHEDULED']);

function byAgeThenId(a, b) {
  // Oldest first; a row with no readable date sorts after every dated one, and
  // ties fall back to id so the order is stable between renders.
  const ta = a.sortAt ?? Number.POSITIVE_INFINITY;
  const tb = b.sortAt ?? Number.POSITIVE_INFINITY;
  if (ta !== tb) return ta - tb;
  return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
}

function visitItem(visit, now) {
  const slotAt = visitSlotAt(visit);
  const overdue = slotAt != null && slotAt <= now.getTime();
  const prefill = overdue ? null : confirmPrefill(visit, now);
  return {
    key: `visit-${visit.id}`,
    kind: TODO_KINDS.VISIT,
    id: visit.id,
    rank: overdue ? 0 : 1,
    overdue,
    slotAt: slotAt == null ? null : new Date(slotAt).toISOString(),
    // Overdue visits are ordered by how long ago the slot passed; open ones by
    // how long the customer has been waiting for any answer.
    sortAt: overdue ? slotAt : toTime(visit.created_at),
    primary: overdue
      ? { type: 'propose-slot' }
      : { type: 'confirm-visit', prefill },
    visit,
  };
}

function leadItem(lead) {
  return {
    key: `lead-${lead.id}`,
    kind: TODO_KINDS.LEAD,
    id: lead.id,
    rank: 2,
    sortAt: toTime(lead.created_at),
    primary: { type: 'open-lead', href: `/compte/agent/demandes?lead=${encodeURIComponent(lead.id)}` },
    lead,
  };
}

function listingConfirmItem(listing) {
  return {
    key: `listing-confirm-${listing.id}`,
    kind: TODO_KINDS.LISTING_CONFIRM,
    id: listing.id,
    rank: 3,
    // Longest unconfirmed first: negate so the ascending sort puts it on top.
    sortAt: Number.isFinite(Number(listing.daysSince)) ? -Number(listing.daysSince) : null,
    primary: { type: 'confirm-availability', href: `/compte/agent/biens/${encodeURIComponent(listing.id)}` },
    listing,
  };
}

function listingIncompleteItem(listing) {
  const gaps = Array.isArray(listing.gaps) ? listing.gaps : [];
  return {
    key: `listing-incomplete-${listing.id}`,
    kind: TODO_KINDS.LISTING_INCOMPLETE,
    id: listing.id,
    rank: 4,
    sortAt: -gaps.length,
    primary: { type: 'complete', href: `/compte/agent/biens/${encodeURIComponent(listing.id)}` },
    listing: { ...listing, gaps },
  };
}

/**
 * @param {{
 *   visits?: Object[],             engine owner-list rows (any status; only PENDING/RESCHEDULED are kept)
 *   leads?: Object[],              engine lead rows (only status NEW is kept)
 *   listingsToConfirm?: {id, title, lastConfirmedAt, daysSince}[],
 *   incompleteListings?: {id, title, gaps: string[]}[],
 *   now?: Date,
 *   limit?: number,
 * }} input
 * @returns {{ items: Object[], visible: Object[], hiddenByKind: Record<string, number>, total: number, overdueCount: number }}
 */
export function buildAgentTodo({
  visits = [], leads = [], listingsToConfirm = [], incompleteListings = [], now = new Date(), limit = TODO_VISIBLE_DEFAULT,
} = {}) {
  const seen = new Set();
  const unique = (prefix, rows) => (rows || []).filter((row) => {
    if (!row || row.id == null) return false;
    const key = `${prefix}-${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const items = [
    ...unique('v', visits).filter((v) => OPEN_VISIT_STATUSES.has(v.status)).map((v) => visitItem(v, now)),
    ...unique('l', leads).filter((l) => l.status === 'NEW').map(leadItem),
    ...unique('c', listingsToConfirm).map(listingConfirmItem),
    ...unique('i', incompleteListings).map(listingIncompleteItem),
  ].sort((a, b) => (a.rank - b.rank) || byAgeThenId(a, b));

  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : TODO_VISIBLE_DEFAULT;
  const visible = items.slice(0, cap);
  const hiddenByKind = {};
  for (const item of items.slice(cap)) hiddenByKind[item.kind] = (hiddenByKind[item.kind] || 0) + 1;

  return {
    items,
    visible,
    hiddenByKind,
    total: items.length,
    overdueCount: items.filter((i) => i.overdue).length,
  };
}
