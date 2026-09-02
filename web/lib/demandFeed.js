import 'server-only';
import { getAgentPitchUsage } from './adminApi';

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

/**
 * The pitch allowance for an agent with no paid package — i.e. everyone
 * currently on the platform-wide launch trial. `packages.monthly_pitch_limit`
 * defaults to 10 for real plans; this is the same figure for the trial, so
 * the trial isn't accidentally unlimited while it lasts.
 */
const TRIAL_MONTHLY_PITCH_LIMIT = 10;

/**
 * Start of the current calendar month, as an ISO string — the window the
 * engine counts `lead_proposals` rows within.
 *
 * Calendar month, not a rolling 30 days, because "propositions restantes ce
 * mois" is what the UI says and a rolling window would make that sentence a
 * lie (the number would creep back up mid-month as old pitches aged out,
 * with nothing on screen explaining why).
 */
export function currentPitchPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Resolves an agent's monthly pitch quota from the real allowance on their
 * plan and the real count of pitches they've already made.
 *
 * `used` comes from the engine (lib/adminApi.js's getAgentPitchUsage) and is
 * a count of actual lead_proposals rows — never an estimate. `limit` comes
 * from packages.monthly_pitch_limit, falling back to the trial allowance for
 * an agent whose access is the launch trial rather than a paid plan.
 *
 * @param {{monthly_pitch_limit?: number|null, package_title?: string|null}} agent
 * @param {number} used
 * @returns {{limit: number, used: number, remaining: number, exhausted: boolean}}
 */
export function resolvePitchQuota(agent, used) {
  const limit = Number.isFinite(Number(agent?.monthly_pitch_limit))
    ? Number(agent.monthly_pitch_limit)
    : TRIAL_MONTHLY_PITCH_LIMIT;
  const safeUsed = Number.isFinite(Number(used)) ? Math.max(0, Number(used)) : 0;
  return {
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
    exhausted: safeUsed >= limit,
  };
}

/**
 * Fetches + resolves an agent's pitch quota in one call — the overview page
 * and the dedicated /compte/agent/abonnement page both need exactly this,
 * and duplicating the try/catch around a third-party fetch in two places is
 * exactly the kind of drift lib/listingView.js's own doc comment warns
 * about. Same degrade-don't-die contract as the rest of this dashboard: the
 * engine being unreachable returns null (no quota line renders) rather than
 * taking the page down or showing a fabricated number.
 *
 * @param {number} agentId
 * @param {{monthly_pitch_limit?: number|null, package_title?: string|null}} agent
 * @returns {Promise<{limit: number, used: number, remaining: number, exhausted: boolean}|null>}
 */
export async function getAgentPitchQuota(agentId, agent) {
  try {
    const { used } = await getAgentPitchUsage({ agentId, since: currentPitchPeriodStart() });
    return resolvePitchQuota(agent, used);
  } catch (err) {
    console.warn(`[demandFeed] pitch usage unavailable for agent #${agentId}: ${err.message}`);
    return null;
  }
}
