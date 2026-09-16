import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoneyList, parseAmount, periodRange, sumByCurrency, validatePlanInput, validateRepInput,
} from '@/lib/salesRules';
import {
  SYNC_ONBOARDING_SQL, SYNC_SUBSCRIPTIONS_SQL, SYNC_TARGETS_SQL, VOID_CANCELLED_SQL,
  approveCommissions, assignAgentsToRep, recordSalesPayout, syncSalesCommissions, voidCommission,
} from '@/lib/sales';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('periods follow the Kinshasa calendar', () => {
  const now = new Date('2026-09-16T10:00:00Z');
  assert.equal(periodRange('month', now).from, '2026-08-31T23:00:00.000Z', 'September starts at midnight UTC+1');
  assert.equal(periodRange('year', now).from, '2025-12-31T23:00:00.000Z');
  assert.equal(periodRange('all', now).from, null);
  assert.equal(periodRange('bogus', now).from, periodRange('month', now).from);
  // 23:30 UTC on 31 August is already September in Kinshasa.
  assert.equal(periodRange('month', new Date('2026-08-31T23:30:00Z')).from, '2026-08-31T23:00:00.000Z');
});

test('amounts typed the French way or the English way parse to two decimals', () => {
  assert.equal(parseAmount('1 200,50'), 1200.5);
  assert.equal(parseAmount('1200.5'), 1200.5);
  assert.equal(parseAmount('-25', { allowNegative: true }), -25);
  assert.equal(parseAmount('-25'), null);
  assert.equal(parseAmount('0', { allowZero: false }), null);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('1e5'), null);
});

test('a plan is refused with a target but no bonus, or a bonus but no target', () => {
  const base = { name: 'Standard', currency: 'usd', onboardingBonus: '10', subscriptionRate: '12.5', monthlyTarget: '', targetBonus: '', active: 'true' };
  assert.deepEqual(validatePlanInput(base).values, {
    name: 'Standard', currency: 'USD', onboardingBonus: 10, subscriptionRate: 12.5, monthlyTarget: 0, targetBonus: 0, active: true,
  });
  assert.equal(validatePlanInput({ ...base, monthlyTarget: '5' }).errorKey, 'admin.sales.plans.targetPair');
  assert.equal(validatePlanInput({ ...base, targetBonus: '50' }).errorKey, 'admin.sales.plans.targetPair');
  assert.equal(validatePlanInput({ ...base, subscriptionRate: '101' }).errorKey, 'admin.sales.plans.rateInvalid');
  assert.equal(validatePlanInput({ ...base, currency: 'dollars' }).errorKey, 'admin.sales.plans.currencyInvalid');
});

test('a rep\'s phone is stored as digits and a bad email is refused', () => {
  assert.equal(validateRepInput({ fullName: 'Grace M.', phone: '+243 81 555 0000' }).values.phone, '243815550000');
  assert.equal(validateRepInput({ fullName: 'Grace M.', email: 'nope' }).errorKey, 'admin.sales.reps.emailInvalid');
  assert.equal(validateRepInput({ fullName: '' }).errorKey, 'admin.sales.reps.nameInvalid');
});

test('money is never summed across currencies', () => {
  const totals = sumByCurrency([{ currency: 'USD', earned: 10.1 }, { currency: 'CDF', earned: 5000 }, { currency: 'USD', earned: 0.2 }], 'earned');
  assert.deepEqual(totals, [{ currency: 'CDF', amount: 5000 }, { currency: 'USD', amount: 10.3 }]);
  assert.match(formatMoneyList(totals), /CDF · .*USD/);
  assert.equal(formatMoneyList([]), '—');
});

// ---------------------------------------------------------------------------
// Commission generation: SQL invariants
// ---------------------------------------------------------------------------

test('a subscription commission is only a real, active, non-trial payment made after the credit date', () => {
  const sql = normalizeSql(SYNC_SUBSCRIPTIONS_SQL);
  assert.ok(sql.includes('COALESCE(mem.is_trial, 0) = 0 AND mem.price > 0 AND mem.status = 1'));
  assert.ok(sql.includes('mem.created_at >= vr.credit_from'));
  assert.ok(sql.includes("r.status = 'active'") && sql.includes('p.active'));
  assert.ok(sql.includes('HAVING COUNT(DISTINCT sa.rep_id) = 1'), 'a vendor split between two reps credits nobody');
  assert.ok(sql.endsWith('ON CONFLICT (source_type, source_id) DO NOTHING'), 'regeneration is idempotent');
});

