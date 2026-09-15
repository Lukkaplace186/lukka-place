import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as customers from '@/lib/customers';
import * as searchAlerts from '@/lib/searchAlerts';
import { createCustomerSessionToken } from '@/lib/customerAuth';
import { parseLeadCommunes, MAX_REQUEST_COMMUNES } from '@/lib/leadCommunes';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Espace Client hardening (Phase 0 of the customer account audit).
 */

test.beforeEach(() => reset());

test('a session whose token_version was bumped (logout / password reset) is refused', async () => {
  const token = createCustomerSessionToken({ customerId: 12, tokenVersion: 3 });

  enqueue([{ token_version: 3 }]);
  assert.equal(await customers.resolveCustomerSession(token), 12, 'current version: still signed in');

  enqueue([{ token_version: 4 }]);
  assert.equal(await customers.resolveCustomerSession(token), null, 'bumped version: the old cookie is dead');

  const lookup = calls.at(-1);
  assert.match(lookup.sql, /SELECT token_version FROM customers WHERE id = \$1/);
  assert.deepEqual(lookup.values, [12]);
});

test('a deleted account ends its sessions too', async () => {
  const token = createCustomerSessionToken({ customerId: 99, tokenVersion: 0 });
  enqueue([]);
  assert.equal(await customers.resolveCustomerSession(token), null);
});

test('a forged or missing token never reaches the database', async () => {
  assert.equal(await customers.resolveCustomerSession(undefined), null);
  assert.equal(await customers.resolveCustomerSession('1.0.9999999999999.deadbeef'), null);
  assert.equal(calls.length, 0);
});

test('search alerts only go to verified phone numbers', async () => {
  enqueue([]);
  await searchAlerts.getSavedSearchesDueForAlerts({ newestPublishedAt: new Date() });
  assert.match(calls[0].sql, /c\.phone_verified_at IS NOT NULL/);
});

test('a lead reads every commune it names, and a legacy lead reads its one', () => {
  assert.deepEqual(parseLeadCommunes({ commune: 'Gombe', communes: '["Gombe","Ngaliema"]' }), ['Gombe', 'Ngaliema']);
  assert.deepEqual(parseLeadCommunes({ commune: 'Gombe', communes: null }), ['Gombe']);
  assert.deepEqual(parseLeadCommunes({ commune: 'Gombe', communes: '{broken' }), ['Gombe']);
  assert.deepEqual(parseLeadCommunes({ commune: null, communes: null }), []);
  assert.equal(MAX_REQUEST_COMMUNES, 5, 'must match the engine\'s MAX_LEAD_COMMUNES');
});

test('the request form sends every chosen commune, not only the first', () => {
  const source = readFileSync(path.join(process.cwd(), 'app/(site)/compte/client/actions.js'), 'utf8');
  const submit = source.slice(source.indexOf('export async function submitPropertyRequestAction'));
  const createCall = submit.slice(submit.indexOf('createLead({'), submit.indexOf('});', submit.indexOf('createLead({')));
  assert.match(createCall, /\bcommunes,/);
});

test('the visit form prefills the signed-in account, so the request lands in that account', () => {
  const source = readFileSync(path.join(process.cwd(), 'components/EnquiryCard.js'), 'utf8');
  assert.match(source, /\/api\/account\/me/);
  assert.match(source, /defaultValue: profile\.phoneNational/);
});

test('account API 401s clear the stale logged-in flag', () => {
  for (const file of ['app/api/account/favorites/route.js', 'app/api/account/saved-searches/route.js', 'app/api/account/me/route.js']) {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.ok(!source.includes("{ status: 401 }"), `${file} must use customerUnauthorized()`);
    assert.match(source, /customerUnauthorized\(\)/);
  }
});
