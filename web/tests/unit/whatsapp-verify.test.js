import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/**
 * AUTH_OTP_BYPASS used to stamp an account phone-verified at submit time —
 * register an agency's number, collect its WhatsApp listings. It now sends
 * the person to the verify page, where only a WhatsApp message FROM the
 * number verifies it (lib/whatsappVerify.js + engine services/phoneChallenges.js).
 */
const ENTRY_POINTS = [
  'app/(site)/compte/agent/inscription/actions.js',
  'app/(site)/compte/agent/connexion/actions.js',
  // Customer signup and login open no verification at all since 2026-11-06
  // (number + password); customer-easy-login.test.js pins that.
];

test('no bypass branch verifies a number or opens a session by itself', () => {
  for (const file of ENTRY_POINTS) {
    const src = read(file);
    const at = src.search(/[oO]tpBypassEnabled\(\)\)/);
    assert.ok(at > 0, `${file}: has a bypass branch`);
    const branch = src.slice(at, at + 900);
    const body = branch.slice(0, branch.indexOf('\n  }') + 4);
    assert.doesNotMatch(body, /consume(Agent|Customer)Otp/, `${file}: bypass must not mark the number verified`);
    assert.doesNotMatch(body, /establish(Agent|Customer)Session/, `${file}: bypass must not open a session`);
    assert.match(body, /verifier|verifyUrl/, `${file}: bypass goes to the verify page`);
  }
});

test('only a consumed WhatsApp proof verifies, and the account comes from the signed cookie', () => {
  const action = read('app/(site)/compte/whatsappVerifyActions.js');
  const guard = action.indexOf('consumeVerifiedChallenge(attempt)');
  assert.ok(guard > 0);
  assert.ok(action.indexOf('await consumeAgentOtp') > guard && action.indexOf('await consumeCustomerOtp') > guard, 'verification happens only after the proof is consumed');
  assert.match(action, /getVerifyAttempt\(\)/);
  const lib = read('lib/whatsappVerify.js');
  assert.match(lib, /role = \$1 AND account_id = \$2 AND phone = \$3/, 'the proof is tied to this attempt\'s account AND number');
  assert.match(lib, /consumed_at IS NULL/, 'a proof is spent once');
});

test('both verify pages offer WhatsApp verification', () => {
  for (const page of ['app/(site)/compte/agent/inscription/verifier/page.js', 'app/(site)/compte/inscription/verifier/page.js']) {
    assert.match(read(page), /<WhatsAppVerifyPanel/);
  }
});

test('a login finishes a proof the verify page never collected (customers #35 and #39)', () => {
  const lib = read('lib/whatsappVerify.js');
  assert.match(lib, /export async function consumeProofAtLogin[\s\S]*?consumeVerifiedChallenge\(\{ role, id, phone \}\)/, 'the same spend-once proof the page uses');
  for (const [file, consume, gate] of [
    ['app/(site)/compte/connexion/actions.js', 'consumeCustomerOtp', null],
    ['app/(site)/compte/agent/connexion/actions.js', 'consumeAgentOtp', 'otpBypassEnabled()'],
  ]) {
    const src = read(file);
    const check = src.indexOf('consumeProofAtLogin({');
    assert.ok(check > 0, `${file}: checks for a proof`);
    const passwordCheck = src.search(/verifyPasswordAgainstHash(?:Async)?\(password/);
    assert.ok(passwordCheck > 0, `${file}: checks the password`);
    assert.ok(check > passwordCheck, `${file}: only after the password matched`);
    // Agents: before the verify step is chosen. Customers have no verify step
    // at login any more (2026-11-06): the proof is simply taken if present.
    if (gate) assert.ok(check < src.indexOf(`!agent.phone_verified_at && ${gate}`), `${file}: before the verify step is chosen`);
    assert.ok(src.slice(check, check + 300).includes(`await ${consume}(`), `${file}: verifies through the usual path`);
  }
});
