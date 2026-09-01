import 'server-only';

/**
 * Agent Demand Feed access — a platform-wide launch trial (env-configurable
 * end date, so extending/ending it never needs a code change, same reasoning
 * SEARCH_ALERT_TEMPLATE is env-driven) OR a real active membership
 * (`agent.package_title`, already selected via AGENT_FIELDS/AGENT_JOINS in
 * lib/agents.js). Checked both when rendering the feed and again inside
 * proposeListingAction — never trust the client rendered the locked state.
 */
const FALLBACK_LAUNCH_TRIAL_ENDS_AT = '2026-11-01';

function launchTrialEndDate() {
  return new Date(process.env.DEMAND_FEED_LAUNCH_TRIAL_ENDS_AT || FALLBACK_LAUNCH_TRIAL_ENDS_AT);
}

export function isWithinLaunchTrial() {
  const end = launchTrialEndDate();
  return !Number.isNaN(end.getTime()) && Date.now() < end.getTime();
}

/** @param {{package_title?: string|null}} agent */
export function hasDemandFeedAccess(agent) {
  return isWithinLaunchTrial() || !!agent?.package_title;
}

/** Human-readable trial end date for the banner/paywall copy, or null if unset/invalid. */
export function launchTrialEndsAtLabel() {
  const end = launchTrialEndDate();
  if (Number.isNaN(end.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(end);
}
