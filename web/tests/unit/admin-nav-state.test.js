import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_NAV_GROUPS } from '@/lib/adminNav';
import {
  BADGE_FOR, DEFAULT_OPEN_GROUP, PINNED_HREF, URGENT_COUNTS, badgeTone, badgeValue, initialOpenGroups,
  isActiveHref, parseStoredOpenGroups, toggleOpenGroup, urgentTotal,
} from '@/lib/adminNavState';

const OPS = 'admin.nav.groups.operations';
const NETWORK = 'admin.nav.groups.network';
const SYSTEM = 'admin.nav.groups.system';

test('every badged href and the pinned href are real sidebar sections', () => {
  const hrefs = new Set(ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)));
  for (const href of [...Object.keys(BADGE_FOR), PINNED_HREF]) assert.ok(hrefs.has(href), href);
  assert.ok(ADMIN_NAV_GROUPS.some((group) => group.labelKey === DEFAULT_OPEN_GROUP));
});

test('every badge count is one the work-queue endpoint really returns', () => {
  const source = readFileSync(new URL('../../lib/adminWorkQueues.js', import.meta.url), 'utf8');
  for (const key of Object.values(BADGE_FOR)) assert.match(source, new RegExp(`\\b${key}\\b`), key);
});

test('opens Opérations by default and always the current page’s group', () => {
  assert.deepEqual(initialOpenGroups(ADMIN_NAV_GROUPS, '/admin/listings', null), [OPS]);
  assert.deepEqual(initialOpenGroups(ADMIN_NAV_GROUPS, '/admin/agents/42', null), [OPS, NETWORK]);
  // A stored choice wins over the default, but the current page's group still opens.
  assert.deepEqual(initialOpenGroups(ADMIN_NAV_GROUPS, '/admin/health', [NETWORK]), [NETWORK, SYSTEM]);
  assert.deepEqual(initialOpenGroups(ADMIN_NAV_GROUPS, '/admin/agents', []), [NETWORK]);
  // A stored group that no longer exists is dropped.
  assert.deepEqual(initialOpenGroups(ADMIN_NAV_GROUPS, '/admin/listings', ['admin.nav.groups.gone', OPS]), [OPS]);
});

test('a prefix is not a match: /admin/sales does not light up /admin/sale', () => {
  assert.equal(isActiveHref('/admin/agents/12', '/admin/agents'), true);
  assert.equal(isActiveHref('/admin/agent-reviews', '/admin/agents'), false);
  assert.equal(isActiveHref(null, '/admin/agents'), false);
});

test('stored choices are read defensively', () => {
  assert.deepEqual(parseStoredOpenGroups('["a","b"]'), ['a', 'b']);
  assert.equal(parseStoredOpenGroups('not json'), null);
  assert.equal(parseStoredOpenGroups('{"a":1}'), null);
  assert.equal(parseStoredOpenGroups(null), null);
  assert.deepEqual(parseStoredOpenGroups('["a",3,null]'), ['a']);
});

test('toggling adds and removes one group', () => {
  assert.deepEqual(toggleOpenGroup([OPS], NETWORK), [OPS, NETWORK]);
  assert.deepEqual(toggleOpenGroup([OPS, NETWORK], OPS), [NETWORK]);
});

test('red only when someone is waiting; a folded group sums only red counts', () => {
  assert.equal(badgeTone('/admin/listings'), 'urgent');
  assert.equal(badgeTone('/admin/agents'), 'quiet');
  assert.equal(badgeTone('/admin/subscriptions'), 'quiet');
  assert.ok(URGENT_COUNTS.has('escalatedViewings'));
  const counts = { pendingListings: 2, escalatedViewings: '3', humanConversations: null, unverifiedAgents: 20, projectsToReview: 5 };
  const ops = ADMIN_NAV_GROUPS.find((group) => group.labelKey === OPS).items;
  const network = ADMIN_NAV_GROUPS.find((group) => group.labelKey === NETWORK).items;
  assert.equal(urgentTotal(ops, counts), 5);
  assert.equal(urgentTotal(network, counts), 0);
  assert.equal(urgentTotal(ops, null), 0);
});

test('a count that is not a positive number shows no badge', () => {
  assert.equal(badgeValue({ pendingListings: '—' }, '/admin/listings'), 0);
  assert.equal(badgeValue({ pendingListings: -1 }, '/admin/listings'), 0);
  assert.equal(badgeValue({ pendingListings: 4 }, '/admin/listings'), 4);
  assert.equal(badgeValue({ pendingListings: 4 }, '/admin/team'), 0);
});
