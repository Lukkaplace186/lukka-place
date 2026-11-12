import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLIENT_SIGNUP_STEPS, CUSTOMER_SIGNUP_GOAL, PROMPT_ENTRIES, SIGNUP_ENTRIES, SIGNUP_REFUSALS,
  cleanSignupEntry, cleanSignupRefusal, entryForPromptTrigger, isClientSignupStep,
  signupGoalProgress, summariseSignupFunnel, withSignupEntry,
} from '@/lib/signupFunnelRules';
import {
  INSERT_SIGNUP_EVENT_SQL, SIGNUP_FUNNEL_SQL, SIGNUP_PROGRESS_SQL, SIGNUP_REFUSALS_SQL,
  getSignupFunnel, getSignupProgress, recordCustomerSignupEvent,
} from '@/lib/signupFunnel';
import { sanitizeCustomerSignupEvent, sanitizeSignupStep } from '@/app/api/telemetry/signup-funnel/route';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Customer sign-up funnel (2026-11-11, owner goal 1,000 customer accounts):
 * every prompt carries an entry to /compte/inscription, the browser reports
 * shown → opened → page → typed → sent, signupAction records refused / created,
 * and /admin/croissance shows it by entry. web/CLAUDE.md, "Customer sign-up funnel".
 */

const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

beforeEach(() => reset());

test('an entry is one of the known places, anything else is direct', () => {
  for (const entry of SIGNUP_ENTRIES) assert.equal(cleanSignupEntry(entry), entry);
  assert.equal(cleanSignupEntry('FAVORITE'), 'favorite');
  assert.equal(cleanSignupEntry('drop table'), 'direct');
  assert.equal(cleanSignupEntry(undefined), 'direct');
  assert.equal(cleanSignupEntry(['favorite']), 'direct');
});

test('the modal trigger names its entry', () => {
  assert.equal(entryForPromptTrigger('favorite'), 'favorite');
  assert.equal(entryForPromptTrigger('alert'), 'alert');
  assert.equal(entryForPromptTrigger('save'), 'save_search');
  assert.equal(entryForPromptTrigger(undefined), 'save_search');
  for (const entry of ['favorite', 'save_search', 'alert', 'nudge']) assert.ok(PROMPT_ENTRIES.has(entry));
  assert.equal(PROMPT_ENTRIES.has('messages'), false);
});

test('withSignupEntry keeps the query and the hash', () => {
  assert.equal(withSignupEntry('/compte/inscription', 'nudge'), '/compte/inscription?entree=nudge');
  assert.equal(withSignupEntry('/compte/inscription?next=%2F', 'nudge'), '/compte/inscription?next=%2F&entree=nudge');
  assert.equal(withSignupEntry('/compte/inscription?next=%2F#x', 'bogus'), '/compte/inscription?next=%2F&entree=direct#x');
});

test('a browser may report the five client steps only — never refused or created', () => {
  const ctx = { source: 'fb', device: 'mobile', viewer: 'visitor', visitor: 'v_abc' };
  for (const step of CLIENT_SIGNUP_STEPS) {
    assert.equal(sanitizeCustomerSignupEvent({ form: 'customer', step, entry: 'nudge' }, ctx)?.step, step);
  }
  assert.equal(sanitizeCustomerSignupEvent({ form: 'customer', step: 'created', entry: 'nudge' }, ctx), null);
  assert.equal(sanitizeCustomerSignupEvent({ form: 'customer', step: 'refused', entry: 'nudge' }, ctx), null);
  assert.equal(sanitizeCustomerSignupEvent({ form: 'agent', step: 'submit' }, ctx), null);
  assert.equal(isClientSignupStep('created'), false);
  const event = sanitizeCustomerSignupEvent({ form: 'customer', step: 'submit', entry: '<script>' }, { ...ctx, source: 'a b' });
  assert.equal(event.entry, 'direct');
  assert.equal(event.source, 'direct');
  // The agent/request log lines are unchanged.
  assert.equal(sanitizeSignupStep({ form: 'customer', step: 'submit' }, ctx), null);
  assert.equal(sanitizeSignupStep({ form: 'agent', step: 'submit' }, ctx)?.form, 'agent');
});

