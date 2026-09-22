import 'server-only';
import { listLeads, listViewingRequests } from './adminApi';
import { buildAgentTodo } from './agentTodo';
import { getListingsNeedingConfirmation } from './listingAvailability';
import { getIncompleteListings } from './completeness';
import { todaysRemainingVisits } from './visitAgenda';

/**
 * Fetches what "À faire aujourd'hui" and the morning banner rank, for one
 * agent's dashboard context (lib/agentDashboard.js). Same ownership scope as
 * every other agent read — the engine ORs property_ids / assigned_agent — so
 * the list can never show a request the Demandes tab would not.
 *
 * Degrade, don't die: each engine read that fails is reported in `degraded`
 * and contributes nothing, so the overview still renders and the list says it
 * may be incomplete instead of claiming "rien à faire".
 */
export async function loadAgentTodo(context, { now = new Date(), limit } = {}) {
  const { agentId, leadScope, hasLeadScope } = context || {};
  // Both listing sources degrade on their own (42703/42P01 before the
  // migrations, any read failure) and return [].
  const listingSources = agentId
    ? Promise.all([
        getListingsNeedingConfirmation(agentId, { limit: 20, now }).catch(() => []),
        getIncompleteListings(agentId, { limit: 20 }).catch(() => []),
      ])
    : Promise.resolve([[], []]);
  if (!hasLeadScope) {
    const [listingsToConfirm, incompleteListings] = await listingSources;
    return { ...buildAgentTodo({ listingsToConfirm, incompleteListings, now, limit }), todayVisits: [], confirmedVisits: [], degraded: [] };
  }

  const degraded = [];
  const safe = (label, promise) =>
    promise.then(
      (page) => page?.data || [],
      (err) => {
        console.error(`[agentTodo] ${label} failed: ${err.message}`);
        degraded.push(label);
        return [];
      },
    );

  const [pending, rescheduled, confirmed, newLeads] = await Promise.all([
    safe('visits', listViewingRequests({ ...leadScope, status: 'PENDING', limit: 50 })),
    safe('visits', listViewingRequests({ ...leadScope, status: 'RESCHEDULED', limit: 50 })),
    safe('agenda', listViewingRequests({ ...leadScope, status: 'CONFIRMED', limit: 100 })),
    safe('leads', listLeads({ ...leadScope, status: 'NEW', limit: 50 })),
  ]);

  const [listingsToConfirm, incompleteListings] = await listingSources;

  const todo = buildAgentTodo({
    visits: [...pending, ...rescheduled],
    leads: newLeads,
    listingsToConfirm,
    incompleteListings,
    now,
    limit,
  });

  return {
    ...todo,
    confirmedVisits: confirmed,
    todayVisits: todaysRemainingVisits(confirmed, now),
    degraded: [...new Set(degraded)],
  };
}
