import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASHBOARD_TABS,
  TAB_QUEUES,
  dashboardHref,
  parseDashboardTab,
  parseRentBeds,
  visibleDashboardTabs,
} from '@/lib/adminDashboardTabs';
import { can } from '@/lib/adminRoles';

test('every role sees only the tabs its permissions open', () => {
  assert.deepEqual(visibleDashboardTabs('owner').map((t) => t.key), ['apercu', 'demande', 'offre', 'marche']);
  // A field rep has no network-wide market figures (market.view).
  assert.deepEqual(visibleDashboardTabs('sales').map((t) => t.key), ['apercu', 'demande', 'offre']);
  for (const tab of DASHBOARD_TABS) {
    for (const role of ['owner', 'moderator', 'support', 'finance', 'analyst', 'sales']) {
      assert.equal(visibleDashboardTabs(role).includes(tab), can(role, tab.permission));
    }
  }
});

test('?tab= falls back to the role default, never to a tab it cannot open', () => {
  assert.equal(parseDashboardTab('marche', 'owner').key, 'marche');
  assert.equal(parseDashboardTab('marche', 'sales').key, 'offre');
  assert.equal(parseDashboardTab(undefined, 'owner').key, 'apercu');
  assert.equal(parseDashboardTab(undefined, 'moderator').key, 'offre');
  assert.equal(parseDashboardTab('nonsense', 'support').key, 'demande');
  assert.equal(parseDashboardTab(['demande', 'offre'], 'owner').key, 'demande');
});

test('dashboard links keep tab, period and bedrooms, and drop empty ones', () => {
  assert.equal(dashboardHref(), '/admin/dashboard');
  assert.equal(dashboardHref({ tab: 'demande' }), '/admin/dashboard?tab=demande');
  assert.equal(dashboardHref({ tab: 'marche', periode: '7', chambres: 2 }), '/admin/dashboard?tab=marche&periode=7&chambres=2');
  assert.equal(dashboardHref({ tab: 'marche', periode: null, chambres: null }), '/admin/dashboard?tab=marche');
});

test('bedroom filter accepts only the offered values', () => {
  assert.equal(parseRentBeds('2'), 2);
  assert.equal(parseRentBeds('9'), null);
  assert.equal(parseRentBeds(undefined), null);
  assert.equal(parseRentBeds('abc'), null);
});

test('every queue a tab lists is a real work-queue card', () => {
  const source = readFileSync(new URL('../../app/admin/dashboard/WorkQueues.js', import.meta.url), 'utf8');
  for (const keys of Object.values(TAB_QUEUES)) {
    for (const key of keys) assert.match(source, new RegExp(`key: '${key}'`), key);
  }
});

test('the CPW card is never computed: no ad spend exists to divide', () => {
  const source = readFileSync(new URL('../../app/admin/dashboard/KpiHeader.js', import.meta.url), 'utf8');
  assert.match(source, /label=\{k\('cpw'\)\} value="—"/);
});
