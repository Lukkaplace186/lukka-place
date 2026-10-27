import 'server-only';
import { getPool } from './db';
import { getLeadCountsByWaIds } from './adminApi';
import {
  ACTIVATION_WINDOW_DAYS, REFERRAL_CREDIT, approvableAt, evaluateActivation, phoneHash, referralFlags, voidReasonFor,
} from './referralRules';

/**
 * The agents' $1-per-customer ledger (growth plan items 13–17): writing
 * credits from conversions, the 7-day hold, approving, paying, voiding.
 * lib/referralRules.js decides WHEN a customer counts; this applies it.
 *
 * Only AGENT partners earn credits: a creator or a campaign is paid through
 * the fee recorded on the partner (/admin/partenaires), not per account here.
 *
 * Idempotent: `conversion_id` is UNIQUE and one live credit per phone hash, so
 * a re-run, a second button press and the scheduler can never write a second
 * credit for one customer. A credit is never deleted: voided with a reason,
 * and a PAID one is only ever flagged for clawback — no query takes money back.
 *
 * Before migrations/20261028_referral_credits_and_growth.sql every read says
 * `available: false` and the run records nothing.
 */

const MISSING = new Set(['42P01', '42703']);
const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

/** Conversions not yet credited, still inside the window where they could qualify (plus a margin). */
export const CREDIT_CANDIDATES_SQL = `
  SELECT c.id AS conversion_id, c.partner_id, c.account_id,
         cu.phone, cu.created_at AS account_created_at, cu.phone_verified_at,
         (SELECT MIN(f.created_at) FROM customer_favorites f WHERE f.customer_id = cu.id) AS first_favorite_at,
         (SELECT MIN(s.created_at) FROM customer_saved_searches s WHERE s.customer_id = cu.id) AS first_alert_at,
         EXISTS (
           SELECT 1 FROM agents ag
            WHERE ag.deleted_at IS NULL
              AND regexp_replace(COALESCE(ag.phone, ''), '\\D', '', 'g') = regexp_replace(cu.phone, '\\D', '', 'g')
         ) AS is_agent_number
    FROM partner_conversions c
    JOIN partners p ON p.id = c.partner_id AND p.kind = 'agent'
    JOIN customers cu ON cu.id = c.account_id
   WHERE c.account_type = 'customer'
     AND NOT EXISTS (SELECT 1 FROM partner_credits pc WHERE pc.conversion_id = c.id)
     AND cu.created_at >= NOW() - make_interval(days => $1::int)
   ORDER BY c.id
   LIMIT 2000
`;

const INSERT_CREDIT_SQL = `
  INSERT INTO partner_credits
    (partner_id, conversion_id, account_id, phone_hash, amount, currency, status, qualified_at, approvable_at,
     activation, void_reason, voided_at, voided_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CASE WHEN $7 = 'void' THEN NOW() END, CASE WHEN $7 = 'void' THEN 'auto' END)
  ON CONFLICT (conversion_id) DO NOTHING
`;

/**
 * One run: credits every customer who has qualified, voids credits whose
 * account no longer exists (a paid one is flagged instead).
 *
 * @returns {Promise<{available: boolean, credited: number, voided: number, waiting: number, expired: number,
 *                    clawbackFlagged: number, visitsUnknown: boolean}>}
 */
