import 'server-only';
import { getPool } from './db';
import { COMMUNE_SUBQUERY, getListings, getListingsByIds } from './listings';
import { listLeads, listViewingRequests } from './adminApi';
import { getAgentDashboardContext } from './agentDashboard';
import { alternativesCriteria, rankAlternatives, alternativeSummary, MAX_ALTERNATIVES } from './listingAlternatives';

/**
 * Server half of "Proposer des alternatives" (the pure rules are in
 * lib/listingAlternatives.js). Resolves the lead or visit the agent is
 * answering — only one of their own — and the candidate listings.
 *
 * Ownership uses the dashboard's full lead scope (getAgentDashboardContext),
 * including `matchedAgentId`: a request the dispatcher pushed to this agency
 * is shown on their Demandes page, and it is exactly the kind of request
 * alternatives are for. The customer's number is always read off the stored
 * row, never taken from the client.
 */

const CANDIDATE_LIMIT = 60;
const PUBLIC_LIMIT = 30;

/*
 * getListings / getListingsByIds already apply the public gate in SQL
 * (status = 1 AND approve_status = 1) but do not SELECT those two columns.
 * rankAlternatives runs shareBlocker, which reads them — so without this every
 * row read as "pending" and was dropped, and the dialog always said "Aucun
 * bien ne correspond" (reported 2026-09-22). Stamping them is not a guess:
 * the WHERE clause that returned the row is what proves them.
 */
function asPublicRows(rows) {
  return (rows || []).map((row) => ({ ...row, status: 1, approve_status: 1 }));
}

/**
 * @param {number} agentId
 * @param {'lead'|'visit'} kind
 * @param {number} id
 * @returns {Promise<{kind, id, waId: string, name: string|null, lead: Object|null, propertyId: string|null, leadId: number}|null>}
 */
export async function resolveOwnedTarget(agentId, kind, id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;
  const context = await getAgentDashboardContext(agentId);
  if (!context) return null;

  if (kind === 'lead') {
    const { data } = await listLeads({ ...context.leadScope, limit: 200 });
    const lead = (data || []).find((l) => Number(l.id) === numericId);
    if (!lead) return null;
    return {
      kind,
      id: numericId,
      leadId: numericId,
      waId: lead.wa_id,
      name: lead.name || null,
      lead,
      propertyId: lead.property_id != null ? String(lead.property_id) : null,
    };
  }

  if (kind === 'visit') {
    const { propertyIds, displayName } = context;
    if (!propertyIds.length && !displayName) return null;
    const { data } = await listViewingRequests({ propertyIds, assignedAgent: displayName || undefined, limit: 200 });
    const visit = (data || []).find((v) => Number(v.id) === numericId);
    if (!visit) return null;
    const propertyId = visit.property_id ?? visit.lead_property_id;
    return {
      kind,
      id: numericId,
      leadId: visit.lead_id,
      waId: visit.lead_wa_id,
      name: visit.lead_name || null,
      lead: { commune: visit.lead_commune || null },
      propertyId: propertyId != null ? String(propertyId) : null,
    };
  }
  return null;
}

/**
 * The listing the customer asked about, in ANY state — it is usually no
 * longer public (déjà loué), which is the whole point. Scoped to this agent:
 * another agency's listing contributes nothing but its id to exclude.
 */
export async function getOwnListingReference(agentId, propertyId) {
  if (propertyId == null) return null;
  const { rows } = await getPool().query(
    `SELECT p.id, p.purpose, p.price, p.beds, ${COMMUNE_SUBQUERY}
     FROM properties p
     WHERE p.id = $1 AND p.agent_id = $2`,
    [propertyId, agentId],
  );
  return rows[0] || null;
}

const TRANSACTION_BY_PURPOSE = { rent: 'location', sale: 'vente' };

/**
 * Suggestions for one owned lead or visit: the agent's own live listings
 * first, and — with `includePublic` — other agencies' public listings after
 * them. A public search scoped to the requested communes that finds nothing
 * is retried city-wide, flagged `widened`, the same honesty convention as the
 * engine's propertyMatching.
 */
export async function getAlternativeSuggestions(agentId, target, { includePublic = false } = {}) {
  const reference = await getOwnListingReference(agentId, target.propertyId);
  const criteria = alternativesCriteria({ lead: target.lead, listing: reference });
  const excludeIds = [target.propertyId].filter(Boolean);
  const transactionType = TRANSACTION_BY_PURPOSE[criteria.purpose];

  let ownRanked = rankAlternatives(
    asPublicRows((await getListings({ agentId, transactionType, limit: CANDIDATE_LIMIT })).data),
    criteria,
    { excludeIds },
  );
  // Never a dead end: when nothing of theirs matches the request's purpose,
  // show every live listing they have and let the agent choose (flagged, so
  // the dialog says these are not matches).
  let ownWidened = false;
  if (ownRanked.length === 0 && transactionType) {
    ownRanked = rankAlternatives(
      asPublicRows((await getListings({ agentId, limit: CANDIDATE_LIMIT })).data),
      { ...criteria, purpose: null },
      { excludeIds },
    );
    ownWidened = ownRanked.length > 0;
  }
  const ownIds = new Set(ownRanked.map((e) => String(e.listing.id)));
  // Nothing of their own to offer at all: widen to other agencies at once
  // rather than showing an empty dialog behind an unticked checkbox.
  if (ownRanked.length === 0) includePublic = true;

  let others = [];
  let widened = false;
  if (includePublic) {
    const communes = criteria.communes.slice(0, 3);
    let rows = [];
    if (communes.length) {
      const results = await Promise.all(
        communes.map((commune) => getListings({ transactionType, commune, limit: PUBLIC_LIMIT })),
      );
      rows = asPublicRows(results.flatMap((r) => r.data));
    }
    if (rows.length === 0) {
      rows = asPublicRows((await getListings({ transactionType, limit: PUBLIC_LIMIT })).data);
      widened = communes.length > 0 && rows.length > 0;
    }
    others = rankAlternatives(
      rows.filter((l) => !ownIds.has(String(l.id)) && Number(l.agent_id) !== Number(agentId)),
      criteria,
      { excludeIds },
    );
  }

  return {
    criteria,
    own: ownRanked.slice(0, 20).map((e) => alternativeSummary(e, { own: true })),
    others: others.slice(0, 20).map((e) => alternativeSummary(e)),
    widened,
    ownWidened,
    includePublic,
  };
}

/**
 * The listings an agent picked, re-read under the public filter. Anything
 * gone, not active, excluded or duplicated fails the whole send rather than
 * silently sending two of the three the agent chose.
 *
 * @returns {Promise<{ok: true, listings: Object[]}|{ok: false, reason: 'count'|'excluded'|'unavailable'}>}
 */
export async function loadChosenAlternatives(target, propertyIds) {
  const ids = [...new Set((propertyIds || []).map((id) => String(id)).filter((id) => /^\d+$/.test(id)))];
  if (ids.length === 0 || ids.length > MAX_ALTERNATIVES || ids.length !== (propertyIds || []).length) {
    return { ok: false, reason: 'count' };
  }
  if (target.propertyId && ids.includes(String(target.propertyId))) return { ok: false, reason: 'excluded' };

  const rows = asPublicRows(await getListingsByIds(ids));
  const offerable = rankAlternatives(rows, {}, {}).map((e) => e.listing);
  if (offerable.length !== ids.length) return { ok: false, reason: 'unavailable' };
  const byId = new Map(offerable.map((l) => [String(l.id), l]));
  return { ok: true, listings: ids.map((id) => byId.get(id)) };
}
