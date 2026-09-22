import 'server-only';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName } from './agencies';
import { listViewingRequests } from './adminApi';

/**
 * "Is this viewing request one of this agent's own?" — the one rule behind the
 * Visites tab's answers (updateViewingRequestAction) and the agenda's .ics
 * download, so the two cannot disagree about who may see a customer's name,
 * phone and appointment.
 *
 * viewing_requests carries no agent column of its own (services/db.js's
 * listViewingRequestsForOwner, engine repo), so ownership is derived the same
 * property_ids-OR-assigned_agent way, one hop through the parent lead. An
 * agent with neither signal owns nothing — never "everything".
 *
 * `status` narrows the engine read when the caller already knows it (the
 * agenda only exports CONFIRMED visits), which keeps an agent with a long
 * history inside the engine's page size.
 *
 * @returns {Promise<Object|null>} the engine row, or null when it is not theirs
 */
export async function findOwnedViewingRequest(agentId, viewingRequestId, { status } = {}) {
  const [agent, listings] = await Promise.all([getAgentProfile(agentId), getOwnListingsForDashboard(agentId)]);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);
  if (!propertyIds.length && !displayName) return null;
  const { data } = await listViewingRequests({ propertyIds, assignedAgent: displayName || undefined, status, limit: 200 });
  return data.find((v) => v.id === viewingRequestId) || null;
}
