import 'server-only';
import { getPool } from './db';
import { EXTRACTION_FAILURE_MARKERS } from './moderation';
import { COMMUNE_OF_P } from './moderationQueue';
import {
  ACQUISITION_TIERS, ADDITIONAL_TIERS, BASELINE_LISTINGS_PER_AGENT, LAUNCH_CURRENCY, MIN_PHOTOS, QUALITY_BONUS,
  QUALITY_AGE_DAYS, QUALITY_MIN_CHECKED, QUALITY_RATIO, normaliseReferralCode, tierDeltas,
} from './launchCommission';

/**
 * The launch commission policy, database half. lib/launchCommission.js holds
 * the tiers and the arithmetic; this module holds the facts they are applied to.
 *
 * WHERE THE COUNTS COME FROM
 *   - Attribution: `sales_agent_attributions`, written once when an account is
 *     created with a valid referral (web signup here, WhatsApp onboarding in
 *     the engine), or by an audited override. Never backfilled.
 *   - A CONFIRMED listing (policy §7) is credited to the rep the first time the
 *     run sees it approved and public with: a price, a commune, a title and a
 *     description, at least MIN_PHOTOS photos, none of the moderation queue's
 *     blocking flags (extraction-failure text, a photo reused on another
 *     listing, the same title at the same price), created after the
 *     attribution's `credit_from`. The row is frozen in `sales_listing_credits`,
 *     which has no foreign key to `properties`: agents hard-delete listings, and
 *     the 30-day test needs to remember one existed.
 *   - A credit COUNTS today while it is not excluded and the listing still
 *     exists, is approved, and is either public or was let/sold
 *     (`under_offer` / `closed`) — a genuine transaction is the outcome we
 *     want, not a reason to take credit back. Rejected, deleted, archived or
 *     suspended listings stop counting.
 *   - The day-30 check freezes that same verdict once per credit.
 */

const CREDIT_COUNTS_NOW = `(c.excluded_at IS NULL AND p.id IS NOT NULL AND p.approve_status = 1
  AND (p.status = 1 OR p.listing_status IN ('under_offer', 'closed')))`;

const LAUNCH_SOURCES_SQL = "('milestone', 'listing_bonus', 'quality')";
export const AUTO_VOID_REASON = 'auto:below_threshold';

const AGENT_NAME = "COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), NULLIF(TRIM(a.agency_name), ''), 'Agent #' || a.id)";

/**
 * Per attributed agent: is the minimum profile there, how many credits count
 * today, qualified (≥3, not rejected) and payable (qualified AND validated).
 * `repParam` scopes it to one rep ($n) when given.
 */
function agentStatsCte(repParam = null) {
  return `agent_stats AS (
    SELECT att.rep_id, att.agent_id, att.validation_status,
           (a.status = 1 AND a.phone_verified_at IS NOT NULL
             AND (NULLIF(TRIM(ai.first_name), '') IS NOT NULL OR NULLIF(TRIM(a.agency_name), '') IS NOT NULL)) AS profile_ok,
           COALESCE(cr.credited, 0) AS credited
    FROM sales_agent_attributions att
    JOIN agents a ON a.id = att.agent_id
    LEFT JOIN LATERAL (
      SELECT first_name FROM agent_infos WHERE agent_id = a.id ORDER BY (language_id = 20) DESC, language_id LIMIT 1
    ) ai ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS credited
      FROM sales_listing_credits c
      LEFT JOIN properties p ON p.id = c.property_id
      WHERE c.agent_id = att.agent_id AND c.rep_id = att.rep_id AND ${CREDIT_COUNTS_NOW}
    ) cr ON true
    ${repParam ? `WHERE att.rep_id = ${repParam}` : ''}
  ),
  agent_q AS (
    SELECT s.*,
           (s.profile_ok AND s.credited >= ${BASELINE_LISTINGS_PER_AGENT} AND s.validation_status <> 'rejected') AS qualified,
           (s.profile_ok AND s.credited >= ${BASELINE_LISTINGS_PER_AGENT} AND s.validation_status = 'validated') AS payable
    FROM agent_stats s
  ),
  rep_counts AS (
    SELECT rep_id,
           COUNT(*)::int AS registered,
           COUNT(*) FILTER (WHERE qualified)::int AS qualified_agents,
           COALESCE(SUM(credited) FILTER (WHERE qualified), 0)::int AS qualified_listings,
           COUNT(*) FILTER (WHERE payable)::int AS payable_agents,
           COALESCE(SUM(credited) FILTER (WHERE payable), 0)::int AS payable_listings,
           COUNT(*) FILTER (WHERE qualified AND validation_status = 'pending')::int AS awaiting_validation,
           COALESCE(SUM(credited), 0)::int AS credited_listings
    FROM agent_q GROUP BY rep_id
  )`;
}

