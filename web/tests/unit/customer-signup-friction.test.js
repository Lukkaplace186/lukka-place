import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_PASSWORD_MIN, CUSTOMER_PASSWORD_MIN, passwordLongEnough, passwordMinFor } from '@/lib/passwordRules';
import { verifyAndResetPassword } from '@/lib/resetPassword';

/**
 * Sign-up friction fixes (owner, 2026-11-11), after the funnel showed where
 * people are sent back: customers need 6 password characters (agents keep
 * 8), an unknown optional referral code no longer refuses the account, and
 * /admin/croissance counts cost per account over every account, not only
 * "verified" ones (customers stopped confirming their number on 2026-11-06).
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('customers need 6 characters, agents keep 8', () => {
  assert.equal(CUSTOMER_PASSWORD_MIN, 6);
  assert.equal(AGENT_PASSWORD_MIN, 8);
  assert.equal(passwordMinFor('customer'), 6);
  assert.equal(passwordMinFor('agent'), 8);
  assert.equal(passwordLongEnough('abcdef', 'customer'), true);
  assert.equal(passwordLongEnough('abcde', 'customer'), false);
  assert.equal(passwordLongEnough('abcdef', 'agent'), false);
  assert.equal(passwordLongEnough(null, 'customer'), false);
});

test('every customer password form and action uses the customer rule', () => {
  const signup = read('app/(site)/compte/inscription/actions.js');
  assert.match(signup, /passwordLongEnough\(password, 'customer'\)/);
  assert.doesNotMatch(signup, /password\.length < 8/);
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  assert.match(form, /minLength=\{CUSTOMER_PASSWORD_MIN\}/);
  assert.match(form, /auth\.minSixChars/);
  assert.match(read('app/(site)/compte/activer/actions.js'), /passwordLongEnough\(password, 'customer'\)/);
  assert.match(read('app/(site)/compte/activer/page.js'), /minLength=\{CUSTOMER_PASSWORD_MIN\}/);
  assert.match(read('app/(site)/mot-de-passe-oublie/verifier/page.js'), /passwordMinFor\(attempt\.role\)/);
  // Agents are untouched.
  assert.match(read('app/(site)/compte/agent/inscription/actions.js'), /password\.length < 8/);
});

test('the reset applies the role\'s own minimum', async () => {
  assert.deepEqual(await verifyAndResetPassword('243812345678', '123456', 'abcdef', 'agent'), { ok: false, error: 'weak_password' });
  assert.deepEqual(await verifyAndResetPassword('243812345678', '123456', 'abcde', 'customer'), { ok: false, error: 'weak_password' });
  const customer = await verifyAndResetPassword('243812345678', '123456', 'abcdef', 'customer');
  assert.notEqual(customer.error, 'weak_password', 'six characters pass the length rule for a customer');
});

test('an unknown referral code is left out, never a refusal', () => {
  const signup = read('app/(site)/compte/inscription/actions.js');
  assert.doesNotMatch(signup, /return refuse\('ref'/);
  assert.match(signup, /typedCode = '';/);
  // The attribution then falls back to the partner link this browser followed.
  assert.match(signup, /typedCode: typedCode \|\| null/);
});

test('cost per paid account counts every account; the page no longer shows "verified"', () => {
  const dashboard = read('lib/growthDashboard.js');
  assert.match(dashboard, /paidChannelCosts\(spend, accountsByChannel\)/);
  assert.doesNotMatch(dashboard, /paidChannelCosts\(spend, verifiedByChannel\)/);
  assert.doesNotMatch(read('app/admin/croissance/page.js'), /admin\.growth\.verified/);
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  assert.equal(fr.admin.growth.costPerAccount, 'Coût par compte');
  assert.equal(en.admin.growth.costPerAccount, 'Cost per account');
  assert.ok(fr.auth.minSixChars && en.auth.minSixChars && fr.auth.errors.passwordMin6 && en.auth.errors.passwordMin6);
});
