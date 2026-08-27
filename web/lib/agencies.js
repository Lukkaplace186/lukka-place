import 'server-only';
import { getPool } from './db';
import { getAgentById } from './agents';
import { getListings } from './listings';

/**
 * Public agent storefront (web/app/(site)/agents/[id]/page.js) — reuses
 * lib/agents.js's getAgentById (Phase 2) rather than re-querying agents/
 * vendors/agent_infos/memberships/packages from scratch, and adds the two
 * things that query doesn't need for the admin table: a bio and the
 * listings feed itself.
 */

/**
 * vendor_infos is per-language, same as agent_infos (confirmed: vendor #36
 * has two rows) — LATERAL + LIMIT 1, same fix Phase 2 already had to make
 * for agent_infos, to avoid fanning out here too.
 */
export async function getAgentProfile(id) {
  const agent = await getAgentById(id);
  if (!agent) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT details FROM vendor_infos
     WHERE vendor_id = $1
     ORDER BY (language_id = 20) DESC, language_id
     LIMIT 1`,
    [agent.vendor_id],
  );

  return { ...agent, bio: rows[0]?.details || null };
}

/**
 * @param {number} agentId
 * @param {{transactionType?: string, propertyType?: string, commune?: string, limit?: number, offset?: number}} [filters]
 */
export async function getAgentListings(agentId, filters = {}) {
  return getListings({ ...filters, agentId, limit: filters.limit ?? 24 });
}

/**
 * Private dashboard (Phase 4D) — deliberately NOT getListings()/getAgentListings():
 * those apply APPROVED_FILTER (status=1 AND approve_status=1), which is
 * correct for the public storefront but wrong here — an agent managing
 * their own listings needs to see a pending/rejected one too, not have it
 * silently vanish from their own dashboard.
 */
export async function getOwnListingsForDashboard(agentId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.price, p.purpose, p.approve_status, p.listing_status, p.featured_image, p.quartier,
            pc.title
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.agent_id = $1
     ORDER BY p.created_at DESC`,
    [agentId],
  );
  return rows;
}

/**
 * The one display-name computation every agent-dashboard page needs —
 * previously duplicated ad hoc per file (and with a different fallback
 * string in each copy). Also what submitInquiryAction
 * (web/app/(site)/agents/[id]/actions.js) writes into a general inquiry's
 * `assigned_agent` column, so the dashboard's own lead queries can match
 * against it exactly — see services/db.js's listLeads doc comment.
 */
export function agentDisplayName(agent) {
  return [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') || agent?.username || null;
}
