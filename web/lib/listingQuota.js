import 'server-only';
import { getPool } from './db';
import { QUOTA_COUNTED_SQL, quotaState } from './listingQuotaRules';

/**
 * The agent's listing allowance and how much of it is used — the rules are in
 * lib/listingQuotaRules.js. One query. The engine's WhatsApp confirmation
 * applies the same SQL (services/listingQuota.js): change one, change the other.
 */
export const LISTING_QUOTA_SQL = `
  SELECT a.id, a.vendor_id,
         q.listing_limit, q.plan_title,
         (SELECT COUNT(*)::int FROM properties p
          WHERE ${QUOTA_COUNTED_SQL}
            AND (p.agent_id = a.id
                 OR (a.vendor_id IS NOT NULL AND a.vendor_id <> 0
                     AND p.agent_id IN (SELECT o.id FROM agents o WHERE o.vendor_id = a.vendor_id)))) AS used
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT pk.number_of_property AS listing_limit, pk.title AS plan_title
    FROM memberships m JOIN packages pk ON pk.id = m.package_id
    WHERE m.vendor_id = a.vendor_id AND m.status = 1 AND m.expire_date > NOW() AND pk.number_of_property > 0
    ORDER BY pk.number_of_property DESC, m.expire_date DESC
    LIMIT 1
  ) q ON true
  WHERE a.id = $1`;

/** @returns {Promise<ReturnType<typeof quotaState> | null>} null when the agent does not exist */
export async function getListingQuota(agentId, adding = 1) {
  const { rows } = await getPool().query(LISTING_QUOTA_SQL, [agentId]);
  if (!rows[0]) return null;
  return quotaState({ limit: rows[0].listing_limit, used: rows[0].used, planTitle: rows[0].plan_title }, adding);
}
