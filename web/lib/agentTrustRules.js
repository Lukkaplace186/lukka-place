/**
 * The trust facts shown beside the agent on a listing page (2026-11-21,
 * marketing plan: the agent block said only "Jossy · Agent partenaire" while
 * Kinshasa renters' first fear is a commissionnaire who is not who they say).
 * Only facts the database proves, never a negative ("non vérifié"):
 *
 *  - "Numéro vérifié" when the listing carries `agent_phone` — lib/listings.js
 *    returns it only for an agent with `phone_verified_at` and direct routing
 *    on, so it is a subset of verified agents, never a claim beyond it.
 *  - "N biens en ligne" from the public gate (getAgentTrackRecord liveCount),
 *    from 1.
 *  - "N biens loués ou vendus" (closedCount), from 1.
 *
 * Pure: returns the keys and counts; the component translates them.
 */
export function agentTrustFacts({ agentPhone = null, liveCount = 0, closedCount = 0 } = {}) {
  const facts = [];
  if (typeof agentPhone === 'string' && agentPhone.trim() !== '') facts.push({ key: 'phoneVerified' });
  const live = Number.parseInt(liveCount, 10);
  if (Number.isInteger(live) && live >= 1) facts.push({ key: 'live', count: live });
  const closed = Number.parseInt(closedCount, 10);
  if (Number.isInteger(closed) && closed >= 1) facts.push({ key: 'closed', count: closed });
  return facts;
}
