/**
 * What an agent may do next with a viewing request, by its current status.
 *
 * One table, read by AgentVisitRequestCard (which buttons exist) and by
 * updateViewingRequestAction (what it will send). The engine's
 * services/viewingNotifications.js `DASHBOARD_TRANSITIONS` enforces the same
 * rule authoritatively and is deliberately duplicated rather than shared — it
 * is CommonJS in another app. Change one, change the other.
 *
 * The rules carry meaning, not just UI tidiness:
 *  - Confirm is not offered on a visit that is already CONFIRMED. The card used
 *    to show it on every row, and a second confirmation messages the customer
 *    a second time.
 *  - Before a visit is agreed the refusal is DECLINED; after, it is CANCELLED.
 *    They are different facts (root CLAUDE.md, "Status vocabulary"): only a
 *    decline sends the customer alternatives, and collapsing the two makes
 *    agent response rate unmeasurable.
 *  - RESCHEDULED can follow RESCHEDULED — a second proposal is a real answer.
 *  - DECLINED, CANCELLED and COMPLETED are settled; the agent can do nothing.
 */
export const AGENT_VIEWING_ACTIONS = Object.freeze({
  PENDING: Object.freeze(['CONFIRMED', 'RESCHEDULED', 'DECLINED']),
  RESCHEDULED: Object.freeze(['CONFIRMED', 'RESCHEDULED', 'DECLINED']),
  CONFIRMED: Object.freeze(['RESCHEDULED', 'CANCELLED']),
  DECLINED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  COMPLETED: Object.freeze([]),
});

/** Every status an agent can ever set from the dashboard. */
export const AGENT_SETTABLE_VIEWING_STATUSES = Object.freeze(['CONFIRMED', 'RESCHEDULED', 'DECLINED', 'CANCELLED']);

/** @returns {readonly string[]} the statuses this request can move to next. */
export function agentActionsFor(status) {
  return AGENT_VIEWING_ACTIONS[status] || [];
}

export function canAgentSetStatus(current, next) {
  return agentActionsFor(current).includes(next);
}
