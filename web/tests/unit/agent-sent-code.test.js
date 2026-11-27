import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { agentOtpBypassEnabled, otpBypassEnabled } from '@/lib/otpBypass';
import { TRIES_PER_CODE, canSendCode, noteCodeSent, noteWrongCode, resetSignInCodeLimits } from '@/lib/signInCodeLimits';

/*
 * Agents type a code we send (2026-11-24, owner: 24 of the 78 agents asked to
 * send us a code from WhatsApp never did; 23 are still locked out).
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('agents are sent a code whenever the template is configured, even with AUTH_OTP_BYPASS=1', () => {
  const saved = { bypass: process.env.AUTH_OTP_BYPASS, template: process.env.AGENT_OTP_TEMPLATE, flag: process.env.AGENT_SENT_CODE };
  try {
    process.env.AUTH_OTP_BYPASS = '1';
    process.env.AGENT_OTP_TEMPLATE = 'agent_auth_otp';
    delete process.env.AGENT_SENT_CODE;
    assert.equal(otpBypassEnabled(), true);
    assert.equal(agentOtpBypassEnabled(), false, 'production today: the code is sent');
    process.env.AGENT_SENT_CODE = 'off';
    assert.equal(agentOtpBypassEnabled(), true, 'switched off deliberately: back to "send us a code"');
    delete process.env.AGENT_SENT_CODE;
    delete process.env.AGENT_OTP_TEMPLATE;
    assert.equal(agentOtpBypassEnabled(), true, 'no template: a session message never reaches a new agent');
    delete process.env.AUTH_OTP_BYPASS;
    assert.equal(agentOtpBypassEnabled(), false, 'no bypass at all: codes, as before');
  } finally {
    for (const [k, v] of [['AUTH_OTP_BYPASS', saved.bypass], ['AGENT_OTP_TEMPLATE', saved.template], ['AGENT_SENT_CODE', saved.flag]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('every agent path decides with the agent flag, never the bare bypass', () => {
  for (const file of [
    'app/(site)/compte/agent/inscription/actions.js',
    'app/(site)/compte/agent/connexion/actions.js',
    'app/(site)/compte/agent/inscription/page.js',
    'app/(site)/compte/agent/inscription/verifier/page.js',
  ]) {
    const src = read(file);
    assert.match(src, /agentOtpBypassEnabled\(\)/, file);
    assert.doesNotMatch(src, /[^t]otpBypassEnabled\(\)/, `${file}: the bare flag would keep agents on "send us a code"`);
  }
});

test('the verify page leads with the code box; "send us a code" is the fallback', () => {
  const page = read('app/(site)/compte/agent/inscription/verifier/page.js');
  assert.match(page, /\{codeless \? reversePanel : \(/);
  assert.ok(page.indexOf('<form action={agentVerifyOtpAction}') < page.indexOf('<CodeFallback'), 'code box first');
  assert.match(page, /defaultOpen=\{error === 'send_failed' \|\| error === 'send_busy'\}/);
  assert.match(page, /too_many: 'auth\.whatsappSignIn\.errors\.tooMany'/);
});

test('an agent code: 3 sends per 10 minutes and 5 wrong tries, counted apart from customers', () => {
  resetSignInCodeLimits();
  const t0 = 5_000_000;
  for (let i = 0; i < 3; i += 1) noteCodeSent('agent:12', t0 + i);
  assert.equal(canSendCode('agent:12', t0 + 10), false);
  assert.equal(canSendCode(12, t0 + 10), true, 'customer #12 is another account');
  for (let i = 1; i < TRIES_PER_CODE; i += 1) assert.equal(noteWrongCode('agent:12'), false);
  assert.equal(noteWrongCode('agent:12'), true);
  resetSignInCodeLimits();
  const verify = read('app/(site)/compte/agent/inscription/verifier/actions.js');
  assert.match(verify, /if \(!expired && noteWrongCode\(agentCodeKey\(agent\.id\)\)\) \{\n\s+await pool\.query\('UPDATE agents SET otp_code_hash = NULL, otp_expires_at = NULL WHERE id = \$1'/);
  assert.match(verify, /const result = await sendAgentCode\(agent\);/);
  assert.match(read('lib/agentCode.js'), /if \(!canSendCode\(key\)\) return 'busy';/);
});
