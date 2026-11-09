import 'server-only';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName } from './agencies';
import { listLeads } from './adminApi';

/**
 * "Is this lead one of this agent's own?" — the same ownership signals the
 * Demandes inbox shows (lib/agentDashboard.js leadScope: the agent's
 * property_ids, assigned_agent by name, the dispatcher's matchedAgentId) plus
 * the lead's own agent_id (profile enquiries, desk introductions). The engine
 * ORs them (services/db.js listLeads).
 *
 * Before 2026-11-09 the lead-card actions checked only property_ids and the
 * name, so the reply box refused exactly the leads the dispatcher pushed.
 * A plain module, not a Server Action: it takes the agent id as an argument,
 * so it must never be callable from the browser — callers pass the id from
 * their own verified session.
 *
 * @returns {Promise<Object|null>} the engine lead row, or null when it is not theirs
 */
export async function findOwnedLead(agentId, leadId) {
  const [agent, listings] = await Promise.all([getAgentProfile(agentId), getOwnListingsForDashboard(agentId)]);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);
  const { data } = await listLeads({
    propertyIds,
    assignedAgent: displayName || undefined,
    agentId,
    matchedAgentId: agentId,
    limit: 200,
  });
  return data.find((l) => l.id === leadId) || null;
}
