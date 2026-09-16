import 'server-only';
import { randomBytes } from 'node:crypto';
import { getPool } from './db';
import { vendorNameSql } from './vendorName';

/**
 * The sales team's performance and commissions.
 *
 * WHERE THE NUMBERS COME FROM — every figure is derived from something the
 * platform already records, never typed in as a result:
 *   - an agent is a rep's account through `sales_account_assignments`, with a
 *     `credit_from` date: nothing that happened before it is credited;
 *   - "onboarded" = that agent's `phone_verified_at` (the same proof of a real,
 *     reachable agent the rest of the platform uses);
 *   - "subscription sold" = a `memberships` row that is a real recorded payment
 *     (not a trial, price > 0, still active) for the agent's vendor. Memberships
 *     belong to vendors; a vendor is credited to a rep only when every assigned
 *     agent of that vendor belongs to the SAME rep (ambiguity credits nobody);
 *   - commissions are generated from those facts by `syncSalesCommissions`,
 *     with the plan's rate snapshotted onto each row, so editing a plan never
 *     rewrites what was already earned.
 *
 * Generation is idempotent (UNIQUE (source_type, source_id)): re-running it
 * adds only what is new. A pending or approved subscription commission whose
 * membership has since been cancelled is voided; a PAID one is flagged
 * `clawback_due` on the ledger and left for a person to settle with an
 * adjustment — money already handed over is not reversed by a query.
 */

const PAID_MEMBERSHIP = 'COALESCE(mem.is_trial, 0) = 0 AND mem.price > 0 AND mem.status = 1';
const MEMBERSHIP_CURRENCY = "UPPER(COALESCE(NULLIF(TRIM(mem.currency), ''), 'USD'))";
const KINSHASA = "'Africa/Kinshasa'";

// A vendor is credited to a rep only when all its assigned agents share that rep.
const VENDOR_REP_CTE = `vendor_rep AS (
  SELECT a.vendor_id, MIN(sa.rep_id) AS rep_id, MIN(sa.credit_from) AS credit_from
  FROM sales_account_assignments sa
  JOIN agents a ON a.id = sa.agent_id
  WHERE sa.ended_at IS NULL AND a.vendor_id IS NOT NULL
  GROUP BY a.vendor_id
  HAVING COUNT(DISTINCT sa.rep_id) = 1
)`;

const AGENT_INFO_JOIN = (agentExpr) => `LEFT JOIN LATERAL (
    SELECT first_name, last_name FROM agent_infos WHERE agent_id = ${agentExpr}
    ORDER BY (language_id = 20) DESC, language_id LIMIT 1
  ) ai ON true`;

const AGENT_NAME = "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), NULLIF(TRIM(a.agency_name), ''), 'Agent #' || a.id)";

function pageBounds(limit, offset, fallback = 25) {
  return {
    limit: Math.min(Math.max(Number.parseInt(limit, 10) || fallback, 1), 100),
    offset: Math.max(Number.parseInt(offset, 10) || 0, 0),
  };
}

