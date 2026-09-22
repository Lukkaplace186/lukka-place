import { confirmPrefill, toTime, visitSlotAt } from './visitAgenda';
import { listingGapHref } from './completenessRules';

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
 *   3  stale visits      overdue by more than STALE_AFTER_MS, or asked for
 *                        with no time more than STALE_REQUEST_MS ago. The
 *                        customer has almost certainly moved on; the row asks
 *                        "Relancer ou clore" instead of sitting on top of
 *                        today's real work for a week (2026-09-22: a visit
 *                        from 15 sept. was still the first row).
 *   4  listings to confirm   longest since last confirmation first.
 *   5  incomplete listings   most gaps first.
 *
 * ONE ROW PER REQUEST. A web visit request writes a `leads` row AND a
 * `viewing_requests` row for the same ask, so the agent used to see the
 * customer twice — once by name under the visit, once as a bare phone number
 * under "Nouvelle". A NEW lead is folded into the visit that carries its id
 * (`lead_id`), or, failing that, the open visit from the same number for the
 * same listing. A customer with two DIFFERENT requests still gets two rows.
 * A row that knows only a number borrows the name another row from that
 * number carries (`customerName`), rather than printing "+4479…".
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

export const TODO_VISIBLE_DEFAULT = 4;

/** A slot that passed this long ago is no longer "en retard", it is stale. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
/** A request with no time, unanswered this long, is stale too. */
export const STALE_REQUEST_MS = 7 * 24 * 60 * 60 * 1000;

/** Where "voir tout" goes for each kind. */
export const TODO_SEE_ALL_HREF = Object.freeze({
  [TODO_KINDS.VISIT]: '/compte/agent/demandes?tab=visites',
  [TODO_KINDS.LEAD]: '/compte/agent/demandes?status=NEW',
  [TODO_KINDS.LISTING_CONFIRM]: '/compte/agent/biens',
  [TODO_KINDS.LISTING_INCOMPLETE]: '/compte/agent/biens',
});

const OPEN_VISIT_STATUSES = new Set(['PENDING', 'RESCHEDULED']);

/** Where a stale visit is closed (Décliner / Annuler live on the Visites tab). */
export const TODO_CLOSE_VISIT_HREF = '/compte/agent/demandes?tab=visites';

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** A real name, not a phone number typed into the name field. */
function realName(value) {
  const name = String(value ?? '').trim();
  return name && /[A-Za-zÀ-ÿ]/.test(name) ? name : null;
}

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
  const createdAt = toTime(visit.created_at);
  const stale = overdue
    ? now.getTime() - slotAt > STALE_AFTER_MS
    : slotAt == null && createdAt != null && now.getTime() - createdAt > STALE_REQUEST_MS;
  return {
    key: `visit-${visit.id}`,
    kind: TODO_KINDS.VISIT,
    id: visit.id,
    rank: stale ? 3 : overdue ? 0 : 1,
    // A stale row is not "en retard" any more: counting it would keep the red
    // "N en retard" on the panel for a request nobody is waiting on.
    overdue: overdue && !stale,
    stale,
    slotAt: slotAt == null ? null : new Date(slotAt).toISOString(),
    // Overdue visits are ordered by how long ago the slot passed; open ones by
    // how long the customer has been waiting for any answer.
    sortAt: overdue ? slotAt : toTime(visit.created_at),
    primary: overdue || stale
      ? { type: 'propose-slot' }
      : { type: 'confirm-visit', prefill },
    secondary: stale ? { type: 'close-visit', href: TODO_CLOSE_VISIT_HREF } : null,
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
    rank: 4,
    // Longest unconfirmed first: negate so the ascending sort puts it on top.
    sortAt: Number.isFinite(Number(listing.daysSince)) ? -Number(listing.daysSince) : null,
    // The availability prompt is on the listing's editor page (and Mes biens).
    primary: { type: 'confirm-availability', href: `/compte/agent/biens/${encodeURIComponent(listing.id)}/edit` },
    listing,
  };
}

function listingIncompleteItem(listing) {
  const gaps = Array.isArray(listing.gaps) ? listing.gaps : [];
  return {
    key: `listing-incomplete-${listing.id}`,
    kind: TODO_KINDS.LISTING_INCOMPLETE,
    id: listing.id,
    rank: 5,
    sortAt: -gaps.length,
    // Straight to the field behind the first gap.
    primary: { type: 'complete', href: listingGapHref(listing.id, gaps[0]) },
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

  const openVisits = unique('v', visits).filter((v) => OPEN_VISIT_STATUSES.has(v.status));
  const visitLeadIds = new Set(openVisits.map((v) => String(v.lead_id ?? v.lead_row_id ?? '')).filter(Boolean));
  const visitAsks = new Set(
    openVisits.map((v) => `${digits(v.lead_wa_id)}|${v.property_id || v.lead_property_id || ''}`),
  );
  const newLeads = unique('l', leads)
    .filter((l) => l.status === 'NEW')
    .filter((l) => !visitLeadIds.has(String(l.id)))
    .filter((l) => !(digits(l.wa_id) && l.property_id && visitAsks.has(`${digits(l.wa_id)}|${l.property_id}`)));

  // Any real name we hold for a number, from either kind of row.
  const names = new Map();
  for (const v of openVisits) if (realName(v.lead_name) && digits(v.lead_wa_id) && !names.has(digits(v.lead_wa_id))) names.set(digits(v.lead_wa_id), realName(v.lead_name));
  for (const l of newLeads) if (realName(l.name) && digits(l.wa_id) && !names.has(digits(l.wa_id))) names.set(digits(l.wa_id), realName(l.name));

  const items = [
    ...openVisits.map((v) => ({
      ...visitItem(v, now),
      customerName: realName(v.lead_name) || names.get(digits(v.lead_wa_id)) || null,
    })),
    ...newLeads.map((l) => ({ ...leadItem(l), customerName: realName(l.name) || names.get(digits(l.wa_id)) || null })),
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
