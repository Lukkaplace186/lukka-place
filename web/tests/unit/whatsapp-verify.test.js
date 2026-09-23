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
  'app/(site)/compte/inscription/actions.js',
  'app/(site)/compte/connexion/actions.js',
];

test('no bypass branch verifies a number or opens a session by itself', () => {
  for (const file of ENTRY_POINTS) {
    const src = read(file);
    const branch = src.slice(src.indexOf('otpBypassEnabled())'), src.indexOf('otpBypassEnabled())') + 900);
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
