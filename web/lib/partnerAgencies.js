import 'server-only';
import { getPool } from './db';
import { vendorNameSql } from './vendorName';

/**
 * Partner agencies (migrations/20261113_partner_agencies.sql): agencies the
 * team marks on their page so the approval queue shows their listings apart
 * and badges them. JOKER AGENCY is the first (owner, 2026-11-13).
 *
 * The code runs before the migration: every reader checks the table exists
 * first (a yes is kept for the process, a no for a minute) and behaves as if
 * nobody were a partner until it does.
 */

/** True when the agent aliased `agentAlias` belongs to a partner agency. */
export function partnerSql(agentAlias = 'a') {
  return `EXISTS (SELECT 1 FROM partner_agencies pag WHERE pag.vendor_id = ${agentAlias}.vendor_id)`;
}

let tableState = { at: 0, value: null };

export async function hasPartnerAgencies() {
  if (tableState.value === true) return true;
  if (tableState.value === false && Date.now() - tableState.at < 60 * 1000) return false;
  try {
    const { rows } = await getPool().query("SELECT to_regclass('public.partner_agencies') IS NOT NULL AS ok");
    tableState = { at: Date.now(), value: Boolean(rows[0]?.ok) };
  } catch {
    tableState = { at: Date.now(), value: false };
  }
  return tableState.value;
}

/** Every live partner agency, by name: `[{ id, name }]`. Empty before the migration. */
export async function listPartnerAgencies() {
  if (!(await hasPartnerAgencies())) return [];
  const { rows } = await getPool().query(
    `SELECT v.id, ${vendorNameSql('v')} AS name
     FROM partner_agencies pag JOIN vendors v ON v.id = pag.vendor_id
     WHERE v.deleted_at IS NULL
     ORDER BY LOWER(${vendorNameSql('v')}), v.id`,
  );
  return rows.map((row) => ({ id: Number(row.id), name: row.name }));
}

/** Whether one agency is a partner; null when the table does not exist yet. */
export async function isPartnerAgency(vendorId) {
  if (!(await hasPartnerAgencies())) return null;
  const { rows } = await getPool().query('SELECT 1 FROM partner_agencies WHERE vendor_id = $1', [vendorId]);
  return rows.length > 0;
}

/** Marks or unmarks an agency. Returns whether the row changed. */
export async function setPartnerAgency(vendorId, partner, { adminId = null } = {}) {
  const pool = getPool();
  if (partner) {
    const { rowCount } = await pool.query(
      'INSERT INTO partner_agencies (vendor_id, created_by) VALUES ($1, $2) ON CONFLICT (vendor_id) DO NOTHING',
      [vendorId, adminId],
    );
    return rowCount > 0;
  }
  const { rowCount } = await pool.query('DELETE FROM partner_agencies WHERE vendor_id = $1', [vendorId]);
  return rowCount > 0;
}

/**
 * Listings of partner agencies per approval tab, for the queue's partner
 * filter: `{ pending, approved, rejected, suspended }`, same tab conditions as
 * getModerationCounts (lib/moderationQueue.js). null before the migration.
 */
export async function getPartnerModerationCounts() {
  if (!(await hasPartnerAgencies())) return null;
  const { rows } = await getPool().query(`
    SELECT COUNT(*) FILTER (WHERE p.approve_status = 0 AND p.development_id IS NULL)::int AS pending,
           COUNT(*) FILTER (WHERE p.approve_status = 1 AND p.status = 1)::int AS approved,
           COUNT(*) FILTER (WHERE p.approve_status = 2)::int AS rejected,
           COUNT(*) FILTER (WHERE p.approve_status = 1 AND p.status = 0)::int AS suspended
    FROM properties p
    JOIN agents a ON a.id = p.agent_id
    WHERE p.deleted_at IS NULL AND ${partnerSql('a')}
  `);
  return rows[0] || null;
}
