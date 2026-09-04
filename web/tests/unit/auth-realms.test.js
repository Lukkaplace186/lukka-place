import test from 'node:test';
import assert from 'node:assert/strict';
import * as agentAuth from '@/lib/agentAuth';
import * as customerAuth from '@/lib/customerAuth';
import * as adminAuth from '@/lib/adminAuth';
import { safeEqualHex, hashToStoredForm, verifyAgainstStoredForm } from '@/lib/authCrypto';

/**
 * The three session realms. Secrets here are the fixed unit-tier values set
 * in tests/support/register.mjs before any of these modules are imported —
 * never the real production secrets.
 */

test('agent session token round-trips and carries the real identity', () => {
  const token = agentAuth.createAgentSessionToken({ agentId: 42, tokenVersion: 3 });
  assert.deepEqual(agentAuth.verifyAgentSessionToken(token), { agentId: 42, tokenVersion: 3 });
  assert.equal(agentAuth.isValidAgentSessionToken(token), true);
});

test('customer session token round-trips', () => {
  const token = customerAuth.createCustomerSessionToken({ customerId: 7, tokenVersion: 1 });
  assert.deepEqual(customerAuth.verifyCustomerSessionToken(token), { customerId: 7, tokenVersion: 1 });
});

test('a tampered payload is rejected — the signature covers id, version and expiry', () => {
  const token = customerAuth.createCustomerSessionToken({ customerId: 7, tokenVersion: 1 });
  const [, version, expiry, sig] = token.split('.');
  const escalated = ['9999', version, expiry, sig].join('.');
  assert.equal(customerAuth.verifyCustomerSessionToken(escalated), null);
});

test('an expired token is rejected', () => {
  const token = customerAuth.createCustomerSessionToken({ customerId: 7, tokenVersion: 1 });
  assert.ok(customerAuth.verifyCustomerSessionToken(token), 'valid before expiry');

  // 30-day TTL — move the clock past it rather than waiting it out.
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 24 * 60 * 60 * 1000;
  try {
    assert.equal(customerAuth.verifyCustomerSessionToken(token), null);
  } finally {
    Date.now = realNow;
  }
});

test('a malformed token is rejected, never thrown on', () => {
  for (const bad of [null, undefined, '', 'x', 'a.b.c', 'a.b.c.d.e', 'zz.zz.zz.zz']) {
    assert.equal(customerAuth.verifyCustomerSessionToken(bad), null, `should reject ${JSON.stringify(bad)}`);
    assert.equal(agentAuth.verifyAgentSessionToken(bad), null);
  }
});

/**
 * The agent and customer token formats are byte-identical (four dot-separated
 * parts, same HMAC construction — agentAuth.js:55, customerAuth.js:58). The
 * ONLY thing separating the two realms is the secret. If a deploy ever set
 * both env vars to the same value, customer #7's cookie would authenticate as
 * agent #7 — a full privilege escalation with no code change.
 */
test('agent and customer realms are cryptographically separated', () => {
  assert.notEqual(
    process.env.AGENT_SESSION_SECRET,
    process.env.CUSTOMER_SESSION_SECRET,
    'AGENT_SESSION_SECRET and CUSTOMER_SESSION_SECRET must never be equal',
  );

  const customerToken = customerAuth.createCustomerSessionToken({ customerId: 7, tokenVersion: 0 });
  assert.equal(
    agentAuth.verifyAgentSessionToken(customerToken),
    null,
    'a customer cookie must not authenticate against the agent realm',
  );

  const agentToken = agentAuth.createAgentSessionToken({ agentId: 7, tokenVersion: 0 });
  assert.equal(
    customerAuth.verifyCustomerSessionToken(agentToken),
    null,
    'an agent cookie must not authenticate against the customer realm',
  );
});

test('cookie names are distinct per realm', () => {
  const names = [
    adminAuth.ADMIN_SESSION_COOKIE,
    agentAuth.AGENT_SESSION_COOKIE,
    customerAuth.CUSTOMER_SESSION_COOKIE,
  ];
  assert.equal(new Set(names).size, 3, `cookie names collide: ${names.join(', ')}`);
});

test('safeEqualHex handles non-hex input without throwing', () => {
  // Buffer.from('zz', 'hex') yields a zero-length buffer; the length guard
  // must return false before timingSafeEqual can throw on a length mismatch.
  assert.equal(safeEqualHex('zz', 'aabb'), false);
  assert.equal(safeEqualHex('', ''), true);
  assert.equal(safeEqualHex('aabb', 'aabb'), true);
  assert.equal(safeEqualHex('aabb', 'aabc'), false);
});

test('password hashing round-trips and rejects a wrong password', () => {
  const stored = hashToStoredForm('correct horse battery staple');
  assert.equal(verifyAgainstStoredForm('correct horse battery staple', stored), true);
  assert.equal(verifyAgainstStoredForm('wrong', stored), false);
  assert.equal(verifyAgainstStoredForm('anything', 'not-a-stored-form'), false);
  assert.equal(verifyAgainstStoredForm('anything', null), false);
});

test('a per-row salt means two identical passwords hash differently', () => {
  assert.notEqual(hashToStoredForm('same'), hashToStoredForm('same'));
});
