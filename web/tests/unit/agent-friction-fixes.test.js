import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { getAgentByPhone, reclaimUnverifiedAgent } from '@/lib/agents';
import {
  createAgentSessionToken,
  renewedAgentSessionToken,
  verifyAgentSessionToken,
  AGENT_RENEW_WHEN_LEFT_MS,
} from '@/lib/agentAuth';

/**
 * Agent friction review (2026-11-08, owner request): the four ways an agent
 * could be locked out for good, and the sign-in / sign-up frictions.
 */

beforeEach(() => reset());
const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const SIGNUP = 'app/(site)/compte/agent/inscription/actions.js';
const LOGIN = 'app/(site)/compte/agent/connexion/actions.js';

// --- blockers -------------------------------------------------------------------

test('an unverified account with no listing is taken over by the next sign-up, in one guarded UPDATE', async () => {
  enqueue([{ id: 41, phone: '243990000041', token_version: 2 }]);
  const row = await reclaimUnverifiedAgent(41, 'hash');
  assert.equal(row.id, 41);
  const sql = calls[0].sql;
  assert.match(sql, /phone_verified_at IS NULL/);
  assert.match(sql, /deleted_at IS NULL/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM properties p WHERE p\.agent_id = \$1\)/);
  assert.match(sql, /token_version = token_version \+ 1/, 'the old holder’s sessions end');
  enqueue([]);
  assert.equal(await reclaimUnverifiedAgent(41, 'hash'), null, 'no longer qualifies → null');

  const action = read(SIGNUP);
  assert.match(action, /const reclaimable = Boolean\(existing && !existing\.phone_verified_at\);/);
  assert.ok(action.indexOf('reclaimUnverifiedAgent(') > action.indexOf("refuse('ref'"), 'only after the referral code is checked');
  assert.match(action, /if \(!reclaimed\) return refuse\('exists', formData\);/);
  // The taken-over account still goes through verification.
  assert.ok(action.indexOf('setVerifyAttemptCookie(') > action.indexOf('reclaimUnverifiedAgent('));
});

test('a WhatsApp-joined agent with no password is sent to set one, from sign-in and from sign-up', () => {
  const setup = read('lib/agentPasswordSetup.js');
  assert.match(setup, /requestPasswordReset\(phone, 'agent'\)/);
  assert.match(setup, /setResetAttemptCookie\(\{ role: 'agent', phone \}\)/);
  assert.match(setup, /\/mot-de-passe-oublie\/verifier\?nouveau=1/);
  const login = read(LOGIN);
  assert.ok(login.indexOf('if (!agent.password_hash)') < login.indexOf('agent.locked_until'), 'before any lockout or "incorrect"');
  assert.match(login, /redirect\(await startAgentPasswordSetup\(phone\)\);/);
  assert.match(read(SIGNUP), /if \(existing && !existing\.password_hash && existing\.phone_verified_at\) \{\s+redirect\(await startAgentPasswordSetup\(phone\)\);/);
  assert.match(read('app/(site)/mot-de-passe-oublie/verifier/page.js'), /auth\.agentFirstPassword/);
});

test('a failed code send lands on the verify page, never back on sign-up', () => {
  for (const file of [SIGNUP, LOGIN]) {
    const src = read(file);
    assert.doesNotMatch(src, /error=otp_failed/, file);
    assert.match(src, /\/compte\/agent\/inscription\/verifier\?next=\$\{encodeURIComponent\(next\)\}\$\{sent \? '' : '&error=send_failed'\}/, file);
  }
});

test('a removed agent can sign up again: the live account wins the phone lookup', async () => {
  enqueue([{ id: 7, deleted_at: null }]);
  await getAgentByPhone('243990000007');
  assert.match(calls[0].sql, /ORDER BY \(deleted_at IS NULL\) DESC, id DESC LIMIT 1/);
  const action = read(SIGNUP);
  assert.match(action, /const existing = found && !found\.deleted_at \? found : null;/);
});

test('after a reset an agent with a verified number is signed in', () => {
  const action = read('app/(site)/mot-de-passe-oublie/verifier/actions.js');
  assert.match(action, /if \(agent && !agent\.deleted_at && agent\.phone_verified_at\)/);
  assert.match(action, /redirect\('\/compte\/agent\?motdepasse=change'\)/);
  assert.match(read('app/compte/agent/page.js'), /params\?\.motdepasse === 'change'/);
});

// --- frictions ------------------------------------------------------------------

test('refused sign-up and sign-in return what was typed, never the password', () => {
  for (const file of [SIGNUP, LOGIN]) {
    const src = read(file);
    assert.match(src, /\(_prevState, formData\)/, file);
    const refuse = src.slice(src.indexOf('function refuse'), src.indexOf('function refuse') + 500);
    assert.doesNotMatch(refuse, /password/, file);
    assert.doesNotMatch(src, /redirect\(`\/compte\/agent\/(inscription|connexion)\?error=/, file);
  }
  const signup = read('app/(site)/compte/agent/inscription/AgentSignupForm.js');
  assert.match(signup, /useActionState\(action, null\)/);
  assert.match(signup, /value=\{contactName\}/);
  assert.match(signup, /defaultValue=\{values \? values\.phone : ''\}/);
  const login = read('app/(site)/compte/agent/connexion/AgentLoginForm.js');
  assert.match(login, /const phoneValue = values \? values\.phone : defaultPhone;/);
});

test('both agent forms have the show/hide eye; sign-in remembers the number; "locked" links the reset', () => {
  assert.match(read('app/(site)/compte/agent/inscription/AgentSignupForm.js'), /<PasswordInput/);
  const login = read('app/(site)/compte/agent/connexion/AgentLoginForm.js');
  assert.match(login, /<PasswordInput/);
  assert.match(login, /error === 'locked' \?/);
  assert.match(read(LOGIN), /await rememberAgentPhone\(phone\);/);
  assert.match(read('app/(site)/compte/agent/connexion/page.js'), /getRememberedAgentPhone\(\)/);
  assert.match(read('lib/agentSession.js'), /const REMEMBERED_AGENT_PHONE_COOKIE = 'lukka_agent_phone';/);
});

test('an agent session is renewed once it is a week old, keeping its token version', () => {
  const fresh = createAgentSessionToken({ agentId: 5, tokenVersion: 1 });
  assert.equal(renewedAgentSessionToken(fresh), null);
  const weekOld = createAgentSessionToken({ agentId: 5, tokenVersion: 1, ttlMs: AGENT_RENEW_WHEN_LEFT_MS - 1000 });
  const renewed = renewedAgentSessionToken(weekOld);
  assert.deepEqual(verifyAgentSessionToken(renewed), { agentId: 5, tokenVersion: 1 });
  assert.equal(renewedAgentSessionToken('5.1.1.bad'), null);
  assert.match(read('middleware.js'), /request\.cookies\.get\(IMPERSONATION_COOKIE\) \? null : renewedAgentSessionToken\(token\)/);
});

test('the agent sign-in page has no French outside the dictionary', () => {
  const src = read('app/(site)/compte/agent/connexion/page.js');
  for (const phrase of ['Pas encore de compte agent', "title: 'Connexion agent"]) assert.ok(!src.includes(phrase), phrase);
});
