import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTO_VOID_REASON, CREDIT_NEW_LISTINGS_SQL, DAY30_CHECK_SQL, FLAG_CLAWBACK_SQL, MILESTONE_LINES_SQL, QUALITY_LINE_SQL,
  VOID_BELOW_THRESHOLD_SQL, attributeNewAgent, checkReferralForSignup, excludeListingCredit, overrideAttribution,
  recordReferralClick, runLaunchSteps, setAttributionValidation,
} from '@/lib/salesLaunch';
import { hashReferralIp, parseReferralCookie, referralCookieValue, whatsappOnboardingText } from '@/lib/salesReferral';
import { PERMISSIONS, sectionPermission } from '@/lib/adminRoles';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

// ---------------------------------------------------------------------------
// What counts as a confirmed listing
// ---------------------------------------------------------------------------

test('a listing is credited only when public, complete, photographed, not a duplicate and after the referral', () => {
  const sql = normalizeSql(CREDIT_NEW_LISTINGS_SQL);
  for (const fragment of [
    'p.status = 1 AND p.approve_status = 1',
    'p.created_at::timestamptz >= att.credit_from',
    'p.price > 0',
    "pc.title IS NOT NULL AND btrim(COALESCE(pc.description, '')) <> ''",
    'WHERE si.property_id = p.id) >= 3',
    "att.validation_status <> 'rejected'",
    'LIKE ANY ($1::text[])',
    'o.featured_image = p.featured_image AND o.id <> p.id',
    's2.image = s1.image AND s2.property_id <> s1.property_id',
    'LOWER(oc.title) = LOWER(pc.title) AND oc.property_id <> p.id AND o.price = p.price',
  ]) {
    assert.ok(sql.includes(fragment), `credit rule missing: ${fragment}`);
  }
  assert.ok(sql.endsWith('ON CONFLICT (property_id) DO NOTHING'), 'a listing is credited once, ever');
});

test('the day-30 check runs once per credit and treats a let or sold listing as valid', () => {
  const sql = normalizeSql(DAY30_CHECK_SQL);
  assert.ok(sql.includes("c2.day30_checked_at IS NULL AND c2.confirmed_at <= NOW() - INTERVAL '30 days'"));
  assert.ok(sql.includes("day30_valid = s.state IN ('live', 'closed')"));
  assert.ok(sql.includes("WHEN p.id IS NULL THEN 'deleted'"));
  assert.ok(sql.includes("p.listing_status IN ('under_offer', 'closed') THEN 'closed'"));
});

// ---------------------------------------------------------------------------
// Ledger lines
// ---------------------------------------------------------------------------

test('milestone lines are generated from validated agents only, idempotently, for active launch reps', () => {
  const sql = normalizeSql(MILESTONE_LINES_SQL);
  assert.ok(sql.includes("s.validation_status = 'validated') AS payable"));
  assert.ok(sql.includes("pl.active AND pl.kind = 'launch_milestones'") && sql.includes("r.status = 'active'"));
  assert.ok(sql.includes('ON CONFLICT (source_type, source_id) DO UPDATE'));
  assert.ok(sql.includes(`WHERE sales_commissions.status = 'void' AND sales_commissions.void_reason = '${AUTO_VOID_REASON}'`),
    'only a line the run itself voided is revived — a person’s void stands');
  assert.ok(sql.includes("('acq:' || lr.rep_id || ':' || tier.threshold)"));
  assert.ok(sql.includes('GREATEST(rc.payable_listings - rc.payable_agents * 3, 0) AS additional'));
});

test('a tier no longer met voids unpaid lines and only flags paid ones', () => {
  const voiding = normalizeSql(VOID_BELOW_THRESHOLD_SQL);
  assert.ok(voiding.includes("sc.status IN ('pending', 'approved')"));
  assert.ok(!voiding.includes("'paid'"));
  const flagging = normalizeSql(FLAG_CLAWBACK_SQL);
  assert.ok(flagging.includes("sc.status = 'paid'"));
  assert.ok(flagging.includes('SET clawback_flagged_at'));
  assert.ok(!flagging.includes("status = 'void'"), 'a paid line is never voided by a query');
});

