import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { customerOtpBypassEnabled, otpBypassEnabled } from '../../lib/otpBypass.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/**
 * Customer signup (owner decision, 2026-11-04): Lukka Place SENDS the code and
 * the customer types it; the name is required. The reverse WhatsApp proof
 * stays only as the fallback when no OTP template exists or the send failed.
 */

function withEnv(env, fn) {
  const saved = { AUTH_OTP_BYPASS: process.env.AUTH_OTP_BYPASS, AGENT_OTP_TEMPLATE: process.env.AGENT_OTP_TEMPLATE };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('customers get a sent code whenever a template exists, whatever AUTH_OTP_BYPASS says', () => {
  withEnv({ AUTH_OTP_BYPASS: '1', AGENT_OTP_TEMPLATE: 'agent_auth_otp' }, () => {
    assert.equal(otpBypassEnabled(), true, 'agents keep the bypass');
    assert.equal(customerOtpBypassEnabled(), false, 'customers are sent a code');
  });
  withEnv({ AUTH_OTP_BYPASS: '1', AGENT_OTP_TEMPLATE: '  ' }, () => {
    assert.equal(customerOtpBypassEnabled(), true, 'no template: a session message would never arrive, keep the reverse proof');
  });
  withEnv({ AUTH_OTP_BYPASS: undefined, AGENT_OTP_TEMPLATE: undefined }, () => {
    assert.equal(customerOtpBypassEnabled(), false);
  });
});

test('every customer entry point reads the customer rule, never the agents\' flag', () => {
  for (const file of [
    'app/(site)/compte/inscription/actions.js',
    'app/(site)/compte/inscription/page.js',
    'app/(site)/compte/inscription/verifier/page.js',
    'app/(site)/compte/connexion/actions.js',
  ]) {
    const src = read(file);
    assert.match(src, /customerOtpBypassEnabled\(\)/, file);
    assert.doesNotMatch(src, /[^r]otpBypassEnabled\(\)/, `${file}: the agent flag must not decide a customer's flow`);
  }
});

test('the verify page offers the reverse proof only without a sent code or after a failed send', () => {
  const page = read('app/(site)/compte/inscription/verifier/page.js');
  assert.match(page, /offerReverse = codeless \|\| error === 'send_failed'/);
  assert.match(page, /if \(offerReverse\)[\s\S]*ensureChallenge\(attempt\)/);
});

test('the name is required, in the form and in the action', () => {
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  const field = form.slice(form.indexOf('id="fullName"'), form.indexOf('id="fullName"') + 300);
  assert.match(field, /\brequired\b/);
  assert.match(form, /t\('auth\.signup\.fullName'\)/);
  const action = read('app/(site)/compte/inscription/actions.js');
  assert.ok(action.indexOf('error=name') > 0 && action.indexOf('error=name') < action.indexOf('createCustomer('), 'refused before the account exists');
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  assert.equal(fr.auth.signup.fullName, 'Nom et prénom');
  assert.match(fr.auth.signup.codeWillBeSent, /6 chiffres/);
});