export async function syncReferralCredits({ now = new Date() } = {}) {
  const pool = getPool();
  const out = { available: true, credited: 0, voided: 0, waiting: 0, expired: 0, clawbackFlagged: 0, visitsUnknown: false };
  let candidates;
  try {
    ({ rows: candidates } = await pool.query(CREDIT_CANDIDATES_SQL, [ACTIVATION_WINDOW_DAYS + 7]));
  } catch (err) {
    if (MISSING.has(err?.code)) return { ...out, available: false };
    throw err;
  }

  // A visit request is an engine (SQLite) fact, keyed by the number.
  const firstVisitByPhone = {};
  const phones = [...new Set(candidates.map((row) => digitsOf(row.phone)).filter(Boolean))];
  for (let i = 0; i < phones.length; i += 200) {
    try {
      const counts = await getLeadCountsByWaIds(phones.slice(i, i + 200));
      for (const [waId, entry] of Object.entries(counts)) firstVisitByPhone[waId] = entry?.firstViewingAt || null;
    } catch (err) {
      // Not a refusal: those customers are re-checked next run.
      out.visitsUnknown = true;
      console.error(`[referral-credits] visit lookup failed: ${err.message}`);
    }
  }

  for (const row of candidates) {
    const verdict = evaluateActivation({
      createdAt: row.account_created_at,
      verifiedAt: row.phone_verified_at,
      firstFavoriteAt: row.first_favorite_at,
      firstAlertAt: row.first_alert_at,
      firstVisitAt: firstVisitByPhone[digitsOf(row.phone)] || null,
    }, now);
    if (verdict.status === 'waiting') { out.waiting += 1; continue; }
    if (verdict.status === 'expired') { out.expired += 1; continue; }

    const hash = phoneHash(row.phone);
    const alreadyCredited = (await pool.query(
      `SELECT 1 FROM partner_credits WHERE phone_hash = $1 AND status <> 'void' LIMIT 1`, [hash],
    )).rowCount > 0;
    const voidReason = voidReasonFor({ isAgentNumber: row.is_agent_number, alreadyCredited });
    try {
      const { rowCount } = await pool.query(INSERT_CREDIT_SQL, [
        row.partner_id, row.conversion_id, row.account_id, hash,
        REFERRAL_CREDIT.amount, REFERRAL_CREDIT.currency,
        voidReason ? 'void' : 'pending',
        verdict.qualifiedAt, approvableAt(verdict.qualifiedAt), verdict.activation,
        voidReason,
      ]);
      if (rowCount) out[voidReason ? 'voided' : 'credited'] += 1;
    } catch (err) {
      // A credit for this number landed a moment ago (the live-phone index).
      if (err?.code !== '23505') throw err;
    }
  }

  // An account deleted after it qualified: an unpaid credit is voided, a paid
  // one flagged — a query never takes money back.
  const voided = await pool.query(
    `UPDATE partner_credits pc SET status = 'void', void_reason = 'auto:account_deleted', voided_at = NOW(), voided_by = 'auto'
      WHERE pc.status IN ('pending', 'approved')
        AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = pc.account_id)`,
  );
  out.voided += voided.rowCount;
  const flagged = await pool.query(
    `UPDATE partner_credits pc SET clawback_flagged_at = NOW()
      WHERE pc.status = 'paid' AND pc.clawback_flagged_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM customers cu WHERE cu.id = pc.account_id)`,
  );
  out.clawbackFlagged = flagged.rowCount;
  return out;
}

// ---------------------------------------------------------------------------
// Console reads
// ---------------------------------------------------------------------------