// ---------------------------------------------------------------------------
// The commission run — steps executed by lib/sales.js's syncSalesCommissions,
// in this order, inside its transaction.
// ---------------------------------------------------------------------------

/** (a) Freeze newly confirmed listings of attributed agents. $1 = extraction-failure LIKE patterns. */
export const CREDIT_NEW_LISTINGS_SQL = `
  INSERT INTO sales_listing_credits (property_id, agent_id, rep_id, confirmed_at)
  SELECT p.id, att.agent_id, att.rep_id, GREATEST(p.created_at::timestamptz, COALESCE(p.moderated_at, p.created_at::timestamptz))
  FROM sales_agent_attributions att
  JOIN properties p ON p.agent_id = att.agent_id
  LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
  WHERE att.validation_status <> 'rejected'
    AND p.status = 1 AND p.approve_status = 1
    AND p.created_at::timestamptz >= att.credit_from
    AND p.price > 0
    AND ${COMMUNE_OF_P} IS NOT NULL
    AND pc.title IS NOT NULL AND btrim(COALESCE(pc.description, '')) <> ''
    AND (SELECT COUNT(*) FROM property_slider_images si WHERE si.property_id = p.id) >= ${MIN_PHOTOS}
    AND NOT (LOWER(COALESCE(pc.description, '')) LIKE ANY ($1::text[]))
    AND NOT (COALESCE(p.featured_image, '') <> '' AND p.featured_image NOT LIKE '%noimage%'
             AND EXISTS (SELECT 1 FROM properties o WHERE o.featured_image = p.featured_image AND o.id <> p.id))
    AND NOT EXISTS (
      SELECT 1 FROM property_slider_images s1
      JOIN property_slider_images s2 ON s2.image = s1.image AND s2.property_id <> s1.property_id
      WHERE s1.property_id = p.id AND s1.image NOT LIKE '%noimage%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM property_contents oc JOIN properties o ON o.id = oc.property_id
      WHERE LOWER(oc.title) = LOWER(pc.title) AND oc.property_id <> p.id AND o.price = p.price AND o.approve_status <> 2
    )
  ON CONFLICT (property_id) DO NOTHING`;

/** (b) Record, once, what each credit looked like 30 days after confirmation. */
export const DAY30_CHECK_SQL = `
  UPDATE sales_listing_credits c
  SET day30_checked_at = NOW(), day30_state = s.state, day30_valid = s.state IN ('live', 'closed')
  FROM (
    SELECT c2.id,
           CASE WHEN c2.excluded_at IS NOT NULL OR att.validation_status = 'rejected' THEN 'excluded'
                WHEN p.id IS NULL THEN 'deleted'
                WHEN p.approve_status = 2 THEN 'rejected'
                WHEN p.approve_status = 1 AND p.listing_status IN ('under_offer', 'closed') THEN 'closed'
                WHEN p.approve_status = 1 AND p.status = 1 THEN 'live'
                ELSE 'offline'
           END AS state
    FROM sales_listing_credits c2
    LEFT JOIN properties p ON p.id = c2.property_id
    LEFT JOIN sales_agent_attributions att ON att.agent_id = c2.agent_id
    WHERE c2.day30_checked_at IS NULL AND c2.confirmed_at <= NOW() - INTERVAL '${QUALITY_AGE_DAYS} days'
  ) s
  WHERE c.id = s.id`;

/** (c) Stamp the first time an agent met the qualified rule. */
export const QUALIFIED_AT_SQL = `
  WITH ${agentStatsCte()}
  UPDATE sales_agent_attributions att SET qualified_at = NOW(), updated_at = NOW()
  FROM agent_q q
  WHERE q.agent_id = att.agent_id AND q.qualified AND att.qualified_at IS NULL`;

/**
 * (d, e) One line per tier reached, holding that tier's delta — from PAYABLE
 * (validated) counts, for active reps on an active launch plan. A line the run
 * itself voided is revived when the threshold is met again; a line a person
 * voided stays void. $1/$2 acquisition thresholds/deltas, $3/$4 additional.
 */
