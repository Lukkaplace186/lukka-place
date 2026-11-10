import 'server-only';
import { getPool } from './db';
import { MOVE_STATUSES } from './moveProjectRules';

/**
 * /admin/move-projects, "Les projets" (2026-11-10, owner: "how can we know who
 * these people are?"): one row per move project with the customer who told it
 * — their account name and number as stored in `customers`, nothing more.
 * A project is always a customer's (customer_id, FK ON DELETE CASCADE), so
 * every row has a person; the name is NULL when the customer never gave one,
 * and the page says so instead of guessing.
 *
 * Read-only. Columns added by later migrations (id, title, status,
 * manual_stage, found_at, budget_min) are read through `to_jsonb(p) ->> '…'`
 * like lib/moveProjectStats.js, so the list works before those run.
 */

const STATUS = "COALESCE(to_jsonb(p) ->> 'status', 'active')";

/** A filter value from the URL: trimmed, capped, or undefined. Values are bound, never interpolated. */
function cleanCode(value, max = 60) {
  const s = String(value ?? '').trim().slice(0, max);
  return s || undefined;
}

/**
 * The list's filters, from the page's query string. Unknown statuses and
 * non-numeric customer ids are dropped rather than sent to the database.
 *
 * @param {Record<string, string|undefined>} raw
 */
export function parseMoveProjectFilters(raw = {}) {
  const status = cleanCode(raw.status, 20);
  const customer = String(raw.customer ?? '').trim();
  return {
    reason: cleanCode(raw.reason),
    commune: cleanCode(raw.commune),
    status: MOVE_STATUSES.includes(status) ? status : undefined,
    customer: /^\d{1,12}$/.test(customer) ? customer : undefined,
  };
}

/**
 * One page of projects, newest first, each with its customer.
 *
 * @param {{reason?: string, commune?: string, status?: string, customer?: string, limit: number, offset: number}} opts
 * @returns {Promise<{rows: object[], total: number}|null>} null when the table does not exist yet.
 */
export async function listMoveProjectsPage({ reason, commune, status, customer, limit = 25, offset = 0 } = {}) {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT to_jsonb(p) ->> 'id' AS project_id,
              to_jsonb(p) ->> 'title' AS title,
              p.customer_id,
              c.full_name,
              c.phone,
              c.phone_verified_at,
              p.reasons,
              p.reason_other,
              p.communes,
              p.city,
              p.transaction_type,
              (to_jsonb(p) ->> 'budget_min')::int AS budget_min,
              p.budget_max,
              p.timeline,
              ${STATUS} AS status,
              to_jsonb(p) ->> 'manual_stage' AS manual_stage,
              to_jsonb(p) ->> 'found_at' AS found_at,
              p.last_lead_id,
              p.last_lead_at,
              p.created_at,
              p.updated_at,
              COUNT(*) OVER ()::int AS total
         FROM customer_move_projects p
         LEFT JOIN customers c ON c.id = p.customer_id
        WHERE ($1::text IS NULL OR $1::text = ANY (p.reasons))
          AND ($2::text IS NULL OR $2::text = ANY (p.communes))
          AND ($3::text IS NULL OR ${STATUS} = $3::text)
          AND ($4::bigint IS NULL OR p.customer_id = $4::bigint)
        ORDER BY p.created_at DESC, p.customer_id DESC
        LIMIT $5 OFFSET $6`,
      [reason ?? null, commune ?? null, status ?? null, customer ?? null, limit, offset],
    );
    let total = rows[0]?.total ?? 0;
    // Past the last page the window count has no row to ride on.
    if (!rows.length && offset > 0) {
      const count = await pool.query(
        `SELECT COUNT(*)::int AS total FROM customer_move_projects p
          WHERE ($1::text IS NULL OR $1::text = ANY (p.reasons))
            AND ($2::text IS NULL OR $2::text = ANY (p.communes))
            AND ($3::text IS NULL OR ${STATUS} = $3::text)
            AND ($4::bigint IS NULL OR p.customer_id = $4::bigint)`,
        [reason ?? null, commune ?? null, status ?? null, customer ?? null],
      );
      total = count.rows[0]?.total ?? 0;
    }
    return { rows: rows.map(({ total: _t, ...row }) => row), total: Number(total) || 0 };
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}
