import 'server-only';
import { getPool } from './db';

/**
 * Agency branches (`agency_branches`, `agency_branch_agents` — see
 * migrations/20260915_agency_branches.sql). An agency with forty agents across
 * Gombe, Limete and Ngaliema is run office by office; this is the office.
 *
 * Every write is scoped by the agency in its own WHERE clause, not only by the
 * page that called it: a branch id from agency A can never be edited through
 * agency B's page, and an agent can only join a branch of the agency they
 * currently belong to.
 */

export const BRANCH_NAME_MAX = 80;
const BULK_LIMIT = 500;

function cleanIds(values) {
  return [...new Set((values || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, BULK_LIMIT);
}

/** Live branches of one agency, with how many of the agency's agents sit in each. */
export async function listAgencyBranches(vendorId) {
  const { rows } = await getPool().query(
    `SELECT b.id, b.name, b.commune, b.phone, b.created_at,
            COUNT(a.id)::int AS agents,
            COUNT(a.id) FILTER (WHERE a.status = 1)::int AS active_agents
     FROM agency_branches b
     LEFT JOIN agency_branch_agents ba ON ba.branch_id = b.id
     LEFT JOIN agents a ON a.id = ba.agent_id AND a.vendor_id = b.vendor_id
     WHERE b.vendor_id = $1 AND b.archived_at IS NULL
     GROUP BY b.id
     ORDER BY LOWER(b.name), b.id`,
    [vendorId],
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/** Agents of the agency in no live branch of it. */
export async function countUnassignedAgents(vendorId) {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM agents a
     WHERE a.vendor_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM agency_branch_agents ba
         JOIN agency_branches b ON b.id = ba.branch_id AND b.archived_at IS NULL AND b.vendor_id = a.vendor_id
         WHERE ba.agent_id = a.id
       )`,
    [vendorId],
  );
  return rows[0]?.n ?? 0;
}

/** @returns {Promise<{id: number}|{errorKey: string}>} */
export async function createAgencyBranch({ vendorId, name, commune = null, phone = null, adminId = null }) {
  const pool = getPool();
  const vendor = await pool.query('SELECT 1 FROM vendors WHERE id = $1', [vendorId]);
  if (vendor.rows.length === 0) return { errorKey: 'admin.branches.agencyMissing' };
  const { rows } = await pool.query(
    `INSERT INTO agency_branches (vendor_id, name, commune, phone, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vendor_id, LOWER(name)) WHERE archived_at IS NULL DO NOTHING
     RETURNING id`,
    [vendorId, name, commune, phone, adminId],
  );
  return rows[0] ? { id: Number(rows[0].id) } : { errorKey: 'admin.branches.duplicate' };
}

/** @returns {Promise<{id: number}|{errorKey: string}>} */
export async function updateAgencyBranch({ vendorId, branchId, name, commune = null, phone = null }) {
  try {
    const { rows } = await getPool().query(
      `UPDATE agency_branches SET name = $3, commune = $4, phone = $5, updated_at = NOW()
       WHERE id = $2 AND vendor_id = $1 AND archived_at IS NULL
       RETURNING id`,
      [vendorId, branchId, name, commune, phone],
    );
    return rows[0] ? { id: Number(rows[0].id) } : { errorKey: 'admin.branches.notFound' };
  } catch (err) {
    if (err.code === '23505') return { errorKey: 'admin.branches.duplicate' };
    throw err;
  }
}

/**
 * Archive a branch and release its agents (they become "no branch", they are
 * not moved anywhere). One transaction, so a branch is never archived with
 * agents still pointing at it.
 * @returns {Promise<{released: number}|{errorKey: string}>}
 */
export async function archiveAgencyBranch({ vendorId, branchId }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const archived = await client.query(
      `UPDATE agency_branches SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND vendor_id = $1 AND archived_at IS NULL
       RETURNING id`,
      [vendorId, branchId],
    );
    if (archived.rows.length === 0) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.branches.notFound' };
    }
    const released = await client.query('DELETE FROM agency_branch_agents WHERE branch_id = $1', [branchId]);
    await client.query('COMMIT');
    return { released: released.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Put agents into a branch, or take them out of any branch (`branchId` null).
 * Agents outside the agency, and a branch outside it or archived, simply match
 * no row — the count returned is what really changed.
 * @returns {Promise<{changedIds: number[]}>}
 */
export async function assignAgentsToBranch({ vendorId, branchId, agentIds, adminId = null }) {
  const ids = cleanIds(agentIds);
  if (ids.length === 0) return { changedIds: [] };
  const pool = getPool();
  if (branchId == null) {
    const { rows } = await pool.query(
      `DELETE FROM agency_branch_agents ba
       USING agents a
       WHERE ba.agent_id = a.id AND a.vendor_id = $1 AND ba.agent_id = ANY($2::bigint[])
       RETURNING ba.agent_id`,
      [vendorId, ids],
    );
    return { changedIds: rows.map((row) => Number(row.agent_id)) };
  }
  const { rows } = await pool.query(
    `INSERT INTO agency_branch_agents (agent_id, branch_id, assigned_by)
     SELECT a.id, b.id, $4
     FROM agents a
     JOIN agency_branches b ON b.id = $2 AND b.vendor_id = a.vendor_id AND b.archived_at IS NULL
     WHERE a.vendor_id = $1 AND a.id = ANY($3::bigint[])
     ON CONFLICT (agent_id) DO UPDATE
       SET branch_id = EXCLUDED.branch_id, assigned_by = EXCLUDED.assigned_by, assigned_at = NOW()
     RETURNING agent_id`,
    [vendorId, branchId, ids, adminId],
  );
  return { changedIds: rows.map((row) => Number(row.agent_id)) };
}
