import 'server-only';
import { getAgentPitchUsage } from './adminApi';

/**
 * How many customer requests an agency may respond to in a calendar month.
 *
 * Replaces `lib/demandFeed.js`, which gated an "Agent Demand Feed" — a
 * marketplace of open requests an agent browsed and pitched into. That pull
 * model is gone (see components/AgentSubscriptionCard.js): requests are now
 * pushed to the best-matched agencies on WhatsApp the moment they are
 * submitted, by the engine's own dispatcher. What survives, and what this
 * module owns, is the *quota* — how many of those an agency may actually
 * work in a month, which is a real subscription entitlement
 * (`packages.monthly_pitch_limit`) and the main thing a paid tier buys.
 *
 * Nothing here gates *access* any more. Every agent receives matched leads;
 * the plan decides how many they may take on. An agency with no plan gets the
 * trial allowance below rather than nothing at all — a new agency has to be
 * able to work a lead before they'll pay for the right to work more of them.
 */

/**
 * The allowance for an agency with no paid package.
 * `packages.monthly_pitch_limit` defaults to 10 for real plans; this is the
 * same figure, so an unsubscribed agency isn't accidentally unlimited.
 */
const DEFAULT_MONTHLY_LEAD_LIMIT = 10;

/**
 * Start of the current calendar month, as an ISO string — the window the
 * engine counts `lead_proposals` rows within.
 *
 * Calendar month, not a rolling 30 days, because "traitées ce mois" is what
 * the UI says and a rolling window would make that sentence a lie (the number
 * would creep back up mid-month as old responses aged out, with nothing on
 * screen explaining why).
 */
export function currentQuotaPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Resolves an agent's monthly quota from the real allowance on their plan and
 * the real count of responses they've already made.
 *
 * @param {{monthly_pitch_limit?: number|null}} agent
 * @param {number} used
 * @returns {{limit: number, used: number, remaining: number, exhausted: boolean}}
 */
export function resolveLeadQuota(agent, used) {
  const limit = Number.isFinite(Number(agent?.monthly_pitch_limit))
    ? Number(agent.monthly_pitch_limit)
    : DEFAULT_MONTHLY_LEAD_LIMIT;
  const safeUsed = Number.isFinite(Number(used)) ? Math.max(0, Number(used)) : 0;
  return {
    limit,
    used: safeUsed,
    remaining: Math.max(0, limit - safeUsed),
    exhausted: safeUsed >= limit,
  };
}

/**
 * Fetches + resolves an agent's quota in one call — the overview page and the
 * dedicated /compte/agent/abonnement page both need exactly this, and
 * duplicating the try/catch around a cross-service fetch in two places is
 * exactly the kind of drift lib/listingView.js's own doc comment warns about.
 *
 * Same degrade-don't-die contract as the rest of this dashboard: the engine
 * being unreachable returns null (no quota bar renders) rather than taking the
 * page down or showing a fabricated number. The write path re-checks the real
 * count server-side before recording a response, so an unreadable count here
 * can never grant one.
 *
 * @param {number} agentId
 * @param {{monthly_pitch_limit?: number|null}} agent
 * @returns {Promise<{limit: number, used: number, remaining: number, exhausted: boolean}|null>}
 */
export async function getAgentLeadQuota(agentId, agent) {
  try {
    const { used } = await getAgentPitchUsage({ agentId, since: currentQuotaPeriodStart() });
    return resolveLeadQuota(agent, used);
  } catch (err) {
    console.warn(`[leadQuota] usage unavailable for agent #${agentId}: ${err.message}`);
    return null;
  }
}
