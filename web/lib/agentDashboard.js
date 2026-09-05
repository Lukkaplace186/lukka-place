import 'server-only';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName, agentProfileCompletion } from './agencies';
import { listLeads, listViewingRequests } from './adminApi';

/**
 * The context every /compte/agent/** surface needs before it can render its
 * own content: who the agent is, which listings are theirs, and how many
 * leads are sitting unworked.
 *
 * This exists because the design puts shared chrome in two places at once —
 * the sidebar (owned by the layout: nav counts + profile-completion card)
 * and the sticky page header (owned by each page: title, search, the
 * notification bell's badge). A layout can't pass props down to a page in
 * the App Router, so without this both would re-derive the same three
 * things by hand, with the counts free to drift apart on screen.
 *
 * `newLeadsCount` and the lead-ownership scope both go through the same
 * property_ids-OR-assigned_agent rule the rest of the dashboard uses (see
 * services/db.js's listLeads), so a general enquiry with no property
 * attached still counts here exactly as it does on the Demandes page.
 */
export async function getAgentDashboardContext(agentId) {
  const agent = await getAgentProfile(agentId);
  if (!agent) return null;

  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);
  const displayName = agentDisplayName(agent);
  // Four ownership signals, OR-ed by the engine (services/db.js's listLeads):
  // a lead on one of this agent's listings, one addressed to them by name,
  // one assigned to them by id, and — added with the automated dispatcher —
  // one the engine PUSHED to them. The last is what makes the WhatsApp alert
  // and the dashboard agree: an agent alerted about a request must find that
  // request here, even though it names no listing of theirs.
  const leadScope = { propertyIds, assignedAgent: displayName || undefined, matchedAgentId: agentId };
  // Always true now — matchedAgentId is always present — but kept as the
  // single place that decides, rather than deleting the concept and having
  // three call sites assume it.
  const hasLeadScope = propertyIds.length > 0 || !!displayName || Number.isFinite(Number(agentId));

  const [{ total: newLeadsCount }, { total: pendingVisitsCount }] = await Promise.all([
    hasLeadScope ? listLeads({ ...leadScope, status: 'NEW', limit: 1 }) : Promise.resolve({ total: 0 }),
    hasLeadScope ? listViewingRequests({ ...leadScope, status: 'PENDING', limit: 1 }) : Promise.resolve({ total: 0 }),
  ]);

  return {
    agent,
    listings,
    propertyIds,
    // Keyed by String(id): properties.id is a Postgres bigint (returned as a
    // string by node-postgres), while a lead/viewing-request's property_id
    // comes from the engine's SQLite as a plain number — a bare `l.id` key
    // silently never matched any lookup by the numeric form (caught live
    // while testing the Agent Demand Feed: every property-attached lead's
    // "target" listing resolved to null everywhere this Map is consulted —
    // demandes/page.js, visites/page.js, AgentRecentLeads.js).
    listingById: new Map(listings.map((l) => [String(l.id), l])),
    displayName,
    leadScope,
    hasLeadScope,
    newLeadsCount,
    pendingVisitsCount,
    completion: agentProfileCompletion(agent, { listingCount: listings.length }),
  };
}
