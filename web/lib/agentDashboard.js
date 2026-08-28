import 'server-only';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName, agentProfileCompletion } from './agencies';
import { listLeads } from './adminApi';

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
  const leadScope = { propertyIds, assignedAgent: displayName || undefined };
  const hasLeadScope = propertyIds.length > 0 || !!displayName;

  const { total: newLeadsCount } = hasLeadScope
    ? await listLeads({ ...leadScope, status: 'NEW', limit: 1 })
    : { total: 0 };

  return {
    agent,
    listings,
    propertyIds,
    listingById: new Map(listings.map((l) => [l.id, l])),
    displayName,
    leadScope,
    hasLeadScope,
    newLeadsCount,
    completion: agentProfileCompletion(agent, { listingCount: listings.length }),
  };
}