test('the quality line is once per rep, from checked credits, with the thresholds passed in', async () => {
  const sql = normalizeSql(QUALITY_LINE_SQL);
  assert.ok(sql.includes("'quality:' || q.rep_id") && sql.includes('DO NOTHING'));
  assert.ok(sql.includes('q.checked >= $1 AND q.valid >= $2 * q.checked'));
  await runLaunchSteps({ query: async (text, values) => { calls.push({ sql: normalizeSql(text), values }); return { rowCount: 0, rows: [] }; } });
  const quality = calls.find((c) => c.sql.includes("'quality:'"));
  assert.deepEqual(quality.values, [15, 0.8, 25]);
  const milestones = calls.find((c) => c.sql.includes("'acq:'"));
  assert.deepEqual(milestones.values, [[5, 10, 15, 20, 30, 40, 50], [15, 20, 25, 30, 60, 70, 80], [10, 25, 50, 100], [5, 10, 20, 45]]);
});

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

test('a signup code is refused when unknown, inactive, malformed or the rep’s own number', async () => {
  assert.deepEqual(await checkReferralForSignup({ code: 'x', phoneDigits: '243810000000' }), { ok: false, reason: 'malformed' });

  enqueue([]);
  assert.equal((await checkReferralForSignup({ code: 'jean01', phoneDigits: '243810000000' })).reason, 'unknown_code');
  assert.deepEqual(calls[0].values, ['JEAN01']);

  enqueue([{ id: 3, full_name: 'Jean', phone: '243810000000', status: 'inactive', referral_code: 'JEAN01' }]);
  assert.equal((await checkReferralForSignup({ code: 'JEAN01', phoneDigits: '243810000001' })).reason, 'inactive_rep');

  enqueue([{ id: 3, full_name: 'Jean', phone: '243810000000', status: 'active', referral_code: 'JEAN01' }]);
  assert.equal((await checkReferralForSignup({ code: 'JEAN01', phoneDigits: '243810000000' })).reason, 'self_referral');

  enqueue([{ id: 3, full_name: 'Jean', phone: '243810000000', status: 'active', referral_code: 'JEAN01' }]);
  const ok = await checkReferralForSignup({ code: 'JEAN01', phoneDigits: '243899999999' });
  assert.equal(ok.ok, true);
  assert.equal(ok.rep.id, 3);
});

test('the first valid referral wins: attribution never overwrites, and mirrors the assignment only when written', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // insert: conflict, nothing written
  enqueue([]); // COMMIT
  assert.equal(await attributeNewAgent({ agentId: 9, repId: 3, code: 'JEAN01', source: 'link' }), false);
  assert.ok(calls[1].sql.includes('ON CONFLICT (agent_id) DO NOTHING'));
  assert.ok(!calls.some((c) => c.sql.startsWith('INSERT INTO sales_account_assignments')));

  reset();
  enqueue([]); // BEGIN
  enqueue([{ agent_id: 9 }]);
  enqueue([]); // assignment
  enqueue([]); // COMMIT
  assert.equal(await attributeNewAgent({ agentId: 9, repId: 3, code: 'JEAN01', source: 'qr', ipHash: 'abc' }), true);
  assert.deepEqual(calls[1].values, [9, 3, 'JEAN01', 'qr', 'abc']);
  const assignment = calls.find((c) => c.sql.startsWith('INSERT INTO sales_account_assignments'));
  assert.ok(assignment.sql.includes('WHERE NOT EXISTS (SELECT 1 FROM sales_account_assignments WHERE agent_id = $2 AND ended_at IS NULL)'));
});