test('an onboarding bonus needs a verified phone after the credit date; a target bonus only a closed month', () => {
  const onboarding = normalizeSql(SYNC_ONBOARDING_SQL);
  assert.ok(onboarding.includes('a.phone_verified_at IS NOT NULL AND a.phone_verified_at >= sa.credit_from'));
  assert.ok(onboarding.includes('sa.ended_at IS NULL'));
  const targets = normalizeSql(SYNC_TARGETS_SQL);
  assert.ok(targets.includes("m.month_start < date_trunc('month', NOW() AT TIME ZONE 'Africa/Kinshasa')"));
  assert.ok(targets.includes('m.sold >= p.monthly_target'));
});

test('a cancelled plan voids what is not paid yet — never what was already paid', () => {
  const sql = normalizeSql(VOID_CANCELLED_SQL);
  assert.ok(sql.includes("sc.status IN ('pending', 'approved')"));
  assert.ok(!sql.includes("'paid'"));
});

test('the four generation steps run in one transaction', async () => {
  await syncSalesCommissions();
  const statements = calls.map((c) => c.sql.split(' ')[0]);
  assert.deepEqual(statements, ['BEGIN', 'WITH', 'INSERT', 'WITH', 'UPDATE', 'COMMIT']);
});

// ---------------------------------------------------------------------------
// Approvals, voids, payouts, assignments
// ---------------------------------------------------------------------------

test('approval is scoped to the rep and to pending lines', async () => {
  enqueue([{ id: 4 }]);
  const result = await approveCommissions({ repId: 2, ids: [4, 4, 'x', 5], adminId: 1 });
  assert.ok(calls[0].sql.includes("WHERE rep_id = $1 AND id = ANY($2::bigint[]) AND status = 'pending'"));
  assert.deepEqual(calls[0].values[1], [4, 5]);
  assert.deepEqual(result.approvedIds, [4]);
});

test('only a pending or approved line of this rep can be voided', async () => {
  await voidCommission({ repId: 2, id: 9, reason: 'duplicate' });
  assert.ok(calls[0].sql.includes("WHERE rep_id = $1 AND id = $2 AND status IN ('pending', 'approved')"));
});

test('a payout locks approved lines of one currency and refuses a selection that changed', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // nothing approved
  const none = await recordSalesPayout({ repId: 2, currency: 'USD', method: 'Cash', paidAt: '2026-09-16' });
  assert.equal(none.errorKey, 'admin.sales.ledger.noneApproved');
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));

  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 1, amount: 10 }]); // only one of the two selected lines is still approved
  const changed = await recordSalesPayout({ repId: 2, currency: 'USD', ids: [1, 2], method: 'Cash', paidAt: '2026-09-16' });
  assert.equal(changed.errorKey, 'admin.sales.ledger.selectionChanged');

  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 1, amount: 10.1 }, { id: 2, amount: 0.2 }]);
  enqueue([{ id: 30 }]); // payout insert
  enqueue([]); // update lines
  enqueue([]); // COMMIT
  const paid = await recordSalesPayout({ repId: 2, currency: 'USD', method: 'M-Pesa', paidAt: '2026-09-16', adminId: 1 });
  assert.deepEqual(paid, { payoutId: 30, total: 10.3, count: 2 });
  const select = calls.find((c) => c.sql.startsWith('SELECT id, amount'));
  assert.ok(select.sql.includes("status = 'approved' AND currency = $2") && select.sql.endsWith('FOR UPDATE'));
  assert.ok(calls.some((c) => c.sql.startsWith("UPDATE sales_commissions SET status = 'paid', payout_id = $1")));
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('assigning agents moves them from another rep and never duplicates an active assignment', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // rep is not active
  const inactive = await assignAgentsToRep({ repId: 2, agentIds: [7], creditFrom: '2026-09-01T00:00:00Z' });
  assert.equal(inactive.errorKey, 'admin.sales.reps.inactive');

  reset();
  enqueue([]); // BEGIN
  enqueue([{ '?column?': 1 }]); // rep active
  enqueue([{ agent_id: 7 }]); // ended elsewhere
  enqueue([{ agent_id: 7 }, { agent_id: 8 }]); // inserted
  enqueue([]); // COMMIT
  const result = await assignAgentsToRep({ repId: 2, agentIds: [7, 8], creditFrom: '2026-09-01T00:00:00Z', adminId: 1 });
  assert.deepEqual(result, { assignedIds: [7, 8], movedIds: [7] });
  const moved = calls.find((c) => c.sql.startsWith('UPDATE sales_account_assignments'));
  assert.ok(moved.sql.includes('ended_at IS NULL AND rep_id <> $2'));
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO sales_account_assignments'));
  assert.ok(insert.sql.includes('NOT EXISTS (SELECT 1 FROM sales_account_assignments x WHERE x.agent_id = a.id AND x.ended_at IS NULL)'));
});