/** Per agent partner: accounts, activation, credits by state, money by state, review flags. */
export const AGENT_LEDGER_SQL = `
  WITH conv AS (
    SELECT c.partner_id,
           COUNT(*)::int AS accounts,
           COUNT(*) FILTER (WHERE cu.created_at < NOW() - make_interval(days => $1::int))::int AS settled
      FROM partner_conversions c
      LEFT JOIN customers cu ON cu.id = c.account_id
     WHERE c.account_type = 'customer'
     GROUP BY c.partner_id
  ),
  settled_credit AS (
    SELECT pc.partner_id, COUNT(*)::int AS settled_activated
      FROM partner_credits pc
      JOIN partner_conversions c ON c.id = pc.conversion_id
      LEFT JOIN customers cu ON cu.id = pc.account_id
     WHERE cu.created_at < NOW() - make_interval(days => $1::int)
     GROUP BY pc.partner_id
  ),
  burst AS (
    SELECT partner_id, MAX(n)::int AS max_same_connection
      FROM (SELECT partner_id, ip_hash, date_trunc('day', created_at) AS d, COUNT(*) AS n
              FROM partner_conversions WHERE ip_hash IS NOT NULL GROUP BY 1, 2, 3) x
     GROUP BY partner_id
  ),
  money AS (
    SELECT partner_id,
           COUNT(*) FILTER (WHERE status <> 'void')::int AS activated,
           COUNT(*) FILTER (WHERE status = 'pending' AND approvable_at > NOW())::int AS holding,
           COUNT(*) FILTER (WHERE status = 'pending' AND approvable_at <= NOW())::int AS approvable,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
           COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
           COUNT(*) FILTER (WHERE status = 'void')::int AS voided,
           COUNT(*) FILTER (WHERE clawback_flagged_at IS NOT NULL)::int AS clawback,
           COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending_amount,
           COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0) AS approved_amount,
           COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_amount
      FROM partner_credits
     WHERE currency = 'USD'
     GROUP BY partner_id
  )
  SELECT p.id, p.code, p.agent_id, p.status,
         COALESCE(NULLIF(TRIM(a.agency_name), ''), NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), p.name) AS name,
         a.phone AS agent_phone,
         COALESCE(conv.accounts, 0) AS accounts, COALESCE(conv.settled, 0) AS settled,
         COALESCE(settled_credit.settled_activated, 0) AS settled_activated,
         COALESCE(burst.max_same_connection, 0) AS max_same_connection,
         COALESCE(money.activated, 0) AS activated, COALESCE(money.holding, 0) AS holding,
         COALESCE(money.approvable, 0) AS approvable, COALESCE(money.approved, 0) AS approved,
         COALESCE(money.paid, 0) AS paid, COALESCE(money.voided, 0) AS voided, COALESCE(money.clawback, 0) AS clawback,
         COALESCE(money.pending_amount, 0) AS pending_amount, COALESCE(money.approved_amount, 0) AS approved_amount,
         COALESCE(money.paid_amount, 0) AS paid_amount,
         COUNT(*) OVER () AS total
    FROM partners p
    LEFT JOIN agents a ON a.id = p.agent_id
    LEFT JOIN LATERAL (SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1) ai ON TRUE
    LEFT JOIN conv ON conv.partner_id = p.id
    LEFT JOIN settled_credit ON settled_credit.partner_id = p.id
    LEFT JOIN burst ON burst.partner_id = p.id
    LEFT JOIN money ON money.partner_id = p.id
   WHERE p.kind = 'agent' AND COALESCE(conv.accounts, 0) > 0
     AND ($2::text IS NULL OR p.code ILIKE $2 OR a.agency_name ILIKE $2 OR CONCAT_WS(' ', ai.first_name, ai.last_name) ILIKE $2)
   ORDER BY COALESCE(money.approvable, 0) + COALESCE(money.approved, 0) DESC, COALESCE(conv.accounts, 0) DESC, p.id
   LIMIT $3 OFFSET $4
`;