test('recording an event cleans every value before it reaches the table', async () => {
  assert.equal(await recordCustomerSignupEvent({ step: 'bogus', entry: 'nudge' }), false);
  assert.equal(calls.length, 0);

  await recordCustomerSignupEvent({ step: 'refused', entry: 'alert', refusal: 'password', customerId: 9, source: 'fb' });
  assert.equal(squash(calls[0].text), squash(INSERT_SIGNUP_EVENT_SQL));
  const [visitor, entry, step, source, , , refusal, customerId] = calls[0].values;
  assert.deepEqual([visitor, entry, step, source, refusal, customerId], [null, 'alert', 'refused', 'fb', 'password', null]);

  await recordCustomerSignupEvent({ step: 'created', entry: 'x', refusal: 'password', customerId: 42 });
  const created = calls[1].values;
  assert.equal(created[1], 'direct');
  assert.equal(created[6], null, 'a refusal reason only on a refusal');
  assert.equal(created[7], 42);
  assert.equal(cleanSignupRefusal('drop'), null);
  assert.deepEqual(SIGNUP_REFUSALS, ['name', 'phone', 'password', 'exists', 'ref']);
});

test('the funnel counts people per step, accounts and refusals as events, and leaves the team out', () => {
  const sql = squash(SIGNUP_FUNNEL_SQL);
  assert.match(sql, /COUNT\(DISTINCT e\.visitor_id\)/);
  assert.match(sql, /COALESCE\(e\.viewer_kind, 'visitor'\) = 'visitor'/);
  assert.match(squash(SIGNUP_REFUSALS_SQL), /COALESCE\(e\.viewer_kind, 'visitor'\) = 'visitor'/);
  assert.match(sql, /Africa\/Kinshasa/);

  const summary = summariseSignupFunnel([
    { entry: 'favorite', step: 'prompt_shown', people: 40, events: 55 },
    { entry: 'favorite', step: 'prompt_open', people: 10, events: 10 },
    { entry: 'favorite', step: 'form_view', people: 9, events: 12 },
    { entry: 'favorite', step: 'created', people: 3, events: 4 },
    { entry: 'messages', step: 'form_view', people: 5, events: 5 },
    { entry: 'messages', step: 'created', people: 1, events: 1 },
    { entry: 'weird', step: 'form_view', people: 2, events: 2 },
    { entry: 'favorite', step: 'not_a_step', people: 99, events: 99 },
  ], [
    { entry: 'favorite', refusal: 'password', events: 2 },
    { entry: 'messages', refusal: 'exists', events: 1 },
    { entry: 'messages', refusal: 'bogus', events: 7 },
  ]);
  const favorite = summary.entries.find((e) => e.entry === 'favorite');
  assert.equal(favorite.prompt_shown, 40);
  assert.equal(favorite.created, 4, 'accounts are counted, not people');
  assert.equal(favorite.top, 40);
  assert.equal(favorite.conversion, 4 / 40);
  const messages = summary.entries.find((e) => e.entry === 'messages');
  assert.equal(messages.top, 5, 'a link starts at the page');
  assert.equal(summary.entries.find((e) => e.entry === 'direct').form_view, 2);
  assert.equal(summary.entries[0].entry, 'favorite', 'most accounts first');
  assert.equal(summary.totals.created, 5);
  assert.deepEqual(summary.refusals, { password: 2, exists: 1 });
});

test('the goal: count, pace and an estimate only when there is a pace', () => {
  assert.equal(CUSTOMER_SIGNUP_GOAL, 1000);
  const p = signupGoalProgress({ total: 200, today: 3, week: 12, recent: 28, recentSpan: 14 });
  assert.equal(p.percent, 20);
  assert.equal(p.remaining, 800);
  assert.equal(p.perDay, 2);
  assert.equal(p.daysToGoal, 400);
  assert.equal(signupGoalProgress({ total: 200, recent: 0 }).daysToGoal, null);
  assert.equal(signupGoalProgress({ total: 1200, recent: 5 }).daysToGoal, 0);
  assert.equal(signupGoalProgress({ total: 1200, recent: 5 }).percent, 100);
});

