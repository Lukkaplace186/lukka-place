import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOGIN_OUTCOMES, deviceLabel, loginSummaryFromRows } from '@/lib/agentLoginRules';

const at = (h) => new Date(`2026-10-24T${String(h).padStart(2, '0')}:00:00Z`);

test('failures are counted since the last sign-in only', () => {
  const rows = [
    { outcome: 'wrong_password', attempted_at: at(9) },
    { outcome: 'wrong_password', attempted_at: at(8) },
    { outcome: 'success', attempted_at: at(7) },
    { outcome: 'wrong_password', attempted_at: at(6) },
  ];
  const s = loginSummaryFromRows(rows, at(7));
  assert.equal(s.failuresSinceSignIn, 2);
  assert.equal(s.lastFailureAt.getTime(), at(9).getTime());
  assert.equal(s.lastOutcome, 'wrong_password');
  assert.equal(s.pendingVerification, false);
});

test('a right password on an unverified number reads as pending verification', () => {
  const s = loginSummaryFromRows([{ outcome: 'verify_required', attempted_at: at(7) }], null);
  assert.equal(s.pendingVerification, true);
  assert.equal(s.failuresSinceSignIn, 0);
});

test('no attempt on record is null, never a made-up time', () => {
  assert.equal(loginSummaryFromRows([], null), null);
});

test('outcomes match the migration CHECK', () => {
  const sql = readFileSync(new URL('../../../migrations/20261024_agent_login_attempts.sql', import.meta.url), 'utf8');
  for (const outcome of LOGIN_OUTCOMES) assert.match(sql, new RegExp(`'${outcome}'`), outcome);
});

test('every sign-in path records its attempt', () => {
  const read = (p) => readFileSync(new URL(`../../app/(site)/compte/${p}`, import.meta.url), 'utf8');
  const login = read('agent/connexion/actions.js');
  for (const outcome of ['locked', 'wrong_password', 'success', 'verify_required']) assert.match(login, new RegExp(`'${outcome}'`));
  assert.match(read('agent/inscription/verifier/actions.js'), /'code_verified'/);
  assert.match(read('agent/inscription/verifier/actions.js'), /'wrong_code'/);
  assert.match(read('agent/activer/actions.js'), /'activated'/);
  assert.match(read('whatsappVerifyActions.js'), /'whatsapp_verified'/);
});

test('device labels are short and never the raw user agent', () => {
  assert.equal(deviceLabel('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36'), 'Chrome · Android');
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari · iPhone');
  assert.equal(deviceLabel(''), null);
});
