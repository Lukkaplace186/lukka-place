import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_WHERE, listModerationQueue } from '@/lib/moderationQueue';
import { adminPasswordProblem, updateAdminUser } from '@/lib/adminUsers';
import { listAuditLog, recordAudit } from '@/lib/adminAudit';
import { listMembershipsForAdmin, searchFeaturableListings } from '@/lib/adminBilling';
import { calls, enqueue, reset } from '../support/fakePool.js';

test.beforeEach(() => reset());

function pageCall() {
  return calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
}

test('each moderation tab reads its own gate, and approved excludes suspended', async () => {
  assert.equal(STATUS_WHERE.approved, 'p.approve_status = 1 AND p.status = 1');
  assert.equal(STATUS_WHERE.suspended, 'p.approve_status = 1 AND p.status = 0');
  for (const status of ['pending', 'approved', 'rejected', 'suspended']) {
    reset();
    await listModerationQueue({ status });
    assert.ok(pageCall().sql.includes(STATUS_WHERE[status]), status);
  }
});

test('an unknown status falls back to pending, never to every listing', async () => {
  await listModerationQueue({ status: 'everything' });
  assert.ok(pageCall().sql.includes('p.approve_status = 0'));
});

test('pending defaults to oldest first; an injected sort is ignored', async () => {
  await listModerationQueue({ status: 'pending', sort: 'id; DROP TABLE properties' });
  assert.ok(pageCall().sql.includes('ORDER BY f.created_at ASC, f.id ASC'));
  assert.ok(!pageCall().sql.includes('DROP'));
});

test('a flag filter is applied in SQL and the page size is clamped', async () => {
  await listModerationQueue({ status: 'pending', flag: 'duplicate_photo', limit: 5000 });
  assert.ok(pageCall().sql.includes('WHERE f.f_duplicate_photo'));
  assert.equal(pageCall().values.at(-2), 100);
});

test('admin passwords must be long and confirmed', () => {
  assert.equal(adminPasswordProblem('short'), 'admin.team.passwordTooShort');
  assert.equal(adminPasswordProblem('long-enough-pass', 'different-pass!'), 'admin.team.passwordMismatch');
  assert.equal(adminPasswordProblem('long-enough-pass', 'long-enough-pass'), null);
});

test('the last active owner cannot be demoted', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 1, role: 'owner', status: 'active', password_hash: 'x' }]); // SELECT … FOR UPDATE
  enqueue([{ n: 1 }]); // countActiveOwners
  const result = await updateAdminUser(1, { role: 'analyst' });
  assert.equal(result.errorKey, 'admin.team.lastOwner');
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.sql.startsWith('UPDATE console_admin_users')));
});

test('an action under the shared password is audited as such, never anonymously', async () => {
  await recordAudit({ id: null, shared: true }, { action: 'listing.approve', entityType: 'listing', entityId: 7 });
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO console_admin_audit_log'));
  assert.equal(insert.values[0], null);
  assert.equal(insert.values[1], 'shared-password');
  assert.equal(insert.values[4], '7');
});

test('audit action filters are prefix matches with wildcards escaped', async () => {
  await listAuditLog({ action: 'listing_%.' });
  assert.ok(calls[0].values.includes('listing\\_\\%.%'));
});

test('memberships and featurable listings are bounded queries', async () => {
  await listMembershipsForAdmin({ view: 'expiring', limit: 999 });
  assert.equal(pageCall().values.at(-2), 100);
  reset();
  await searchFeaturableListings({ q: '51' });
  assert.ok(calls[0].sql.includes('p.status = 1 AND p.approve_status = 1'), 'only public listings may be featured');
  assert.equal(calls[0].values[1], 51);
});