const likeTerm = (q) => {
  const text = String(q ?? '').trim().slice(0, 80);
  return text ? `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
};

function ledgerRow(row) {
  return {
    partnerId: Number(row.id),
    code: row.code,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    name: row.name,
    status: row.status,
    accounts: Number(row.accounts),
    activated: Number(row.activated),
    holding: Number(row.holding),
    approvable: Number(row.approvable),
    approved: Number(row.approved),
    paid: Number(row.paid),
    voided: Number(row.voided),
    clawback: Number(row.clawback),
    amounts: { pending: Number(row.pending_amount), approved: Number(row.approved_amount), paid: Number(row.paid_amount) },
    flags: referralFlags({
      maxSameConnection24h: Number(row.max_same_connection),
      settledAccounts: Number(row.settled),
      settledActivated: Number(row.settled_activated),
    }),
  };
}

/** @returns {Promise<{available: boolean, rows: object[], total: number}>} */
export async function listAgentLedger({ q = null, limit = 50, offset = 0 } = {}) {
  try {
    const { rows } = await getPool().query(AGENT_LEDGER_SQL, [ACTIVATION_WINDOW_DAYS, likeTerm(q), limit, offset]);
    return { available: true, rows: rows.map(ledgerRow), total: rows[0] ? Number(rows[0].total) : 0 };
  } catch (err) {
    if (MISSING.has(err?.code)) return { available: false, rows: [], total: 0 };
    throw err;
  }
}

/**
 * Credits, newest first, with the customer's FIRST NAME only — the console
 * shows who, the agent's card shows the same, nobody needs the number here.
 */
export const CREDITS_SQL = `
  SELECT pc.id, pc.partner_id, pc.account_id, pc.amount, pc.currency, pc.status, pc.qualified_at, pc.approvable_at,
         pc.activation, pc.approved_at, pc.paid_at, pc.void_reason, pc.clawback_flagged_at, pc.created_at,
         split_part(TRIM(COALESCE(cu.full_name, '')), ' ', 1) AS first_name,
         p.code, p.agent_id
    FROM partner_credits pc
    JOIN partners p ON p.id = pc.partner_id
    LEFT JOIN customers cu ON cu.id = pc.account_id
   WHERE ($1::bigint IS NULL OR pc.partner_id = $1)
     AND ($2::text IS NULL OR pc.status = $2
          OR ($2 = 'approvable' AND pc.status = 'pending' AND pc.approvable_at <= NOW())
          OR ($2 = 'holding' AND pc.status = 'pending' AND pc.approvable_at > NOW())
          OR ($2 = 'clawback' AND pc.clawback_flagged_at IS NOT NULL))
   ORDER BY pc.created_at DESC
   LIMIT $3 OFFSET $4
`;

export async function listCredits({ partnerId = null, status = null, limit = 100, offset = 0 } = {}) {
  try {
    const { rows } = await getPool().query(CREDITS_SQL, [partnerId, status, limit, offset]);
    return rows.map((row) => ({
      id: Number(row.id),
      partnerId: Number(row.partner_id),
      code: row.code,
      agentId: row.agent_id == null ? null : Number(row.agent_id),
      accountId: Number(row.account_id),
      firstName: row.first_name || null,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      qualifiedAt: row.qualified_at,
      approvableAt: row.approvable_at,
      activation: row.activation,
      approvedAt: row.approved_at,
      paidAt: row.paid_at,
      voidReason: row.void_reason,
      clawbackFlaggedAt: row.clawback_flagged_at,
      createdAt: row.created_at,
    }));
  } catch (err) {
    if (MISSING.has(err?.code)) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Writes (partners.payout)
// ---------------------------------------------------------------------------

/**
 * Approves pending credits whose hold has passed. `partnerIds` empty = every
 * agent. A credit still in its hold is never approved, whatever was ticked.
 * @returns {Promise<number>} credits approved
 */
export async function approveCredits({ partnerIds = [], creditIds = [], by }) {
  const { rowCount } = await getPool().query(
    `UPDATE partner_credits SET status = 'approved', approved_at = NOW(), approved_by = $3
      WHERE status = 'pending' AND approvable_at <= NOW()
        AND (cardinality($1::bigint[]) = 0 OR partner_id = ANY($1::bigint[]))
        AND (cardinality($2::bigint[]) = 0 OR id = ANY($2::bigint[]))`,
    [partnerIds, creditIds, by],
  );
  return rowCount;
}

/**
 * Pays each agent's APPROVED credits: one payout row per agent and currency,
 * the credits marked paid and linked to it, in one transaction with the rows
 * locked so two people pressing "Payer" pay once.
 *
 * @returns {Promise<{payouts: number, credits: number, totals: Record<string, number>}>}
 */
export async function payApprovedCredits({ partnerIds, method = 'mobile_money', reference = null, by }) {
  const ids = (partnerIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return { payouts: 0, credits: 0, totals: {} };
  const client = await getPool().connect();
  const result = { payouts: 0, credits: 0, totals: {} };
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, partner_id, amount, currency FROM partner_credits
        WHERE status = 'approved' AND partner_id = ANY($1::bigint[])
        ORDER BY partner_id, id FOR UPDATE`,
      [ids],
    );
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.partner_id}:${row.currency}`;
      if (!groups.has(key)) groups.set(key, { partnerId: row.partner_id, currency: row.currency, ids: [], amount: 0 });
      const group = groups.get(key);
      group.ids.push(row.id);
      group.amount = Math.round((group.amount + Number(row.amount)) * 100) / 100;
    }
    for (const group of groups.values()) {
      if (!(group.amount > 0)) continue;
      const payout = await client.query(
        `INSERT INTO partner_payouts (partner_id, amount, currency, method, reference, paid_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [group.partnerId, group.amount, group.currency, method, reference, by],
      );
      await client.query(
        `UPDATE partner_credits SET status = 'paid', paid_at = NOW(), payout_id = $1 WHERE id = ANY($2::bigint[])`,
        [payout.rows[0].id, group.ids],
      );
      result.payouts += 1;
      result.credits += group.ids.length;
      result.totals[group.currency] = Math.round(((result.totals[group.currency] || 0) + group.amount) * 100) / 100;
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

