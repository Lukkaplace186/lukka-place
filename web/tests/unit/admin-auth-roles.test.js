import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, isValidSessionToken, parseSessionToken } from '@/lib/adminAuth';
import { ADMIN_ROLES, PERMISSIONS, can, sectionPermission } from '@/lib/adminRoles';

/**
 * Session tokens now name the console account they belong to, and roles gate
 * every section and action. These pin the parts that must not drift.
 */

test('a shared-password token parses as account 0', () => {
  const parsed = parseSessionToken(createSessionToken());
  assert.equal(parsed.adminId, 0);
  assert.equal(parsed.legacy, false);
});

test('an account token carries its id and token version', () => {
  const parsed = parseSessionToken(createSessionToken({ adminId: 42, tokenVersion: 7 }));
  assert.equal(parsed.adminId, 42);
  assert.equal(parsed.tokenVersion, 7);
});

test('changing the account id inside a signed token invalidates it', () => {
  const token = createSessionToken({ adminId: 5, tokenVersion: 1 });
  const forged = token.replace(/^v2\.5\./, 'v2.1.');
  assert.equal(isValidSessionToken(forged), false);
});

test('an expired token is refused', () => {
  const token = createSessionToken({ adminId: 3 });
  const realNow = Date.now;
  Date.now = () => realNow() + 13 * 60 * 60 * 1000;
  try {
    assert.equal(isValidSessionToken(token), false);
  } finally {
    Date.now = realNow;
  }
});

test('garbage is refused rather than throwing', () => {
  for (const value of [undefined, '', 'x', 'v2.a.b.c.d', 'v2.1.1.1', '123.abc']) {
    assert.equal(isValidSessionToken(value), false);
  }
});

test('owner can do everything; an unknown permission is refused for everyone', () => {
  for (const permission of Object.keys(PERMISSIONS)) assert.equal(can('owner', permission), true, permission);
  for (const role of ADMIN_ROLES) assert.equal(can(role, 'made.up'), false);
});

test('only owners manage the team and read the audit log', () => {
  for (const role of ADMIN_ROLES.filter((r) => r !== 'owner')) {
    assert.equal(can(role, 'team.manage'), false, role);
    assert.equal(can(role, 'audit.view'), false, role);
  }
});

test('an analyst reads but cannot moderate, bill or message', () => {
  assert.equal(can('analyst', 'listings.view'), true);
  assert.equal(can('analyst', 'listings.moderate'), false);
  assert.equal(can('analyst', 'billing.manage'), false);
  assert.equal(can('analyst', 'conversations.reply'), false);
});

test('a section inherits its prefix permission, longest prefix first', () => {
  assert.equal(sectionPermission('/admin/agents/12'), 'agents.view');
  assert.equal(sectionPermission('/admin/agencies/3'), 'agents.view');
  assert.equal(sectionPermission('/admin/team'), 'team.manage');
  assert.equal(sectionPermission('/admin/export/agents'), 'data.export');
  assert.equal(sectionPermission('/admin/somewhere-new'), null);
});
