import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createImpersonationToken, impersonationDecision, parseImpersonationToken,
} from '@/lib/impersonationToken';
import { endImpersonation, startImpersonation } from '@/lib/impersonation';
import { ADMIN_ROLES, can, sectionPermission } from '@/lib/adminRoles';
import { calls, enqueue, reset } from '../support/fakePool.js';

process.env.ADMIN_SESSION_SECRET ||= 'unit-test-admin-secret';

test.beforeEach(() => reset());

const NONCE = 'a'.repeat(32);
const NOW = Date.parse('2026-09-16T10:00:00Z');

function token(overrides = {}) {
  return createImpersonationToken({
    sessionId: 7, nonce: NONCE, adminId: 3, adminTokenVersion: 2, targetType: 'agent', targetId: 41, expiresAt: NOW + 60_000,
    ...overrides,
  });
}

test('an impersonation token round-trips and carries the admin token version', () => {
  const parsed = parseImpersonationToken(token(), { now: NOW });
  assert.deepEqual(
    { ...parsed },
    { sessionId: 7, nonce: NONCE, adminId: 3, adminTokenVersion: 2, targetType: 'agent', targetId: 41, expiresAt: NOW + 60_000, expired: false },
  );
});

test('a tampered, expired or foreign token is refused', () => {
  const valid = token();
  const swapped = valid.replace('.agent.41.', '.agent.42.');
  assert.equal(parseImpersonationToken(swapped, { now: NOW }), null, 'changing the target breaks the signature');
  assert.equal(parseImpersonationToken(valid, { now: NOW + 120_000 }), null, 'expired');
  assert.equal(parseImpersonationToken(valid, { now: NOW + 120_000, allowExpired: true }).expired, true, 'the exit route may still read it');

  // Signed with the right secret but WITHOUT the impersonation prefix — i.e.
  // how an admin session token is signed. Must not be accepted as one of these.
  const payload = valid.split('.').slice(0, 8).join('.');
  const foreign = `${payload}.${createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('hex')}`;
  assert.equal(parseImpersonationToken(foreign, { now: NOW }), null);
  assert.equal(parseImpersonationToken('v2.3.2.999999999999999.abc', { now: NOW }), null);
  assert.throws(() => token({ targetType: 'admin' }), /invalid impersonation target/);
});

test('while viewing as someone, every write outside /admin is refused at the edge', () => {
  const valid = token();
  const decide = (method, pathname, t = valid) => impersonationDecision({ method, pathname, token: t, now: NOW });
  assert.equal(decide('GET', '/compte/agent'), 'pass');
  assert.equal(decide('HEAD', '/listings'), 'pass');
  assert.equal(decide('POST', '/compte/agent/biens'), 'block', 'a Server Action is a POST to the page');
  assert.equal(decide('POST', '/api/account/favorites'), 'block');
  assert.equal(decide('DELETE', '/api/account/saved-searches'), 'block');
  assert.equal(decide('POST', '/listings/12'), 'block', 'a visit request from the storefront too');
  assert.equal(decide('POST', '/admin/agents/41'), 'pass', 'the console itself stays writable');
  assert.equal(decide('POST', '/compte/agent', null), 'pass', 'no cookie, no impersonation');
});

test('an expired or forged cookie sends a GET to the exit route and still blocks a write', () => {
  const expired = token({ expiresAt: NOW - 1 });
  assert.equal(impersonationDecision({ method: 'GET', pathname: '/compte', token: expired, now: NOW }), 'exit');
  assert.equal(impersonationDecision({ method: 'POST', pathname: '/compte', token: 'junk', now: NOW }), 'block');
});

test('starting a session needs a real reason before touching the database', async () => {
  const result = await startImpersonation({ adminId: 3, targetType: 'agent', targetId: 41, reason: 'short' });
  assert.equal(result.errorKey, 'admin.impersonation.reasonInvalid');
  assert.equal(calls.length, 0);
  assert.equal((await startImpersonation({ adminId: 3, targetType: 'admin', targetId: 1, reason: 'long enough reason' })).errorKey, 'admin.impersonation.invalidTarget');
});

test('a missing target rolls back; a real one ends the admin\'s previous session and records the reason', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // target lookup — nothing
  const missing = await startImpersonation({ adminId: 3, targetType: 'customer', targetId: 9, reason: 'Customer cannot see favourites' });
  assert.equal(missing.errorKey, 'admin.impersonation.targetMissing');
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));

  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 41, token_version: 5, label: 'NSUMBU Marie' }]);
  enqueue([]); // end previous
  enqueue([{ id: 88 }]); // insert
  enqueue([]); // COMMIT
  const started = await startImpersonation({ adminId: 3, targetType: 'agent', targetId: 41, reason: '  Listing does not show — ticket 123 ', now: NOW });
  assert.equal(started.session.id, 88);
  assert.match(started.session.nonce, /^[0-9a-f]{32}$/);
  assert.equal(started.session.expiresAt, NOW + 60 * 60 * 1000);
  assert.deepEqual(started.target, { id: 41, tokenVersion: 5, label: 'NSUMBU Marie' });
  const replaced = calls.find((c) => c.sql.startsWith('UPDATE console_impersonation_sessions'));
  assert.ok(replaced.sql.includes("end_reason = 'replaced'") && replaced.sql.includes('ended_at IS NULL'));
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO console_impersonation_sessions'));
  assert.equal(insert.values[5], 'Listing does not show — ticket 123');
});

test('ending a session needs its nonce and only ends an open one', async () => {
  await endImpersonation({ sessionId: 88, nonce: NONCE, reason: 'exit' });
  assert.ok(calls[0].sql.includes('s.id = $1 AND s.token_nonce = $2 AND s.ended_at IS NULL'));
});

test('who may view as, and what a sales rep may open', () => {
  for (const role of ADMIN_ROLES) {
    assert.equal(can(role, 'accounts.impersonate'), ['owner', 'support'].includes(role), role);
  }
  assert.equal(can('sales', 'sales.view'), true);
  assert.equal(can('sales', 'sales.manage'), false, 'a rep never approves or pays their own commissions');
  assert.equal(can('sales', 'customers.view'), false);
  assert.equal(can('finance', 'sales.manage'), true);
  assert.equal(sectionPermission('/admin/sales/12'), 'sales.view');
  assert.equal(sectionPermission('/admin/impersonation'), 'audit.view');
});
