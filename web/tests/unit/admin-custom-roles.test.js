import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_ROLES, NON_DELEGABLE_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, can, cleanCustomPermissions,
  customRoleId, customRoleKey, homeFor, normalizeRoleKeys, resolvePermissions, salesRepOnly,
} from '@/lib/adminRoles';
import { parseDashboardTab } from '@/lib/adminDashboardTabs';

/**
 * Combined and custom console roles (2026-11-26). These pin the rules that
 * keep them safe: permissions add up and never exceed what the roles grant,
 * `team.manage` stays with owner, and a single built-in role behaves exactly
 * as it did before.
 */

test('a single built-in role resolves to exactly its PERMISSIONS row', () => {
  for (const role of ADMIN_ROLES) {
    const resolved = resolvePermissions([role]);
    for (const permission of Object.keys(PERMISSIONS)) {
      assert.equal(resolved.includes(permission), can(role, permission), `${role} ${permission}`);
      assert.equal(can({ permissions: resolved }, permission), can(role, permission), `${role} ${permission}`);
    }
  }
});

test('combined roles add up, and grant nothing neither role has', () => {
  const both = { permissions: resolvePermissions(['moderator', 'finance']) };
  assert.equal(can(both, 'listings.moderate'), true); // moderator
  assert.equal(can(both, 'billing.manage'), true); // finance
  assert.equal(can(both, 'team.manage'), false);
  assert.equal(can(both, 'agents.delete'), false);
  assert.equal(can(['moderator', 'finance'], 'billing.manage'), true);
});

test('a custom role grants its own list, minus team.manage and unknown keys', () => {
  const custom = { id: 7, permissions: ['blog.manage', 'team.manage', 'made.up', 'data.export'] };
  const resolved = resolvePermissions([customRoleKey(7)], [custom]);
  assert.deepEqual(resolved.sort(), ['blog.manage', 'data.export'].sort());
  assert.deepEqual(cleanCustomPermissions(['team.manage']), []);
  for (const permission of NON_DELEGABLE_PERMISSIONS) assert.equal(can({ permissions: resolved }, permission), false);
});

test('a custom key whose role was not found grants nothing', () => {
  assert.deepEqual(resolvePermissions([customRoleKey(99)], []), []);
});

test('role keys are cleaned: unknown dropped, built-ins first, owner alone', () => {
  assert.deepEqual(normalizeRoleKeys(['custom:3', 'finance', 'nope', 'moderator', 'finance', 'custom:1']), ['moderator', 'finance', 'custom:1', 'custom:3']);
  assert.deepEqual(normalizeRoleKeys(['support', 'owner', 'custom:2']), ['owner']);
  assert.deepEqual(normalizeRoleKeys('analyst'), ['analyst']);
  assert.deepEqual(normalizeRoleKeys(['custom:0', 'custom:-1', 'custom:abc']), []);
  assert.equal(customRoleId('custom:12'), 12);
  assert.equal(customRoleId('owner'), null);
});

test('every delegable permission is offered exactly once on /admin/team', () => {
  const offered = PERMISSION_GROUPS.flatMap((group) => group.permissions);
  assert.equal(new Set(offered).size, offered.length, 'no duplicates');
  const expected = Object.keys(PERMISSIONS).filter((p) => !NON_DELEGABLE_PERMISSIONS.includes(p));
  assert.deepEqual([...offered].sort(), expected.sort());
});

test('Commercial alone is a field rep; combined with a wider role it is not', () => {
  assert.equal(salesRepOnly('sales'), true);
  assert.equal(salesRepOnly({ roles: ['sales'], permissions: resolvePermissions(['sales']) }), true);
  assert.equal(salesRepOnly({ roles: ['moderator', 'sales'], permissions: resolvePermissions(['moderator', 'sales']) }), false);
  assert.equal(salesRepOnly({ roles: ['finance'], permissions: resolvePermissions(['finance']) }), false);
  // A custom role that adds only what the rep already has keeps the limit.
  const narrow = { id: 1, permissions: ['listings.view'] };
  assert.equal(salesRepOnly({ roles: ['sales', 'custom:1'], permissions: resolvePermissions(['sales', 'custom:1'], [narrow]) }), true);
  const wide = { id: 2, permissions: ['data.export'] };
  assert.equal(salesRepOnly({ roles: ['sales', 'custom:2'], permissions: resolvePermissions(['sales', 'custom:2'], [wide]) }), false);
});

test('a person lands on their primary role home, or the first section they may open', () => {
  assert.equal(homeFor({ roles: ['moderator', 'finance'], permissions: resolvePermissions(['moderator', 'finance']) }), '/admin/listings');
  assert.equal(homeFor({ roles: ['owner'], permissions: Object.keys(PERMISSIONS) }), '/admin/dashboard');
  const blogOnly = { roles: ['custom:5'], permissions: ['blog.manage'] };
  assert.equal(homeFor(blogOnly), '/admin/blog');
});

test('the dashboard opens on the first role with a preferred tab', () => {
  const session = { roles: ['support', 'analyst'], permissions: resolvePermissions(['support', 'analyst']) };
  assert.equal(parseDashboardTab(undefined, session).key, 'demande');
  assert.equal(parseDashboardTab(undefined, 'moderator').key, 'offre');
});
