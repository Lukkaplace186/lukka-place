import 'server-only';
import { cache } from 'react';
import { getPool } from './db';
import { getAdminSession } from './adminSession';
import { getSalesRepIdForAdmin } from './sales';
import { repAgentCondition } from './salesScopeSql';

export { repAgentCondition };

/**
 * What a `sales` console account may see of the network: only the agents its
 * rep brought in. Every other role gets `null` (no scope, the whole network).
 *
 * "Brought in" is the same set the Sales team page counts: an ACTIVE
 * assignment to the rep (`sales_account_assignments`, ended_at NULL) or the
 * rep's permanent launch attribution (`sales_agent_attributions`). A sales
 * account with no rep linked gets repId 0, which matches nobody — never the
 * whole table.
 *
 * The scope is enforced in SQL by each reader (`repAgentCondition`, from
 * lib/salesScopeSql.js), not by filtering rows in JS after a whole-table read.
 */

/** @returns {Promise<null | {repId: number}>} */
export const getSalesScope = cache(async () => {
  const session = await getAdminSession();
  if (!session || session.role !== 'sales') return null;
  const repId = session.id && !session.shared ? await getSalesRepIdForAdmin(session.id).catch(() => null) : null;
  return { repId: repId || 0 };
});

/** The ids of every agent rep `repId` brought in. */
export async function getRepAgentIds(repId) {
  if (!repId) return [];
  const { rows } = await getPool().query(
    `SELECT a.id FROM agents a WHERE a.deleted_at IS NULL AND ${repAgentCondition('a.id', '$1')}`,
    [repId],
  );
  return rows.map((row) => Number(row.id));
}

/** Is this agent inside the scope? A null scope allows everything. */
export async function agentInScope(scope, agentId) {
  if (!scope) return true;
  if (!scope.repId) return false;
  const { rows } = await getPool().query(`SELECT 1 WHERE ${repAgentCondition('$2::bigint', '$1')}`, [scope.repId, agentId]);
  return rows.length > 0;
}

/** Does this agency hold at least one of the scope's agents? A null scope allows everything. */
export async function agencyInScope(scope, vendorId) {
  if (!scope) return true;
  if (!scope.repId) return false;
  const { rows } = await getPool().query(
    `SELECT 1 FROM agents a WHERE a.vendor_id = $2 AND a.deleted_at IS NULL AND ${repAgentCondition('a.id', '$1')} LIMIT 1`,
    [scope.repId, vendorId],
  );
  return rows.length > 0;
}
