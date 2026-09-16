/**
 * Listing limits — the pure half, shared by the Server Actions, the agent
 * dashboard and the tests. lib/listingQuota.js reads the numbers.
 *
 * WHAT THE LIMIT IS: `packages.number_of_property` of the agency's active
 * membership. An agency is a vendor, so the listings of every agent in it
 * count together. Several active memberships (a plan plus the photography
 * add-on) → the most generous listing allowance applies; a package with no
 * listing allowance (0 or NULL — e.g. "Photography Service") is not a listing
 * plan and sets no cap. No active membership → no plan has been assigned yet,
 * so nothing is capped: an agent is never blocked by a plan they are not on.
 *
 * WHAT COUNTS: a listing that occupies a slot — visible (`status = 1`) and not
 * rejected (`approve_status` 0 pending or 1 approved) and not closed. Pending
 * listings count, or an agent could queue 50 for moderation on a 5-listing
 * plan. Archived, rejected and sold/let listings free their slot, which is the
 * way out the upgrade message names besides upgrading.
 */

export const UPGRADE_PATH = '/compte/agent/abonnement';

export const QUOTA_COUNTED_SQL = "p.status = 1 AND p.approve_status IN (0, 1) AND COALESCE(p.listing_status, 'active') <> 'closed'";

/**
 * @param {{limit: number|null, used: number, planTitle?: string|null}} quota
 * @param {number} [adding] listings the action would add (a multi-unit building adds several)
 * @returns {{capped: boolean, limit: number|null, used: number, remaining: number|null, blocked: boolean, atLimit: boolean, planTitle: string|null}}
 */
export function quotaState(quota, adding = 1) {
  const limit = Number.isFinite(Number(quota?.limit)) && Number(quota.limit) > 0 ? Math.floor(Number(quota.limit)) : null;
  const used = Math.max(0, Math.floor(Number(quota?.used) || 0));
  const add = Math.max(0, Math.floor(Number(adding) || 0));
  if (limit == null) {
    return { capped: false, limit: null, used, remaining: null, blocked: false, atLimit: false, planTitle: quota?.planTitle || null };
  }
  const remaining = Math.max(0, limit - used);
  return {
    capped: true,
    limit,
    used,
    remaining,
    blocked: add > remaining,
    atLimit: used >= limit,
    planTitle: quota?.planTitle || null,
  };
}

/**
 * The refusal a Server Action returns: the message, and the numbers the
 * dialog needs to show the upgrade call-to-action.
 */
export function quotaRefusal(t, state) {
  return {
    ok: false,
    error: t('agent.quota.reached', { limit: state.limit, plan: state.planTitle || t('agent.quota.currentPlan') }),
    quota: { limit: state.limit, used: state.used, plan: state.planTitle, upgradeHref: UPGRADE_PATH },
  };
}

/** Raised in the browser when an action is refused for the listing limit; ListingLimitDialog listens. */
export const LISTING_QUOTA_EVENT = 'lukka:listing-quota';

export function announceListingQuota(quota) {
  if (typeof window === 'undefined' || !quota) return;
  window.dispatchEvent(new CustomEvent(LISTING_QUOTA_EVENT, { detail: quota }));
}