/** A person's verdict on one credit: an unpaid one is voided, a paid one flagged for clawback. */
export async function voidCredit({ creditId, reason, by }) {
  const text = String(reason ?? '').trim().slice(0, 300);
  if (text.length < 5) throw new Error('reason');
  const pool = getPool();
  const voided = await pool.query(
    `UPDATE partner_credits SET status = 'void', void_reason = $2, voided_at = NOW(), voided_by = $3
      WHERE id = $1 AND status IN ('pending', 'approved')`,
    [creditId, text, by],
  );
  if (voided.rowCount) return 'voided';
  const flagged = await pool.query(
    `UPDATE partner_credits SET clawback_flagged_at = COALESCE(clawback_flagged_at, NOW()),
            void_reason = COALESCE(void_reason, $2)
      WHERE id = $1 AND status = 'paid'`,
    [creditId, text],
  );
  return flagged.rowCount ? 'clawback_flagged' : 'unchanged';
}

// ---------------------------------------------------------------------------
// The agent's own card
// ---------------------------------------------------------------------------

/**
 * Credits and money for one agent's dashboard: counts by state, USD by state,
 * and the last customers by first name. Null before the migration.
 */
export async function getAgentCreditSummary(agentId) {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT pc.status, pc.amount, pc.currency, pc.approvable_at, pc.created_at,
              split_part(TRIM(COALESCE(cu.full_name, '')), ' ', 1) AS first_name
         FROM partner_credits pc
         JOIN partners p ON p.id = pc.partner_id AND p.agent_id = $1
         LEFT JOIN customers cu ON cu.id = pc.account_id
        WHERE pc.status <> 'void'
        ORDER BY pc.created_at DESC`,
      [Number(agentId)],
    );
    const usd = rows.filter((row) => row.currency === 'USD');
    const sum = (filter) => Math.round(usd.filter(filter).reduce((total, row) => total + Number(row.amount), 0) * 100) / 100;
    return {
      activated: rows.length,
      pendingUsd: sum((row) => row.status === 'pending'),
      approvedUsd: sum((row) => row.status === 'approved'),
      paidUsd: sum((row) => row.status === 'paid'),
      recent: rows.slice(0, 8).map((row) => ({
        firstName: row.first_name || null,
        status: row.status,
        createdAt: row.created_at,
      })),
    };
  } catch (err) {
    if (MISSING.has(err?.code)) return null;
    throw err;
  }
}
