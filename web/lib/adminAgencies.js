import 'server-only';
import { getPool } from './db';
import { vendorNameSql } from './vendorName';

/**
 * Agencies (`vendors`) for the admin console. At 30k agents the team manages
 * agencies, not individuals one by one: an agency's roster, portfolio, plan and
 * history in one place, with bulk actions on its agents.
 *
 * Read-only against `vendors` itself — that table belongs to the Laravel
 * back-office too, and nothing here changes an agency record's own columns.
 */

const SORTS = {
  name: `LOWER(${vendorNameSql('v')}) ASC, v.id ASC`,
  newest: 'v.created_at DESC NULLS LAST, v.id DESC',
  agents: 'agents DESC, v.id ASC',
  listings: 'live_listings DESC, v.id ASC',
};
export const AGENCY_SORTS = Object.keys(SORTS);

const AGENCY_FIELDS = `
  v.id, v.username, ${vendorNameSql('v')} AS name, v.email, v.phone, v.status, v.created_at,
  (SELECT COUNT(*)::int FROM agents a WHERE a.vendor_id = v.id) AS agents,
  (SELECT COUNT(*)::int FROM agents a WHERE a.vendor_id = v.id AND a.phone_verified_at IS NOT NULL) AS verified_agents,
  (SELECT COUNT(*)::int FROM properties p JOIN agents a ON a.id = p.agent_id
    WHERE a.vendor_id = v.id AND p.status = 1 AND p.approve_status = 1) AS live_listings,
  (SELECT COUNT(*)::int FROM properties p JOIN agents a ON a.id = p.agent_id
    WHERE a.vendor_id = v.id AND p.approve_status = 0) AS pending_listings,
  m.expire_date, m.is_trial, pk.title AS package_title,
  pc.id AS contact_id, pc.name AS contact_name, pc.phone AS contact_phone, pc.email AS contact_email,
  pc.verified AS contact_verified
`;

const AGENCY_JOINS = `
  FROM vendors v
  LEFT JOIN LATERAL (
    SELECT package_id, expire_date, is_trial FROM memberships
    WHERE vendor_id = v.id AND status = 1 AND expire_date >= CURRENT_DATE
    ORDER BY expire_date DESC LIMIT 1
  ) m ON true
  LEFT JOIN packages pk ON pk.id = m.package_id
  -- The principal contact: the agency's first agent, named the way the rest of
  -- the console names a person (agent_infos, then their typed agency name,
  -- never the phone digits in username). An agency created for one agent by
  -- WhatsApp onboarding has no name of its own, and this is who it is.
  LEFT JOIN LATERAL (
    SELECT ca.id, ca.phone, ca.email, ca.phone_verified_at IS NOT NULL AS verified,
           COALESCE(NULLIF(TRIM(CONCAT_WS(' ', cai.first_name, cai.last_name)), ''), NULLIF(TRIM(ca.agency_name), ''),
                    'Agent #' || ca.id) AS name
    FROM agents ca
    LEFT JOIN LATERAL (
      SELECT first_name, last_name FROM agent_infos WHERE agent_id = ca.id ORDER BY (language_id = 20) DESC, language_id LIMIT 1
    ) cai ON true
    WHERE ca.vendor_id = v.id
    ORDER BY ca.id LIMIT 1
  ) pc ON true
`;

export async function listAgenciesForAdmin({ q, plan, sort = 'name', limit = 25, offset = 0 } = {}) {
  const params = [];
  const where = [];
  const term = String(q || '').trim();
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    const digits = term.replace(/\D/g, '');
    params.push(digits.length >= 3 ? `%${digits}%` : '');
    where.push(`(v.username ILIKE ${n}
      OR EXISTS (
        SELECT 1 FROM agents an LEFT JOIN agent_infos ain ON ain.agent_id = an.id
        WHERE an.vendor_id = v.id
          AND (an.agency_name ILIKE ${n} OR CONCAT_WS(' ', ain.first_name, ain.last_name) ILIKE ${n}
               OR (${n + 1} <> '' AND COALESCE(an.phone, '') LIKE ${n + 1}))
      )
      OR COALESCE(v.email, '') ILIKE ${n} OR (${n + 1} <> '' AND COALESCE(v.phone, '') LIKE ${n + 1}))`);
  }
  if (plan === 'active') where.push('m.expire_date IS NOT NULL');
  if (plan === 'none') where.push('m.expire_date IS NULL');
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total ${AGENCY_JOINS} ${whereClause}`, params),
    pool.query(
      `SELECT ${AGENCY_FIELDS} ${AGENCY_JOINS} ${whereClause}
       ORDER BY ${SORTS[sort] || SORTS.name}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageLimit, pageOffset],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows.map((row) => ({ ...row, id: Number(row.id) })) };
}

export async function getAgencyForAdmin(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;
  const { rows } = await getPool().query(`SELECT ${AGENCY_FIELDS} ${AGENCY_JOINS} WHERE v.id = $1`, [numericId]);
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

/** Every agent id in an agency, for agency-wide bulk actions. Capped at the bulk limit. */
export async function getAgencyAgentIds(id) {
  const { rows } = await getPool().query('SELECT id FROM agents WHERE vendor_id = $1 ORDER BY id LIMIT 500', [id]);
  return rows.map((row) => Number(row.id));
}