function cleanIds(values, max = 500) {
  return [...new Set((values || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, max);
}

async function inTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    if (result && result.errorKey) {
      await client.query('ROLLBACK');
      return result;
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listSalesPlans() {
  const { rows } = await getPool().query(
    `SELECT p.id, p.name, p.currency, p.onboarding_bonus::float AS onboarding_bonus,
            p.subscription_rate::float AS subscription_rate, p.monthly_target, p.target_bonus::float AS target_bonus,
            p.active, p.created_at,
            (SELECT COUNT(*)::int FROM sales_reps r WHERE r.plan_id = p.id AND r.status = 'active') AS reps
     FROM sales_commission_plans p
     ORDER BY p.active DESC, LOWER(p.name), p.id`,
  );
  return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

/** @returns {Promise<{id: number}|{errorKey: string}>} */
export async function saveSalesPlan(id, values) {
  const params = [values.name, values.currency, values.onboardingBonus, values.subscriptionRate, values.monthlyTarget, values.targetBonus, values.active];
  if (id) {
    const { rows } = await getPool().query(
      `UPDATE sales_commission_plans
       SET name = $1, currency = $2, onboarding_bonus = $3, subscription_rate = $4, monthly_target = $5,
           target_bonus = $6, active = $7, updated_at = NOW()
       WHERE id = $8 RETURNING id`,
      [...params, id],
    );
    return rows[0] ? { id: Number(rows[0].id) } : { errorKey: 'admin.sales.plans.notFound' };
  }
  const { rows } = await getPool().query(
    `INSERT INTO sales_commission_plans (name, currency, onboarding_bonus, subscription_rate, monthly_target, target_bonus, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    params,
  );
  return { id: Number(rows[0].id) };
}

// ---------------------------------------------------------------------------
// Reps and their performance
// ---------------------------------------------------------------------------

/**
 * Every rep (or one), with performance over [from, to). `from` null = all time.
 * Money is per currency — memberships are recorded in USD and CDF, and adding
 * the two would be a number that means nothing.
 */
export async function listSalesReps({ from = null, to = new Date().toISOString(), repId = null } = {}) {
  const { rows } = await getPool().query(
    `WITH ${VENDOR_REP_CTE},
     accounts AS (
       SELECT rep_id, COUNT(*)::int AS n FROM sales_account_assignments WHERE ended_at IS NULL GROUP BY rep_id
     ),
     onboarded AS (
       SELECT sa.rep_id, COUNT(*)::int AS n
       FROM sales_account_assignments sa JOIN agents a ON a.id = sa.agent_id
       WHERE sa.ended_at IS NULL AND a.phone_verified_at IS NOT NULL AND a.phone_verified_at >= sa.credit_from
         AND ($1::timestamptz IS NULL OR a.phone_verified_at >= $1) AND a.phone_verified_at < $2
       GROUP BY sa.rep_id
     ),
     sold AS (
       SELECT vr.rep_id, ${MEMBERSHIP_CURRENCY} AS currency, COUNT(*)::int AS n, SUM(mem.price)::float AS amount
       FROM memberships mem JOIN vendor_rep vr ON vr.vendor_id = mem.vendor_id
       WHERE ${PAID_MEMBERSHIP} AND mem.created_at >= vr.credit_from
         AND ($1::timestamptz IS NULL OR mem.created_at >= $1) AND mem.created_at < $2
       GROUP BY 1, 2
     ),
     live AS (
       SELECT sa.rep_id, COUNT(p.id)::int AS n
       FROM sales_account_assignments sa
       JOIN properties p ON p.agent_id = sa.agent_id AND p.status = 1 AND p.approve_status = 1
       WHERE sa.ended_at IS NULL
       GROUP BY sa.rep_id
     ),
     comm AS (
       SELECT rep_id, currency,
              COALESCE(SUM(amount) FILTER (WHERE status <> 'void' AND ($1::timestamptz IS NULL OR earned_at >= $1) AND earned_at < $2), 0)::float AS earned,
              COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending,
              COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::float AS approved,
              COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::float AS paid
       FROM sales_commissions GROUP BY 1, 2
     )
     SELECT r.id, r.full_name, r.phone, r.email, r.status, r.admin_user_id, r.plan_id, r.created_at,
            p.name AS plan_name, p.currency AS plan_currency, p.monthly_target, p.target_bonus::float AS target_bonus,
            p.onboarding_bonus::float AS onboarding_bonus, p.subscription_rate::float AS subscription_rate,
            u.full_name AS account_name, u.email AS account_email, u.status AS account_status,
            COALESCE(ac.n, 0) AS accounts, COALESCE(ob.n, 0) AS onboarded, COALESCE(lv.n, 0) AS live_listings,
            COALESCE((SELECT json_agg(json_build_object('currency', s.currency, 'count', s.n, 'amount', s.amount) ORDER BY s.currency)
                      FROM sold s WHERE s.rep_id = r.id), '[]'::json) AS sold,
            COALESCE((SELECT json_agg(json_build_object('currency', c.currency, 'earned', c.earned, 'pending', c.pending,
                                                        'approved', c.approved, 'paid', c.paid) ORDER BY c.currency)
                      FROM comm c WHERE c.rep_id = r.id), '[]'::json) AS commissions
     FROM sales_reps r
     LEFT JOIN sales_commission_plans p ON p.id = r.plan_id
     LEFT JOIN console_admin_users u ON u.id = r.admin_user_id
     LEFT JOIN accounts ac ON ac.rep_id = r.id
     LEFT JOIN onboarded ob ON ob.rep_id = r.id
     LEFT JOIN live lv ON lv.rep_id = r.id
     WHERE ($3::bigint IS NULL OR r.id = $3)
     ORDER BY (r.status = 'active') DESC, LOWER(r.full_name), r.id`,
    [from, to, repId],
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    soldCount: (row.sold || []).reduce((sum, item) => sum + Number(item.count || 0), 0),
  }));
}

export async function getSalesRep(id, range = {}) {
  const repId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(repId) || repId <= 0) return null;
  const rows = await listSalesReps({ ...range, repId });
  return rows[0] || null;
}

export async function getSalesRepIdForAdmin(adminUserId) {
  if (!adminUserId) return null;
  const { rows } = await getPool().query('SELECT id FROM sales_reps WHERE admin_user_id = $1', [adminUserId]);
  return rows[0] ? Number(rows[0].id) : null;
}

/** Console accounts a rep can be linked to: role `sales`, not disabled. */
export async function listSalesConsoleAccounts() {
  const { rows } = await getPool().query(
    `SELECT u.id, u.full_name, u.email, r.id AS rep_id
     FROM console_admin_users u
     LEFT JOIN sales_reps r ON r.admin_user_id = u.id
     WHERE u.role = 'sales' AND u.status <> 'disabled'
     ORDER BY LOWER(u.full_name)`,
  );
  return rows.map((row) => ({ ...row, id: Number(row.id), rep_id: row.rep_id == null ? null : Number(row.rep_id) }));
}

export async function listActiveRepOptions() {
  const { rows } = await getPool().query("SELECT id, full_name FROM sales_reps WHERE status = 'active' ORDER BY LOWER(full_name)");
  return rows.map((row) => ({ id: Number(row.id), name: row.full_name }));
}

/** @returns {Promise<{id: number}|{errorKey: string}>} */
export async function saveSalesRep(id, values, { adminId = null } = {}) {
  const pool = getPool();
  if (values.planId) {
    const plan = await pool.query('SELECT 1 FROM sales_commission_plans WHERE id = $1', [values.planId]);
    if (!plan.rows[0]) return { errorKey: 'admin.sales.reps.planInvalid' };
  }
  if (values.adminUserId) {
    const account = await pool.query("SELECT 1 FROM console_admin_users WHERE id = $1 AND role = 'sales'", [values.adminUserId]);
    if (!account.rows[0]) return { errorKey: 'admin.sales.reps.accountInvalid' };
  }
  const params = [values.fullName, values.phone, values.email, values.planId, values.status, values.adminUserId];
  try {
    if (id) {
      const { rows } = await pool.query(
        `UPDATE sales_reps SET full_name = $1, phone = $2, email = $3, plan_id = $4, status = $5, admin_user_id = $6, updated_at = NOW()
         WHERE id = $7 RETURNING id`,
        [...params, id],
      );
      return rows[0] ? { id: Number(rows[0].id) } : { errorKey: 'admin.sales.reps.notFound' };
    }
    const { rows } = await pool.query(
      `INSERT INTO sales_reps (full_name, phone, email, plan_id, status, admin_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [...params, adminId],
    );
    return { id: Number(rows[0].id) };
  } catch (err) {
    if (err.code === '23505') return { errorKey: 'admin.sales.reps.accountTaken' };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Accounts (agent assignments)
// ---------------------------------------------------------------------------

export async function listRepAccounts(repId, { limit = 25, offset = 0 } = {}) {
  const bounds = pageBounds(limit, offset);
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM sales_account_assignments WHERE rep_id = $1 AND ended_at IS NULL', [repId]),
    pool.query(
      `SELECT sa.id AS assignment_id, sa.credit_from, sa.assigned_at, a.id AS agent_id, a.phone, a.phone_verified_at, a.status,
              a.vendor_id, ${AGENT_NAME} AS name,
              (SELECT COUNT(*)::int FROM properties p WHERE p.agent_id = a.id AND p.status = 1 AND p.approve_status = 1) AS live_listings,
              m.expire_date, pk.title AS package_title
       FROM sales_account_assignments sa
       JOIN agents a ON a.id = sa.agent_id
       ${AGENT_INFO_JOIN('a.id')}
       LEFT JOIN LATERAL (
         SELECT package_id, expire_date FROM memberships
         WHERE vendor_id = a.vendor_id AND status = 1 AND expire_date >= CURRENT_DATE
         ORDER BY expire_date DESC LIMIT 1
       ) m ON true
       LEFT JOIN packages pk ON pk.id = m.package_id
       WHERE sa.rep_id = $1 AND sa.ended_at IS NULL
       ORDER BY sa.assigned_at DESC, sa.id DESC
       LIMIT $2 OFFSET $3`,
      [repId, bounds.limit, bounds.offset],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows.map((row) => ({ ...row, agent_id: Number(row.agent_id) })) };
}

/** The rep currently looking after one agent, if any. */
export async function getAgentSalesAssignment(agentId) {
  const { rows } = await getPool().query(
    `SELECT sa.rep_id, sa.credit_from, sa.assigned_at, r.full_name AS rep_name, r.status AS rep_status
     FROM sales_account_assignments sa JOIN sales_reps r ON r.id = sa.rep_id
     WHERE sa.agent_id = $1 AND sa.ended_at IS NULL`,
    [agentId],
  );
  return rows[0] ? { ...rows[0], rep_id: Number(rows[0].rep_id) } : null;
}

/**
 * Give agents to a rep. An agent looked after by another rep moves (that
 * assignment is ended, kept as history); one already with this rep is left as
 * it is. Only an active rep takes new accounts.
 * @returns {Promise<{errorKey: string} | {assignedIds: number[], movedIds: number[]}>}
 */
export async function assignAgentsToRep({ repId, agentIds, creditFrom, adminId = null }) {
  const ids = cleanIds(agentIds);
  if (ids.length === 0) return { assignedIds: [], movedIds: [] };
  return inTransaction(async (client) => {
    const rep = await client.query("SELECT 1 FROM sales_reps WHERE id = $1 AND status = 'active'", [repId]);
    if (!rep.rows[0]) return { errorKey: 'admin.sales.reps.inactive' };
    const moved = await client.query(
      `UPDATE sales_account_assignments SET ended_at = NOW(), ended_by = $3
       WHERE agent_id = ANY($1::bigint[]) AND ended_at IS NULL AND rep_id <> $2
       RETURNING agent_id`,
      [ids, repId, adminId],
    );
    const assigned = await client.query(
      `INSERT INTO sales_account_assignments (rep_id, agent_id, credit_from, assigned_by)
       SELECT $1, a.id, $3, $4 FROM agents a
       WHERE a.id = ANY($2::bigint[])
         AND NOT EXISTS (SELECT 1 FROM sales_account_assignments x WHERE x.agent_id = a.id AND x.ended_at IS NULL)
       RETURNING agent_id`,
      [repId, ids, creditFrom, adminId],
    );
    return {
      assignedIds: assigned.rows.map((row) => Number(row.agent_id)),
      movedIds: moved.rows.map((row) => Number(row.agent_id)),
    };
  });
}

export async function endRepAssignment({ repId, agentId, adminId = null }) {
  const { rowCount } = await getPool().query(
    `UPDATE sales_account_assignments SET ended_at = NOW(), ended_by = $3
     WHERE rep_id = $1 AND agent_id = $2 AND ended_at IS NULL`,
    [repId, agentId, adminId],
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Commission generation
// ---------------------------------------------------------------------------

export const SYNC_SUBSCRIPTIONS_SQL = `
  WITH ${VENDOR_REP_CTE}
  INSERT INTO sales_commissions (rep_id, source_type, source_id, membership_id, basis_amount, rate, amount, currency, earned_at, plan_id)
  SELECT vr.rep_id, 'subscription', mem.id::text, mem.id, mem.price, p.subscription_rate,
         ROUND((mem.price * p.subscription_rate / 100)::numeric, 2), ${MEMBERSHIP_CURRENCY}, mem.created_at, p.id
  FROM memberships mem
  JOIN vendor_rep vr ON vr.vendor_id = mem.vendor_id
  JOIN sales_reps r ON r.id = vr.rep_id AND r.status = 'active'
  JOIN sales_commission_plans p ON p.id = r.plan_id AND p.active
  WHERE ${PAID_MEMBERSHIP}
    AND mem.created_at >= vr.credit_from
    AND p.subscription_rate > 0
    AND ROUND((mem.price * p.subscription_rate / 100)::numeric, 2) > 0
  ON CONFLICT (source_type, source_id) DO NOTHING`;

export const SYNC_ONBOARDING_SQL = `
  INSERT INTO sales_commissions (rep_id, source_type, source_id, agent_id, amount, currency, earned_at, plan_id)
  SELECT sa.rep_id, 'onboarding', a.id::text, a.id, p.onboarding_bonus, p.currency, a.phone_verified_at, p.id
  FROM sales_account_assignments sa
  JOIN agents a ON a.id = sa.agent_id
  JOIN sales_reps r ON r.id = sa.rep_id AND r.status = 'active'
  JOIN sales_commission_plans p ON p.id = r.plan_id AND p.active
  WHERE sa.ended_at IS NULL
    AND a.phone_verified_at IS NOT NULL
    AND a.phone_verified_at >= sa.credit_from
    AND p.onboarding_bonus > 0
  ON CONFLICT (source_type, source_id) DO NOTHING`;

// Only CLOSED Kinshasa months: the current month's count can still grow.
export const SYNC_TARGETS_SQL = `
  WITH ${VENDOR_REP_CTE},
  monthly AS (
    SELECT vr.rep_id, date_trunc('month', mem.created_at::timestamptz AT TIME ZONE ${KINSHASA}) AS month_start, COUNT(*)::int AS sold
    FROM memberships mem JOIN vendor_rep vr ON vr.vendor_id = mem.vendor_id
    WHERE ${PAID_MEMBERSHIP} AND mem.created_at >= vr.credit_from
    GROUP BY 1, 2
  )
  INSERT INTO sales_commissions (rep_id, source_type, source_id, basis_amount, amount, currency, earned_at, plan_id)
  SELECT m.rep_id, 'target', m.rep_id || ':' || to_char(m.month_start, 'YYYY-MM'), m.sold, p.target_bonus, p.currency,
         (m.month_start + INTERVAL '1 month') AT TIME ZONE ${KINSHASA}, p.id
  FROM monthly m
  JOIN sales_reps r ON r.id = m.rep_id AND r.status = 'active'
  JOIN sales_commission_plans p ON p.id = r.plan_id AND p.active
  WHERE p.monthly_target > 0 AND p.target_bonus > 0 AND m.sold >= p.monthly_target
    AND m.month_start < date_trunc('month', NOW() AT TIME ZONE ${KINSHASA})
  ON CONFLICT (source_type, source_id) DO NOTHING`;

export const VOID_CANCELLED_SQL = `
  UPDATE sales_commissions sc
  SET status = 'void', voided_at = NOW(), void_reason = 'membership_cancelled'
  WHERE sc.source_type = 'subscription' AND sc.status IN ('pending', 'approved')
    AND NOT EXISTS (SELECT 1 FROM memberships mem WHERE mem.id = sc.membership_id AND mem.status = 1)`;

/** @returns {Promise<{subscriptions: number, onboarding: number, targets: number, voided: number}>} */
export async function syncSalesCommissions() {
  return inTransaction(async (client) => {
    const subscriptions = await client.query(SYNC_SUBSCRIPTIONS_SQL);
    const onboarding = await client.query(SYNC_ONBOARDING_SQL);
    const targets = await client.query(SYNC_TARGETS_SQL);
    const voided = await client.query(VOID_CANCELLED_SQL);
    return {
      subscriptions: subscriptions.rowCount ?? 0,
      onboarding: onboarding.rowCount ?? 0,
      targets: targets.rowCount ?? 0,
      voided: voided.rowCount ?? 0,
    };
  });
}

export async function getLastSalesSync() {
  const { rows } = await getPool().query(
    "SELECT created_at, actor_label, details FROM console_admin_audit_log WHERE action = 'sales.sync' ORDER BY created_at DESC LIMIT 1",
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Ledger, approvals, adjustments, payouts
// ---------------------------------------------------------------------------

export async function listRepCommissions(repId, { status, limit = 25, offset = 0 } = {}) {
  const bounds = pageBounds(limit, offset);
  const filter = ['pending', 'approved', 'paid', 'void'].includes(status) ? status : null;
  const pool = getPool();
  const [count, page, open] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM sales_commissions WHERE rep_id = $1 AND ($2::text IS NULL OR status = $2)', [repId, filter]),
    pool.query(
      `SELECT sc.id, sc.source_type, sc.source_id, sc.agent_id, sc.membership_id, sc.basis_amount::float AS basis_amount,
              sc.rate::float AS rate, sc.amount::float AS amount, sc.currency, sc.earned_at, sc.status, sc.note,
              sc.payout_id, sc.void_reason, sc.approved_at, mem.vendor_id, pkg.title AS package_title,
              CASE WHEN sc.source_type = 'subscription' THEN ${vendorNameSql('v')}
                   WHEN sc.agent_id IS NOT NULL THEN ${AGENT_NAME}
              END AS account_label,
              (sc.status = 'paid' AND sc.source_type = 'subscription'
                AND NOT EXISTS (SELECT 1 FROM memberships m2 WHERE m2.id = sc.membership_id AND m2.status = 1)) AS clawback_due
       FROM sales_commissions sc
       LEFT JOIN memberships mem ON mem.id = sc.membership_id
       LEFT JOIN vendors v ON v.id = mem.vendor_id
       LEFT JOIN packages pkg ON pkg.id = mem.package_id
       LEFT JOIN agents a ON a.id = sc.agent_id
       ${AGENT_INFO_JOIN('sc.agent_id')}
       WHERE sc.rep_id = $1 AND ($2::text IS NULL OR sc.status = $2)
       ORDER BY sc.earned_at DESC, sc.id DESC
       LIMIT $3 OFFSET $4`,
      [repId, filter, bounds.limit, bounds.offset],
    ),
    pool.query(
      `SELECT status, currency, COUNT(*)::int AS n, SUM(amount)::float AS amount
       FROM sales_commissions WHERE rep_id = $1 AND status IN ('pending', 'approved')
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [repId],
    ),
  ]);
  return {
    total: count.rows[0]?.total ?? 0,
    rows: page.rows.map((row) => ({ ...row, id: Number(row.id) })),
    open: open.rows,
  };
}

export async function approveCommissions({ repId, ids, adminId = null }) {
  const clean = cleanIds(ids);
  if (clean.length === 0) return { approvedIds: [] };
  const { rows } = await getPool().query(
    `UPDATE sales_commissions SET status = 'approved', approved_at = NOW(), approved_by = $3
     WHERE rep_id = $1 AND id = ANY($2::bigint[]) AND status = 'pending'
     RETURNING id`,
    [repId, clean, adminId],
  );
  return { approvedIds: rows.map((row) => Number(row.id)) };
}

export async function voidCommission({ repId, id, reason }) {
  const { rows } = await getPool().query(
    `UPDATE sales_commissions SET status = 'void', voided_at = NOW(), void_reason = $3
     WHERE rep_id = $1 AND id = $2 AND status IN ('pending', 'approved')
     RETURNING id, amount::float AS amount, currency, source_type`,
    [repId, id, reason],
  );
  return rows[0] || null;
}

/** A manual line — a correction, a clawback (negative), a one-off bonus. Always pending, always with a note. */
export async function addCommissionAdjustment({ repId, amount, currency, note, adminId = null, now = new Date() }) {
  const { rows } = await getPool().query(
    `INSERT INTO sales_commissions (rep_id, source_type, source_id, amount, currency, earned_at, note, created_by)
     SELECT $1, 'adjustment', $2, $3, $4, $5, $6, $7 FROM sales_reps WHERE id = $1
     RETURNING id`,
    [repId, `adj-${now.getTime()}-${randomBytes(4).toString('hex')}`, amount, currency, now.toISOString(), note, adminId],
  );
  return rows[0] ? { id: Number(rows[0].id) } : { errorKey: 'admin.sales.reps.notFound' };
}

/**
 * Pay approved commissions of one currency. `ids` narrows it to a selection;
 * omitted = every approved line in that currency. One transaction, rows locked,
 * so two people recording the same payout cannot pay a line twice.
 * @returns {Promise<{errorKey: string} | {payoutId: number, total: number, count: number}>}
 */
export async function recordSalesPayout({ repId, currency, ids = null, method, reference = null, note = null, paidAt, adminId = null }) {
  const clean = ids == null ? null : cleanIds(ids);
  if (clean && clean.length === 0) return { errorKey: 'admin.sales.ledger.nothingSelected' };
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, amount::float AS amount FROM sales_commissions
       WHERE rep_id = $1 AND status = 'approved' AND currency = $2 AND ($3::bigint[] IS NULL OR id = ANY($3::bigint[]))
       ORDER BY id FOR UPDATE`,
      [repId, currency, clean],
    );
    if (rows.length === 0) return { errorKey: 'admin.sales.ledger.noneApproved' };
    if (clean && rows.length !== clean.length) return { errorKey: 'admin.sales.ledger.selectionChanged' };
    const total = Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
    if (!(total > 0)) return { errorKey: 'admin.sales.ledger.totalNotPositive' };
    const payout = await client.query(
      `INSERT INTO sales_payouts (rep_id, currency, total, method, reference, note, paid_at, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [repId, currency, total, method, reference, note, paidAt, adminId],
    );
    const payoutId = Number(payout.rows[0].id);
    await client.query(
      "UPDATE sales_commissions SET status = 'paid', payout_id = $1 WHERE id = ANY($2::bigint[])",
      [payoutId, rows.map((row) => row.id)],
    );
    return { payoutId, total, count: rows.length };
  });
}

export async function listRepPayouts(repId, { limit = 20 } = {}) {
  const { rows } = await getPool().query(
    `SELECT sp.id, sp.currency, sp.total::float AS total, sp.method, sp.reference, sp.note, sp.paid_at, sp.created_at,
            u.full_name AS recorded_by_name,
            (SELECT COUNT(*)::int FROM sales_commissions sc WHERE sc.payout_id = sp.id) AS lines
     FROM sales_payouts sp
     LEFT JOIN console_admin_users u ON u.id = sp.recorded_by
     WHERE sp.rep_id = $1
     ORDER BY sp.paid_at DESC, sp.id DESC
     LIMIT $2`,
    [repId, Math.min(Number(limit) || 20, 100)],
  );
  return rows;
}

/** Plans of the rep's vendors that run out in the next 30 days and have not already been renewed. */
export async function listRepRenewalsDue(repId) {
  const { rows } = await getPool().query(
    `WITH ${VENDOR_REP_CTE}
     SELECT mem.id, mem.vendor_id, mem.expire_date, (mem.expire_date - CURRENT_DATE) AS days_left,
            pkg.title AS package_title, ${vendorNameSql('v')} AS agency_name
     FROM memberships mem
     JOIN vendor_rep vr ON vr.vendor_id = mem.vendor_id AND vr.rep_id = $1
     LEFT JOIN packages pkg ON pkg.id = mem.package_id
     LEFT JOIN vendors v ON v.id = mem.vendor_id
     WHERE mem.status = 1 AND mem.expire_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
       AND NOT EXISTS (
         SELECT 1 FROM memberships later
         WHERE later.vendor_id = mem.vendor_id AND later.status = 1 AND later.expire_date > mem.expire_date
       )
     ORDER BY mem.expire_date, mem.id
     LIMIT 50`,
    [repId],
  );
  return rows;
}

/** The last six Kinshasa months, newest first: subscriptions sold, agents onboarded, commission earned. */
export async function getRepMonthlyTrend(repId) {
  const { rows } = await getPool().query(
    `WITH ${VENDOR_REP_CTE},
     months AS (
       SELECT generate_series(
         date_trunc('month', NOW() AT TIME ZONE ${KINSHASA}) - INTERVAL '5 months',
         date_trunc('month', NOW() AT TIME ZONE ${KINSHASA}),
         INTERVAL '1 month'
       ) AS month_start
     )
     SELECT to_char(mo.month_start, 'YYYY-MM') AS month,
            (SELECT COUNT(*)::int FROM memberships mem
               JOIN vendor_rep vr ON vr.vendor_id = mem.vendor_id AND vr.rep_id = $1
             WHERE ${PAID_MEMBERSHIP} AND mem.created_at >= vr.credit_from
               AND date_trunc('month', mem.created_at::timestamptz AT TIME ZONE ${KINSHASA}) = mo.month_start) AS sold,
            (SELECT COUNT(*)::int FROM sales_account_assignments sa JOIN agents a ON a.id = sa.agent_id
             WHERE sa.rep_id = $1 AND sa.ended_at IS NULL AND a.phone_verified_at IS NOT NULL
               AND a.phone_verified_at >= sa.credit_from
               AND date_trunc('month', a.phone_verified_at::timestamptz AT TIME ZONE ${KINSHASA}) = mo.month_start) AS onboarded,
            COALESCE((SELECT json_agg(json_build_object('currency', x.currency, 'amount', x.amount) ORDER BY x.currency)
                      FROM (SELECT currency, SUM(amount)::float AS amount FROM sales_commissions
                            WHERE rep_id = $1 AND status <> 'void'
                              AND date_trunc('month', earned_at AT TIME ZONE ${KINSHASA}) = mo.month_start
                            GROUP BY currency) x), '[]'::json) AS earned
     FROM months mo
     ORDER BY mo.month_start DESC`,
    [repId],
  );
  return rows;
}