test('progress counts every customer account, today and the week on Kinshasa days', async () => {
  const sql = squash(SIGNUP_PROGRESS_SQL);
  assert.match(sql, /FROM customers c/);
  assert.match(sql, /date_trunc\('week', NOW\(\) AT TIME ZONE 'Africa\/Kinshasa'\)/);
  enqueue([{ total: 150, today: 2, week: 9, recent: 14 }]);
  const progress = await getSignupProgress();
  assert.equal(progress.total, 150);
  assert.equal(progress.perDay, 1);
});

test('the funnel reports accounts created in the window with no recorded entry', async () => {
  enqueue([{ entry: 'nudge', step: 'created', people: 2, events: 2 }]);
  enqueue([]);
  enqueue([{ n: 5 }]);
  const funnel = await getSignupFunnel({ days: 7 });
  assert.equal(funnel.measured, true);
  assert.equal(funnel.accounts, 5);
  assert.equal(funnel.unmeasured, 3);
  assert.deepEqual(calls[0].values, [7]);
});

test('every prompt and link carries its entry, and the form sends it to the action', () => {
  assert.match(read('components/AuthPromptModal.js'), /<WhatsAppSignInForm next=\{next\} entry=\{entry\} onSubmit=\{\(\) => trackCustomerSignup\('prompt_open', entry\)\} \/>/);
  assert.match(read('app/(site)/compte/connexion/WhatsAppSignInForm.js'), /<input type="hidden" name="entry" value=\{entry\} \/>/);
  assert.match(read('app/(site)/compte/connexion/whatsappActions.js'), /recordSignupOutcome\(\{ step: 'created', entry, customerId: Number\(customer\.id\) \}\)/);
  assert.match(read('components/AuthPromptModal.js'), /trackCustomerSignup\('prompt_shown', entry\)/);
  assert.match(read('components/SignupNudge.js'), /withSignupEntry\(`\/compte\/inscription\?next=\$\{next\}`, 'nudge'\)/);
  assert.match(read('app/(site)/messages/page.js'), /entree=messages/);
  assert.match(read('app/(site)/mises-a-jour/page.js'), /entree=updates/);
  assert.match(read('app/(site)/compte/connexion/page.js'), /entree=login_page/);
  assert.match(read('app/(site)/i/[code]/page.js'), /entree=partner_invite/);
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  assert.match(form, /<input type="hidden" name="entry" value=\{entry\} \/>/);
  assert.match(form, /onInput=\{handleFirstInput\}/);
  const action = read('app/(site)/compte/inscription/actions.js');
  assert.match(action, /recordSignupOutcome\(\{ step: 'refused', entry: formData\.get\('entry'\), refusal: error \}\)/);
  assert.match(action, /recordSignupOutcome\(\{ step: 'created', entry: formData\.get\('entry'\), customerId: Number\(customer\.id\) \}\)/);
  assert.match(read('app/(site)/compte/inscription/page.js'), /<CustomerSignupTracker entry=\{entry\} \/>/);
});

test('the migration is idempotent and the table is closed to the public API', () => {
  const sql = read('../migrations/20261111_customer_signup_funnel.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_signup_events/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON customer_signup_events FROM anon, authenticated/);
  for (const step of ['prompt_shown', 'prompt_open', 'form_view', 'form_start', 'submit', 'refused', 'created']) {
    assert.ok(sql.includes(`'${step}'`), step);
  }
});

test('test / demo customers (customers.is_test) are left out of the sign-up progress', () => {
  assert.match(squash(SIGNUP_PROGRESS_SQL), /WHERE NOT COALESCE\(\(to_jsonb\(c\) ->> 'is_test'\)::boolean, false\)/);
});
