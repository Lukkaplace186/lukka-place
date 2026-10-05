/**
 * One listing, one state — and the filter chips on Mes biens built from it.
 * Pure and client-safe: the overview's "Biens en ligne" figure, the chips'
 * counts and each card's badge all read this file, so they cannot disagree.
 *
 * Before this (2026-10-05) they did: the overview counted approved + active
 * listings (18) while the "En ligne" chip counted every non-archived active
 * listing, including the ones still waiting for moderation (20).
 *
 * The three lifecycle axes stay separate in the data (web/CLAUDE.md,
 * "Listing lifecycle"); this picks the one that matters to the agent now, in
 * this order: closed, archived, rejected, pending review, under offer, live.
 */
export function agentListingState(listing) {
  if (listing?.listing_status === 'closed') return 'closed';
  if (Number(listing?.status) === 0) return 'archived';
  if (Number(listing?.approve_status) === 2) return 'rejected';
  if (Number(listing?.approve_status) !== 1) return 'pending';
  if (listing?.listing_status === 'under_offer') return 'under_offer';
  return 'live';
}

/**
 * On the public site: approved, visible, not closed. Under offer is included —
 * the public page still exists and says "Sous offre".
 */
export function isLiveListing(listing) {
  const state = agentListingState(listing);
  return state === 'live' || state === 'under_offer';
}

/**
 * `?status=` values. 'active' is kept as the URL value for "En ligne" so
 * existing links (the overview's figure, bookmarks) keep working. 'review' is
 * "En revue": submitted and waiting for moderation. The grey "Brouillon"
 * badge is NOT a filter here: a draft is a form saved on the phone and not yet
 * sent (lib/offlineDrafts.js), so it is not a listing row at all.
 */
export function matchesListingFilter(listing, filter, gapsByListing = {}) {
  if (!filter) return true;
  const state = agentListingState(listing);
  switch (filter) {
    case 'active':
      return state === 'live' || state === 'under_offer';
    case 'review':
      return state === 'pending';
    case 'under_offer':
      return state === 'under_offer';
    case 'incomplete':
      return Boolean(gapsByListing[String(listing.id)]);
    case 'closed':
    case 'archived':
    case 'rejected':
      return state === filter;
    default:
      return false;
  }
}

/**
 * The chips, in order. `always` chips show even at 0; the others only when
 * they hold something (or are selected), so a phone row stays short while a
 * let/sold, archived or refused listing is still reachable.
 */
export const LISTING_FILTER_PILLS = [
  { value: '', labelKey: 'agent.listings.filters.all', always: true },
  { value: 'active', labelKey: 'agent.listings.filters.live', always: true },
  { value: 'incomplete', labelKey: 'agent.listings.filters.incomplete' },
  { value: 'review', labelKey: 'agent.listings.filters.review', always: true },
  { value: 'under_offer', labelKey: 'agent.listings.filters.underOffer', always: true },
  { value: 'closed', labelKey: 'agent.listings.soldOrLet' },
  { value: 'rejected', labelKey: 'agent.listings.filters.rejected' },
  { value: 'archived', labelKey: 'agent.listings.archived' },
];

export const LISTING_FILTER_VALUES = new Set(LISTING_FILTER_PILLS.map((pill) => pill.value));