export const MILESTONE_LINES_SQL = `
  WITH ${agentStatsCte()},
  launch_reps AS (
    SELECT rc.rep_id, rc.payable_agents,
           GREATEST(rc.payable_listings - rc.payable_agents * ${BASELINE_LISTINGS_PER_AGENT}, 0) AS additional, pl.id AS plan_id
    FROM rep_counts rc
    JOIN sales_reps r ON r.id = rc.rep_id AND r.status = 'active'
    JOIN sales_commission_plans pl ON pl.id = r.plan_id AND pl.active AND pl.kind = 'launch_milestones'
  ),
  due AS (
    SELECT lr.rep_id, 'milestone'::text AS source_type, ('acq:' || lr.rep_id || ':' || tier.threshold)::text AS source_id,
           tier.threshold, tier.delta, lr.plan_id
    FROM launch_reps lr JOIN unnest($1::int[], $2::numeric[]) AS tier(threshold, delta) ON lr.payable_agents >= tier.threshold
    UNION ALL
    SELECT lr.rep_id, 'listing_bonus'::text, ('add:' || lr.rep_id || ':' || tier.threshold)::text,
           tier.threshold, tier.delta, lr.plan_id
    FROM launch_reps lr JOIN unnest($3::int[], $4::numeric[]) AS tier(threshold, delta) ON lr.additional >= tier.threshold
  )
  INSERT INTO sales_commissions (rep_id, source_type, source_id, basis_amount, amount, currency, earned_at, plan_id)
  SELECT rep_id, source_type, source_id, threshold, delta, '${LAUNCH_CURRENCY}', NOW(), plan_id FROM due
  ON CONFLICT (source_type, source_id) DO UPDATE
    SET status = 'pending', voided_at = NULL, void_reason = NULL, approved_at = NULL, approved_by = NULL, earned_at = NOW()
    WHERE sales_commissions.status = 'void' AND sales_commissions.void_reason = '${AUTO_VOID_REASON}'`;

/** (f) The one-off quality bonus. $1 minimum checked, $2 ratio, $3 amount. */
export const QUALITY_LINE_SQL = `
  WITH q AS (
    SELECT rep_id, COUNT(*)::int AS checked, COUNT(*) FILTER (WHERE day30_valid)::int AS valid
    FROM sales_listing_credits WHERE day30_checked_at IS NOT NULL
    GROUP BY rep_id
  )
  INSERT INTO sales_commissions (rep_id, source_type, source_id, basis_amount, amount, currency, earned_at, plan_id)
  SELECT q.rep_id, 'quality', 'quality:' || q.rep_id, ROUND(q.valid * 100.0 / q.checked, 2), $3::numeric, '${LAUNCH_CURRENCY}', NOW(), pl.id
  FROM q
  JOIN sales_reps r ON r.id = q.rep_id AND r.status = 'active'
  JOIN sales_commission_plans pl ON pl.id = r.plan_id AND pl.active AND pl.kind = 'launch_milestones'
  WHERE q.checked >= $1::int AND q.valid >= $2::numeric * q.checked
  ON CONFLICT (source_type, source_id) DO NOTHING`;

const CURRENT_COUNTS_CTE = `${agentStatsCte()},
  current_counts AS (
    SELECT r.id AS rep_id, COALESCE(rc.payable_agents, 0) AS agents,
           GREATEST(COALESCE(rc.payable_listings, 0) - COALESCE(rc.payable_agents, 0) * ${BASELINE_LISTINGS_PER_AGENT}, 0) AS additional
    FROM sales_reps r LEFT JOIN rep_counts rc ON rc.rep_id = r.id
  )`;

const BELOW_THRESHOLD = `((sc.source_type = 'milestone' AND sc.basis_amount > cur.agents)
  OR (sc.source_type = 'listing_bonus' AND sc.basis_amount > cur.additional))`;

/** (g) A tier no longer met: an unpaid line is voided — never a paid one. */
export const VOID_BELOW_THRESHOLD_SQL = `
  WITH ${CURRENT_COUNTS_CTE}
  UPDATE sales_commissions sc
  SET status = 'void', voided_at = NOW(), void_reason = '${AUTO_VOID_REASON}'
  FROM current_counts cur
  WHERE sc.rep_id = cur.rep_id AND sc.status IN ('pending', 'approved') AND ${BELOW_THRESHOLD}`;

/** (h) A PAID line whose tier is no longer met is flagged for a person to recover; cleared if met again. */
export const FLAG_CLAWBACK_SQL = `
  WITH ${CURRENT_COUNTS_CTE}
  UPDATE sales_commissions sc
  SET clawback_flagged_at = CASE WHEN ${BELOW_THRESHOLD} THEN COALESCE(sc.clawback_flagged_at, NOW()) ELSE NULL END
  FROM current_counts cur
  WHERE sc.rep_id = cur.rep_id AND sc.status = 'paid' AND sc.source_type IN ('milestone', 'listing_bonus')
    AND (sc.clawback_flagged_at IS NOT NULL) <> ${BELOW_THRESHOLD}`;