test('an override needs an active rep, refuses a no-op, logs the change and moves the credits', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // rep not active
  assert.equal((await overrideAttribution({ agentId: 9, toRepId: 4, reason: 'x'.repeat(20) })).errorKey, 'admin.sales.reps.inactive');

  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 4 }]);
  enqueue([{ id: 9 }]);
  enqueue([{ rep_id: 4 }]); // already this rep
  assert.equal((await overrideAttribution({ agentId: 9, toRepId: 4, reason: 'x'.repeat(20) })).errorKey, 'admin.sales.attribution.sameRep');

  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 4 }]);
  enqueue([{ id: 9 }]);
  enqueue([{ rep_id: 3 }]);
  const result = await overrideAttribution({ agentId: 9, toRepId: 4, reason: 'Introduced at the Limete office visit', evidence: 'WhatsApp thread', adminId: 1 });
  assert.deepEqual(result, { fromRepId: 3, toRepId: 4 });
  assert.ok(calls.some((c) => c.sql.includes("SET rep_id = $2, source = 'admin_override'")));
  assert.ok(calls.some((c) => c.sql === 'UPDATE sales_listing_credits SET rep_id = $2 WHERE agent_id = $1'));
  const change = calls.find((c) => c.sql.startsWith('INSERT INTO sales_attribution_changes'));
  assert.deepEqual(change.values, [9, 3, 4, 'Introduced at the Limete office visit', 'WhatsApp thread', 1]);
  assert.ok(calls.find((c) => c.sql.includes('FOR UPDATE')), 'the attribution row is locked');
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('validation and exclusion are scoped to the rep', async () => {
  await setAttributionValidation({ repId: 3, agentId: 9, status: 'rejected', reason: 'duplicate account', adminId: 1 });
  assert.ok(calls[0].sql.includes('WHERE rep_id = $1 AND agent_id = $2'));
  assert.deepEqual(calls[0].values, [3, 9, 'rejected', 'duplicate account', 1]);
  assert.equal(await setAttributionValidation({ repId: 3, agentId: 9, status: 'approved' }), null);

  reset();
  await excludeListingCredit({ repId: 3, creditId: 12, reason: 'fake property' });
  assert.ok(calls[0].sql.includes('WHERE rep_id = $1 AND id = $2 AND excluded_at IS NULL'));
});

test('a click is counted at most once per connection per rep per hour', async () => {
  await recordReferralClick({ repId: 3, code: 'JEAN01', source: 'qr', ipHash: 'h', userAgent: 'x'.repeat(400) });
  assert.ok(calls[0].sql.includes("c.ip_hash = $4 AND c.created_at > NOW() - INTERVAL '1 hour'"));
  assert.equal(calls[0].values[2], 'qr');
  assert.equal(calls[0].values[4].length, 300);
});

// ---------------------------------------------------------------------------
// Cookie, hashing, WhatsApp text, permissions
// ---------------------------------------------------------------------------

test('the referral cookie carries a valid code and its source, nothing else', () => {
  assert.deepEqual(parseReferralCookie(referralCookieValue('JEAN01', 'qr')), { code: 'JEAN01', source: 'qr' });
  assert.deepEqual(parseReferralCookie('jean01.whatever'), { code: 'JEAN01', source: 'link' });
  assert.equal(parseReferralCookie('<script>.qr'), null);
  assert.equal(parseReferralCookie(undefined), null);
});

test('an IP is only ever stored hashed, and not at all without a secret', () => {
  const hashed = hashReferralIp('102.68.1.1', 'secret');
  assert.match(hashed, /^[0-9a-f]{32}$/);
  assert.ok(!hashed.includes('102'));
  assert.equal(hashReferralIp('102.68.1.1', 'secret'), hashed, 'comparable across signups');
  assert.equal(hashReferralIp('102.68.1.1', ''), null);
  assert.equal(hashReferralIp('', 'secret'), null);
});

test('the WhatsApp signup text carries the phrase the engine recognises', () => {
  const text = whatsappOnboardingText('JEAN01');
  assert.match(text, /Code parrainage : JEAN01$/);
  const engine = readFileSync(new URL('../../../services/salesReferral.js', import.meta.url), 'utf8');
  assert.ok(engine.includes('parrain'), 'the engine pattern must keep matching this wording');
});

test('reps can view sales but only managers manage, and the disputes page is managers only', () => {
  assert.ok(PERMISSIONS['sales.view'].includes('sales'));
  assert.ok(!PERMISSIONS['sales.manage'].includes('sales'));
  assert.equal(sectionPermission('/admin/sales/attribution'), 'sales.manage');
  assert.equal(sectionPermission('/admin/sales/12'), 'sales.view');
});

test('every launch action requires sales.manage and signup never fails on a referral lookup', () => {
  const actions = readFileSync(new URL('../../app/admin/sales/actions.js', import.meta.url), 'utf8');
  for (const name of ['setAgentValidationAction', 'excludeCreditAction', 'overrideAttributionAction']) {
    assert.ok(actions.includes(`export async function ${name}`));
  }
  assert.ok(actions.includes("requireAdmin('sales.manage')"));
  assert.ok(actions.includes('text.length < 20 || text.length > 1000'), 'an override needs a real reason');
  const signup = readFileSync(new URL('../../app/(site)/compte/agent/inscription/actions.js', import.meta.url), 'utf8');
  assert.ok(signup.includes('signing up without it'), 'a failed referral lookup falls through to a normal signup');
});
