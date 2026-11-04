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
  const saved = { AUTH_OTP_BYPASS: process.env.AUTH_OTP_BYPASS, AGENT_OTP_TEMPLATE: process.env.AGENT_OTP_TEMPLATE, CUSTOMER_SENT_CODE: process.env.CUSTOMER_SENT_CODE };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('a sent code is opt-in: CUSTOMER_SENT_CODE=on AND a template, else the reverse proof', () => {
  // 2026-11-04: the template alone switched it on, and it reached nobody.
  withEnv({ AUTH_OTP_BYPASS: '1', AGENT_OTP_TEMPLATE: 'agent_auth_otp', CUSTOMER_SENT_CODE: undefined }, () => {
    assert.equal(otpBypassEnabled(), true, 'agents keep the bypass');
    assert.equal(customerOtpBypassEnabled(), true, 'a configured template is not enough');
  });
  withEnv({ AUTH_OTP_BYPASS: '1', AGENT_OTP_TEMPLATE: 'agent_auth_otp', CUSTOMER_SENT_CODE: 'on' }, () => {
    assert.equal(customerOtpBypassEnabled(), false, 'switched on deliberately: customers are sent a code');
  });
  withEnv({ AUTH_OTP_BYPASS: '1', AGENT_OTP_TEMPLATE: '  ', CUSTOMER_SENT_CODE: 'on' }, () => {
    assert.equal(customerOtpBypassEnabled(), true, 'no template: a session message would never arrive');
  });
  withEnv({ AUTH_OTP_BYPASS: undefined, AGENT_OTP_TEMPLATE: undefined, CUSTOMER_SENT_CODE: undefined }, () => {
    assert.equal(customerOtpBypassEnabled(), false, 'no bypass at all: codes are sent, as before');
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

test('the verify page always keeps the WhatsApp proof: first without a sent code, under the code box with one', () => {
  const page = read('app/(site)/compte/inscription/verifier/page.js');
  assert.match(page, /reverseFirst = codeless \|\| error === 'send_failed'/);
  assert.doesNotMatch(page, /if \(offerReverse\)/, 'the challenge is opened whatever the mode');
  const form = page.indexOf('customerVerifyOtpAction} className');
  const fallback = page.indexOf("t('auth.whatsappVerify.noCodeFallback')");
  assert.ok(form > 0 && fallback > form, 'with a sent code, the WhatsApp proof sits below the code box');
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  assert.match(fr.auth.whatsappVerify.noCodeFallback, /WhatsApp/);
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

test('the WhatsApp proof names the Lukka Place number the code goes to', () => {
  const panel = read('components/WhatsAppVerifyPanel.js');
  assert.match(panel, /auth\.whatsappVerify\.introTo', \{ phone: maskedPhone, business: businessNumber \}/);
  for (const page of ['app/(site)/compte/inscription/verifier/page.js', 'app/(site)/compte/agent/inscription/verifier/page.js']) {
    assert.match(read(page), /businessNumber=\{whatsappVerifyNumber\(\)\}/, page);
  }
  assert.match(read('lib/whatsappVerify.js'), /NEXT_PUBLIC_WHATSAPP_NUMBER[\s\S]*formatPhoneDisplay/);
  for (const l of ['fr', 'en']) {
    const j = JSON.parse(read(`lib/i18n/${l}.json`));
    assert.match(j.auth.whatsappVerify.introTo, /\{business\}/);
    assert.match(j.auth.whatsappVerify.introTo, /\{phone\}/);
  }
});