/** Runs steps (a)–(h) on a client already inside a transaction. */
export async function runLaunchSteps(client) {
  const acquisition = tierDeltas(ACQUISITION_TIERS);
  const additional = tierDeltas(ADDITIONAL_TIERS);
  const credited = await client.query(CREDIT_NEW_LISTINGS_SQL, [EXTRACTION_FAILURE_MARKERS.map((marker) => `%${marker}%`)]);
  const checked = await client.query(DAY30_CHECK_SQL);
  const qualified = await client.query(QUALIFIED_AT_SQL);
  const milestones = await client.query(MILESTONE_LINES_SQL, [
    acquisition.map((line) => line.threshold), acquisition.map((line) => line.delta),
    additional.map((line) => line.threshold), additional.map((line) => line.delta),
  ]);
  const quality = await client.query(QUALITY_LINE_SQL, [QUALITY_MIN_CHECKED, QUALITY_RATIO, QUALITY_BONUS]);
  const voided = await client.query(VOID_BELOW_THRESHOLD_SQL);
  const flagged = await client.query(FLAG_CLAWBACK_SQL);
  return {
    listingsCredited: credited.rowCount ?? 0,
    day30Checked: checked.rowCount ?? 0,
    agentsQualified: qualified.rowCount ?? 0,
    milestoneLines: milestones.rowCount ?? 0,
    qualityLines: quality.rowCount ?? 0,
    milestonesVoided: voided.rowCount ?? 0,
    clawbackFlagsChanged: flagged.rowCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Referral codes, clicks and attribution at signup
// ---------------------------------------------------------------------------

/** @returns {Promise<{id: number, full_name: string, phone: string|null, status: string, referral_code: string}|null>} */
export async function findRepByReferralCode(code) {
  const clean = normaliseReferralCode(code);
  if (!clean) return null;
  const { rows } = await getPool().query(
    'SELECT id, full_name, phone, status, referral_code FROM sales_reps WHERE referral_code = $1',
    [clean],
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

/** A click, at most one per connection per rep per hour. @returns {Promise<boolean>} recorded */
export async function recordReferralClick({ repId, code, source, ipHash, userAgent }) {
  const { rowCount } = await getPool().query(
    `INSERT INTO sales_referral_clicks (rep_id, referral_code, source, ip_hash, user_agent)
     SELECT $1, $2, $3, $4, $5
     WHERE $4::text IS NULL OR NOT EXISTS (
       SELECT 1 FROM sales_referral_clicks c
       WHERE c.rep_id = $1 AND c.ip_hash = $4 AND c.created_at > NOW() - INTERVAL '1 hour'
     )`,
    [repId, code, source === 'qr' ? 'qr' : 'link', ipHash || null, userAgent ? String(userAgent).slice(0, 300) : null],
  );
  return rowCount > 0;
}

export async function recordReferralRefusal({ repId = null, code = null, agentId = null, channel, reason }) {
  try {
    await getPool().query(
      `INSERT INTO sales_referral_refusals (rep_id, referral_code, agent_id, channel, reason) VALUES ($1, $2, $3, $4, $5)`,
      [repId, code ? String(code).slice(0, 40) : null, agentId, channel, reason],
    );
  } catch (err) {
    console.error(`[sales-referral] could not record refusal (${reason}): ${err.message}`);
  }
}

/**
 * Checks a code for a signup before the account exists.
 * @returns {Promise<{ok: true, rep: object} | {ok: false, reason: string, rep?: object}>}
 */
export async function checkReferralForSignup({ code, phoneDigits }) {
  const clean = normaliseReferralCode(code);
  if (!clean) return { ok: false, reason: 'malformed' };
  const rep = await findRepByReferralCode(clean);
  if (!rep) return { ok: false, reason: 'unknown_code' };
  if (rep.status !== 'active') return { ok: false, reason: 'inactive_rep', rep };
  if (rep.phone && phoneDigits && String(rep.phone) === String(phoneDigits).replace(/\D/g, '')) {
    return { ok: false, reason: 'self_referral', rep };
  }
  return { ok: true, rep };
}

/**
 * Writes the permanent attribution for a brand-new account and mirrors it as
 * the rep's account assignment. ON CONFLICT DO NOTHING: an agent already
 * attributed keeps their first rep.
 * @returns {Promise<boolean>} whether a row was written
 */
export async function attributeNewAgent({ agentId, repId, code, source, ipHash = null }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO sales_agent_attributions (agent_id, rep_id, referral_code, source, credit_from, agent_registered_at, ip_hash)
       SELECT a.id, $2, $3, $4, NOW(), a.created_at, $5 FROM agents a WHERE a.id = $1
       ON CONFLICT (agent_id) DO NOTHING
       RETURNING agent_id`,
      [agentId, repId, code, source, ipHash],
    );
    if (inserted.rowCount > 0) {
      await client.query(
        `INSERT INTO sales_account_assignments (rep_id, agent_id, credit_from)
         SELECT $1, $2, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM sales_account_assignments WHERE agent_id = $2 AND ended_at IS NULL)`,
        [repId, agentId],
      );
    }
    await client.query('COMMIT');
    return inserted.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Reads for the rep page and the rep dashboard
// ---------------------------------------------------------------------------

/**
 * Every launch figure for one rep (or, with repId null, per rep for the team
 * table). Counts, never amounts: amounts come from lib/launchCommission.js and
 * the ledger.
 */
export async function getLaunchCounts(repId = null) {
  const params = repId ? [repId] : [];
  const { rows } = await getPool().query(
    `WITH ${agentStatsCte(repId ? '$1' : null)},
     clicks AS (
       SELECT rep_id, COUNT(*)::int AS n FROM sales_referral_clicks ${repId ? 'WHERE rep_id = $1' : ''} GROUP BY rep_id
     ),
     with_listing AS (
       SELECT att.rep_id, COUNT(*)::int AS n
       FROM sales_agent_attributions att
       WHERE ${repId ? 'att.rep_id = $1 AND ' : ''}EXISTS (
         SELECT 1 FROM properties p WHERE p.agent_id = att.agent_id AND p.created_at::timestamptz >= att.credit_from
       )
       GROUP BY att.rep_id
     ),
     quality AS (
       SELECT rep_id, COUNT(*) FILTER (WHERE day30_checked_at IS NOT NULL)::int AS checked,
              COUNT(*) FILTER (WHERE day30_valid)::int AS valid,
              COUNT(*) FILTER (WHERE day30_checked_at IS NULL AND excluded_at IS NULL)::int AS maturing
       FROM sales_listing_credits ${repId ? 'WHERE rep_id = $1' : ''} GROUP BY rep_id
     ),
     money AS (
       SELECT rep_id,
              COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::float AS paid,
              COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::float AS approved,
              COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending,
              BOOL_OR(source_type = 'quality' AND status <> 'void') AS quality_earned,
              COUNT(*) FILTER (WHERE status = 'paid' AND clawback_flagged_at IS NOT NULL)::int AS clawbacks
       FROM sales_commissions
       WHERE source_type IN ${LAUNCH_SOURCES_SQL} ${repId ? 'AND rep_id = $1' : ''}
       GROUP BY rep_id
     )
     SELECT r.id AS rep_id,
            COALESCE(ck.n, 0) AS clicks, COALESCE(rc.registered, 0) AS registered, COALESCE(wl.n, 0) AS with_listing,
            COALESCE(rc.qualified_agents, 0) AS qualified_agents, COALESCE(rc.qualified_listings, 0) AS qualified_listings,
            COALESCE(rc.payable_agents, 0) AS payable_agents, COALESCE(rc.payable_listings, 0) AS payable_listings,
            COALESCE(rc.awaiting_validation, 0) AS awaiting_validation, COALESCE(rc.credited_listings, 0) AS credited_listings,
            COALESCE(q.checked, 0) AS quality_checked, COALESCE(q.valid, 0) AS quality_valid, COALESCE(q.maturing, 0) AS quality_maturing,
            COALESCE(m.paid, 0) AS paid, COALESCE(m.approved, 0) AS approved, COALESCE(m.pending, 0) AS pending,
            COALESCE(m.quality_earned, false) AS quality_earned, COALESCE(m.clawbacks, 0) AS clawbacks
     FROM sales_reps r
     LEFT JOIN rep_counts rc ON rc.rep_id = r.id
     LEFT JOIN clicks ck ON ck.rep_id = r.id
     LEFT JOIN with_listing wl ON wl.rep_id = r.id
     LEFT JOIN quality q ON q.rep_id = r.id
     LEFT JOIN money m ON m.rep_id = r.id
     ${repId ? 'WHERE r.id = $1' : ''}`,
    params,
  );
  const mapped = rows.map((row) => ({ ...row, rep_id: Number(row.rep_id) }));
  return repId ? mapped[0] || null : mapped;
}

export const REFERRED_AGENT_FILTERS = ['all', 'qualified', 'awaiting', 'validated', 'rejected', 'not_qualified'];

/** The agents a rep brought in, with where each stands. */
export async function listReferredAgents(repId, { filter = 'all', limit = 25, offset = 0 } = {}) {
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const where = {
    all: 'true',
    qualified: 'q.qualified',
    awaiting: "q.qualified AND q.validation_status = 'pending'",
    validated: "q.validation_status = 'validated'",
    rejected: "q.validation_status = 'rejected'",
    not_qualified: 'NOT q.qualified',
  }[REFERRED_AGENT_FILTERS.includes(filter) ? filter : 'all'];
  const pool = getPool();
  const base = `WITH ${agentStatsCte('$1')}`;
  const [count, page] = await Promise.all([
    pool.query(`${base} SELECT COUNT(*)::int AS total FROM agent_q q WHERE ${where}`, [repId]),
    pool.query(
      `${base}
       SELECT att.agent_id, att.referral_code, att.source, att.attributed_at, att.credit_from, att.validation_status,
              att.rejection_reason, att.validated_at, att.qualified_at, a.created_at AS registered_at, a.phone,
              a.phone_verified_at, a.status AS agent_status, ${AGENT_NAME} AS name,
              q.profile_ok, q.credited, q.qualified,
              (SELECT COUNT(*)::int FROM properties p WHERE p.agent_id = att.agent_id AND p.created_at::timestamptz >= att.credit_from) AS listings_total,
              (SELECT COUNT(*)::int FROM properties p WHERE p.agent_id = att.agent_id AND p.created_at::timestamptz < att.credit_from) AS listings_before
       FROM agent_q q
       JOIN sales_agent_attributions att ON att.agent_id = q.agent_id
       JOIN agents a ON a.id = att.agent_id
       LEFT JOIN LATERAL (
         SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY (language_id = 20) DESC, language_id LIMIT 1
       ) ai ON true
       WHERE ${where}
       ORDER BY (q.qualified AND att.validation_status = 'pending') DESC, att.attributed_at DESC, att.agent_id DESC
       LIMIT $2 OFFSET $3`,
      [repId, bounded, skip],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows.map((row) => ({ ...row, agent_id: Number(row.agent_id) })) };
}

/** A rep's credited listings, newest confirmation first, with today's state beside the day-30 verdict. */
export async function listListingCredits(repId, { limit = 25, offset = 0 } = {}) {
  const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM sales_listing_credits WHERE rep_id = $1', [repId]),
    pool.query(
      `SELECT c.id, c.property_id, c.agent_id, c.confirmed_at, c.day30_checked_at, c.day30_valid, c.day30_state,
              c.excluded_at, c.excluded_reason, pc.title,
              CASE WHEN c.excluded_at IS NOT NULL THEN 'excluded'
                   WHEN p.id IS NULL THEN 'deleted'
                   WHEN p.approve_status = 2 THEN 'rejected'
                   WHEN p.approve_status = 1 AND p.listing_status IN ('under_offer', 'closed') THEN 'closed'
                   WHEN p.approve_status = 1 AND p.status = 1 THEN 'live'
                   ELSE 'offline'
              END AS state_now,
              ${AGENT_NAME} AS agent_name
       FROM sales_listing_credits c
       LEFT JOIN properties p ON p.id = c.property_id
       LEFT JOIN property_contents pc ON pc.property_id = c.property_id AND pc.language_id = 20
       LEFT JOIN agents a ON a.id = c.agent_id
       LEFT JOIN LATERAL (
         SELECT first_name, last_name FROM agent_infos WHERE agent_id = c.agent_id ORDER BY (language_id = 20) DESC, language_id LIMIT 1
       ) ai ON true
       WHERE c.rep_id = $1
       ORDER BY c.confirmed_at DESC, c.id DESC
       LIMIT $2 OFFSET $3`,
      [repId, bounded, skip],
    ),
  ]);
  return {
    total: count.rows[0]?.total ?? 0,
    rows: page.rows.map((row) => ({ ...row, id: Number(row.id), property_id: Number(row.property_id), agent_id: Number(row.agent_id) })),
  };
}

/** Who brought this agent in, if anyone. */
export async function getAgentAttribution(agentId) {
  const { rows } = await getPool().query(
    `SELECT att.rep_id, att.referral_code, att.source, att.attributed_at, att.credit_from, att.validation_status,
            att.rejection_reason, att.qualified_at, r.full_name AS rep_name
     FROM sales_agent_attributions att JOIN sales_reps r ON r.id = att.rep_id
     WHERE att.agent_id = $1`,
    [agentId],
  );
  return rows[0] ? { ...rows[0], rep_id: Number(rows[0].rep_id) } : null;
}

// ---------------------------------------------------------------------------
// Management writes (sales.manage)
// ---------------------------------------------------------------------------

/** Validate or reject an attributed agent. @returns {Promise<object|null>} the updated row */
export async function setAttributionValidation({ repId, agentId, status, reason = null, adminId = null }) {
  if (!['validated', 'rejected', 'pending'].includes(status)) return null;
  const { rows } = await getPool().query(
    `UPDATE sales_agent_attributions
     SET validation_status = $3, rejection_reason = $4,
         validated_at = CASE WHEN $3 = 'pending' THEN NULL ELSE NOW() END,
         validated_by = CASE WHEN $3 = 'pending' THEN NULL ELSE $5::bigint END,
         updated_at = NOW()
     WHERE rep_id = $1 AND agent_id = $2
     RETURNING agent_id, validation_status`,
    [repId, agentId, status, status === 'rejected' ? reason : null, adminId],
  );
  return rows[0] || null;
}

/** Take a credited listing out of every count (fraud, duplicate found later). */
export async function excludeListingCredit({ repId, creditId, reason, adminId = null }) {
  const { rows } = await getPool().query(
    `UPDATE sales_listing_credits
     SET excluded_at = NOW(), excluded_reason = $3, excluded_by = $4
     WHERE rep_id = $1 AND id = $2 AND excluded_at IS NULL
     RETURNING id, property_id, agent_id`,
    [repId, creditId, reason, adminId],
  );
  return rows[0] || null;
}

/**
 * Move an agent to another rep, or attribute an agent nobody referred. Reason
 * required; every change is a row in sales_attribution_changes. Credits move
 * with the agent (the next run recomputes both reps' tiers); ledger lines
 * already PAID stay with the rep they were paid to.
 * @returns {Promise<{errorKey: string} | {fromRepId: number|null, toRepId: number}>}
 */
export async function overrideAttribution({ agentId, toRepId, reason, evidence = null, creditFrom = null, adminId = null }) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const rep = await client.query("SELECT id FROM sales_reps WHERE id = $1 AND status = 'active'", [toRepId]);
    if (!rep.rows[0]) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.sales.reps.inactive' };
    }
    const agent = await client.query('SELECT id FROM agents WHERE id = $1', [agentId]);
    if (!agent.rows[0]) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.sales.attribution.agentMissing' };
    }
    const current = await client.query('SELECT rep_id FROM sales_agent_attributions WHERE agent_id = $1 FOR UPDATE', [agentId]);
    const fromRepId = current.rows[0] ? Number(current.rows[0].rep_id) : null;
    if (fromRepId === Number(toRepId)) {
      await client.query('ROLLBACK');
      return { errorKey: 'admin.sales.attribution.sameRep' };
    }
    if (fromRepId == null) {
      await client.query(
        `INSERT INTO sales_agent_attributions (agent_id, rep_id, source, credit_from, agent_registered_at, created_by)
         SELECT a.id, $2, 'admin_override', COALESCE($3::timestamptz, NOW()), a.created_at, $4 FROM agents a WHERE a.id = $1`,
        [agentId, toRepId, creditFrom, adminId],
      );
    } else {
      await client.query(
        `UPDATE sales_agent_attributions
         SET rep_id = $2, source = 'admin_override', credit_from = COALESCE($3::timestamptz, credit_from), updated_at = NOW()
         WHERE agent_id = $1`,
        [agentId, toRepId, creditFrom],
      );
      await client.query('UPDATE sales_listing_credits SET rep_id = $2 WHERE agent_id = $1', [agentId, toRepId]);
    }
    await client.query(
      `INSERT INTO sales_attribution_changes (agent_id, from_rep_id, to_rep_id, reason, evidence, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agentId, fromRepId, toRepId, reason, evidence, adminId],
    );
    await client.query(
      'UPDATE sales_account_assignments SET ended_at = NOW(), ended_by = $3 WHERE agent_id = $1 AND ended_at IS NULL AND rep_id <> $2',
      [agentId, toRepId, adminId],
    );
    await client.query(
      `INSERT INTO sales_account_assignments (rep_id, agent_id, credit_from, assigned_by)
       SELECT $1, $2, COALESCE($3::timestamptz, NOW()), $4
       WHERE NOT EXISTS (SELECT 1 FROM sales_account_assignments WHERE agent_id = $2 AND ended_at IS NULL)`,
      [toRepId, agentId, creditFrom, adminId],
    );
    await client.query('COMMIT');
    return { fromRepId, toRepId: Number(toRepId) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Every referral code in use, for suggesting a free one. */
export async function listReferralCodes() {
  const { rows } = await getPool().query('SELECT referral_code FROM sales_reps WHERE referral_code IS NOT NULL');
  return rows.map((row) => row.referral_code);
}

/** Whether a rep's code has already brought an agent in (it can no longer change). */
export async function referralCodeLocked(repId) {
  const { rows } = await getPool().query(
    `SELECT EXISTS (
       SELECT 1 FROM sales_agent_attributions att JOIN sales_reps r ON r.id = $1
       WHERE att.referral_code = r.referral_code
     ) AS locked`,
    [repId],
  );
  return Boolean(rows[0]?.locked);
}

// ---------------------------------------------------------------------------
// Disputes and suspicious patterns — facts only, nothing is penalised here
// ---------------------------------------------------------------------------

export async function listReferralRefusals({ limit = 25, offset = 0 } = {}) {
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM sales_referral_refusals'),
    pool.query(
      `SELECT f.id, f.referral_code, f.channel, f.reason, f.created_at, f.agent_id, f.rep_id, r.full_name AS rep_name
       FROM sales_referral_refusals f LEFT JOIN sales_reps r ON r.id = f.rep_id
       ORDER BY f.created_at DESC, f.id DESC LIMIT $1 OFFSET $2`,
      [Math.min(Number(limit) || 25, 100), Math.max(Number(offset) || 0, 0)],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows };
}

export async function listAttributionChanges({ limit = 25, offset = 0 } = {}) {
  const pool = getPool();
  const [count, page] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM sales_attribution_changes'),
    pool.query(
      `SELECT ch.id, ch.agent_id, ch.from_rep_id, ch.to_rep_id, ch.reason, ch.evidence, ch.changed_at,
              rf.full_name AS from_rep_name, rt.full_name AS to_rep_name, u.full_name AS changed_by_name
       FROM sales_attribution_changes ch
       LEFT JOIN sales_reps rf ON rf.id = ch.from_rep_id
       LEFT JOIN sales_reps rt ON rt.id = ch.to_rep_id
       LEFT JOIN console_admin_users u ON u.id = ch.changed_by
       ORDER BY ch.changed_at DESC, ch.id DESC LIMIT $1 OFFSET $2`,
      [Math.min(Number(limit) || 25, 100), Math.max(Number(offset) || 0, 0)],
    ),
  ]);
  return { total: count.rows[0]?.total ?? 0, rows: page.rows };
}

/**
 * Patterns worth a look. Each is a fact with its evidence, never a verdict:
 *   - shared_connection: 3+ attributed signups from one hashed connection;
 *   - prior_listings: an attributed agent who had listings before the referral;
 *   - day30_failures: an agent with 3+ checked credits and fewer than half still valid on day 30.
 */
export async function listSuspiciousReferrals() {
  const pool = getPool();
  const [shared, prior, failing] = await Promise.all([
    pool.query(
      `SELECT att.ip_hash, COUNT(*)::int AS agents, ARRAY_AGG(att.agent_id ORDER BY att.agent_id) AS agent_ids,
              ARRAY_AGG(DISTINCT r.full_name) AS rep_names, MAX(att.attributed_at) AS last_at
       FROM sales_agent_attributions att JOIN sales_reps r ON r.id = att.rep_id
       WHERE att.ip_hash IS NOT NULL
       GROUP BY att.ip_hash HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC, MAX(att.attributed_at) DESC LIMIT 50`,
    ),
    pool.query(
      `SELECT att.agent_id, att.rep_id, r.full_name AS rep_name, att.attributed_at, x.before
       FROM sales_agent_attributions att
       JOIN sales_reps r ON r.id = att.rep_id
       JOIN LATERAL (
         SELECT COUNT(*)::int AS before FROM properties p WHERE p.agent_id = att.agent_id AND p.created_at::timestamptz < att.credit_from
       ) x ON x.before > 0
       ORDER BY x.before DESC, att.attributed_at DESC LIMIT 50`,
    ),
    pool.query(
      `SELECT c.agent_id, c.rep_id, r.full_name AS rep_name, COUNT(*)::int AS checked,
              COUNT(*) FILTER (WHERE c.day30_valid)::int AS valid
       FROM sales_listing_credits c JOIN sales_reps r ON r.id = c.rep_id
       WHERE c.day30_checked_at IS NOT NULL
       GROUP BY c.agent_id, c.rep_id, r.full_name
       HAVING COUNT(*) >= 3 AND COUNT(*) FILTER (WHERE c.day30_valid) * 2 < COUNT(*)
       ORDER BY COUNT(*) DESC LIMIT 50`,
    ),
  ]);
  return { sharedConnections: shared.rows, priorListings: prior.rows, day30Failures: failing.rows };
}
