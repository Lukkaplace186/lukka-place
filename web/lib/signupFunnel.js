import 'server-only';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { VISITOR_COOKIE, cleanVisitorId } from './trackIngest';
import {
  CUSTOMER_SIGNUP_GOAL,
  cleanSignupEntry,
  cleanSignupRefusal,
  isSignupStep,
  signupGoalProgress,
  summariseSignupFunnel,
} from './signupFunnelRules';

/**
 * Customer sign-up funnel — writes and the dashboard reads
 * (`customer_signup_events`, migrations/20261111_customer_signup_funnel.sql;
 * the rules are lib/signupFunnelRules.js).
 *
 * Recording never throws and never delays an account: a failure is logged,
 * a missing table (before the migration) records nothing quietly.
 */

const MISSING = new Set(['42P01', '42703']);
const TAG_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const INSERT_SIGNUP_EVENT_SQL = `
  INSERT INTO customer_signup_events (visitor_id, entry, step, source, device, viewer_kind, refusal, customer_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

/** @returns {Promise<boolean>} whether a row was written */
export async function recordCustomerSignupEvent({
  step, entry, visitorId = null, source = null, device = null, viewerKind = null, refusal = null, customerId = null,
}) {
  if (!isSignupStep(step)) return false;
  try {
    await getPool().query(INSERT_SIGNUP_EVENT_SQL, [
      cleanVisitorId(visitorId),
      cleanSignupEntry(entry),
      step,
      TAG_RE.test(source || '') ? source : null,
      TAG_RE.test(device || '') ? String(device).slice(0, 32) : null,
      TAG_RE.test(viewerKind || '') ? String(viewerKind).slice(0, 16) : null,
      step === 'refused' ? cleanSignupRefusal(refusal) : null,
      step === 'created' && Number.isSafeInteger(Number(customerId)) ? Number(customerId) : null,
    ]);
    return true;
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[signup-funnel] ${step} (${entry}) not recorded: ${err.message}`);
    return false;
  }
}

/**
 * From signupAction: `refused` or `created`, with this browser's visitor id
 * so it joins the steps the browser reported. A team browser is marked
 * `staff` (the dashboard leaves it out), like every other event.
 */
export async function recordSignupOutcome({ step, entry, refusal = null, customerId = null }) {
  let visitorId = null;
  let viewerKind = 'visitor';
  try {
    const store = await cookies();
    visitorId = store.get(VISITOR_COOKIE)?.value ?? null;
    if (store.get('lp_staff')?.value === '1' || store.get('lukka_impersonation')?.value) viewerKind = 'staff';
  } catch {
    // Outside a request: no visitor id.
  }
  const written = await recordCustomerSignupEvent({ step, entry, visitorId, viewerKind, refusal, customerId });
  if (step === 'refused') console.log(`[signup-funnel] customer refused=${refusal} entry=${cleanSignupEntry(entry)}`);
  return written;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

const KINSHASA_TODAY = `date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa')`;

/** All customer accounts, today and this week (Monday, Kinshasa), and the last 14 days for the pace. */
export const SIGNUP_PROGRESS_SQL = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE c.created_at >= ${KINSHASA_TODAY} AT TIME ZONE 'Africa/Kinshasa')::int AS today,
         COUNT(*) FILTER (WHERE c.created_at >= date_trunc('week', NOW() AT TIME ZONE 'Africa/Kinshasa') AT TIME ZONE 'Africa/Kinshasa')::int AS week,
         COUNT(*) FILTER (WHERE c.created_at >= (${KINSHASA_TODAY} - make_interval(days => 13)) AT TIME ZONE 'Africa/Kinshasa')::int AS recent
    FROM customers c
   WHERE NOT COALESCE((to_jsonb(c) ->> 'is_test')::boolean, false)
`;

/** People: distinct visitors per entry and step; rows with no visitor id count one each. */
export const SIGNUP_FUNNEL_SQL = `
  SELECT e.entry, e.step,
         (COUNT(DISTINCT e.visitor_id) + COUNT(*) FILTER (WHERE e.visitor_id IS NULL))::int AS people,
         COUNT(*)::int AS events
    FROM customer_signup_events e
   WHERE e.created_at >= (${KINSHASA_TODAY} - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
     AND COALESCE(e.viewer_kind, 'visitor') = 'visitor'
   GROUP BY e.entry, e.step
`;

export const SIGNUP_REFUSALS_SQL = `
  SELECT e.entry, e.refusal, COUNT(*)::int AS events
    FROM customer_signup_events e
   WHERE e.step = 'refused'
     AND e.refusal IS NOT NULL
     AND e.created_at >= (${KINSHASA_TODAY} - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
     AND COALESCE(e.viewer_kind, 'visitor') = 'visitor'
   GROUP BY e.entry, e.refusal
`;

/** Accounts created in the window (all of them, measured or not). */
const ACCOUNTS_IN_WINDOW_SQL = `
  SELECT COUNT(*)::int AS n
    FROM customers c
   WHERE NOT COALESCE((to_jsonb(c) ->> 'is_test')::boolean, false)
     AND c.created_at >= (${KINSHASA_TODAY} - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
`;

/** @returns {Promise<ReturnType<typeof signupGoalProgress>>} */
export async function getSignupProgress() {
  const { rows } = await getPool().query(SIGNUP_PROGRESS_SQL);
  const row = rows[0] || {};
  return signupGoalProgress({ ...row, recentSpan: 14, goal: CUSTOMER_SIGNUP_GOAL });
}

/**
 * The funnel for the last `days` Kinshasa days. `measured` is false before
 * the migration (nothing to show); `unmeasured` is the accounts created in the
 * window that carry no `created` event (made before tracking, or by WhatsApp).
 */
export async function getSignupFunnel({ days = 30 } = {}) {
  const span = Math.max(1, Math.min(365, Number(days) || 30));
  const pool = getPool();
  let rows = [];
  let refusalRows = [];
  let measured = true;
  try {
    [{ rows }, { rows: refusalRows }] = await Promise.all([
      pool.query(SIGNUP_FUNNEL_SQL, [span]),
      pool.query(SIGNUP_REFUSALS_SQL, [span]),
    ]);
  } catch (err) {
    if (!MISSING.has(err?.code)) throw err;
    measured = false;
  }
  const { rows: accountRows } = await pool.query(ACCOUNTS_IN_WINDOW_SQL, [span]);
  const summary = summariseSignupFunnel(rows, refusalRows);
  const accounts = accountRows[0]?.n ?? 0;
  return { ...summary, measured, days: span, accounts, unmeasured: Math.max(0, accounts - summary.totals.created) };
}
