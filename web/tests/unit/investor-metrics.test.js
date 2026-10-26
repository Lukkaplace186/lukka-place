import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACQUISITION_SQL,
  AGENT_REPEAT_SQL,
  CLOSES_SQL,
  DEMAND_TOTALS_SQL,
  FUNNEL_SQL,
  LIQUIDITY_SQL,
  MIN_SAMPLE,
  RESPONSE_SQL,
  SEARCHES_BY_MONTH_SQL,
  SNAPSHOT_SQL,
  SUPPLY_BY_MONTH_SQL,
  TIME_TO_LEAD_SQL,
  UNMET_DEMAND_SQL,
  VISITOR_RETURN_SQL,
  getDemand,
  getFunnelByMonth,
  getResponsiveness,
  daysSince,
  monthsSince,
  ratio,
  sampled,
  TRACKING_STARTS_SQL,
} from '@/lib/investorMetrics';
import { peopleSql } from '@/lib/analytics';
import { NOT_TEST_LISTING_SQL } from '@/lib/marketExclusions';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { SECTION_PERMISSIONS } from '@/lib/adminRoles';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

/**
 * /admin/investisseurs. A data room discounts any figure that mixes in the
 * team, bots or a test agency, or that turns "not measured" into 0 — so both
 * are asserted on the SQL text and on the mapping.
 */

const has = (sql, fragment) => normalizeSql(sql).includes(normalizeSql(fragment));

test('every event-table read counts people only', () => {
  for (const [name, sql, aliases] of [
    ['funnel', FUNNEL_SQL, ['v', 'w', 'e']],
    ['searches by month', SEARCHES_BY_MONTH_SQL, ['x']],
    ['liquidity', LIQUIDITY_SQL, ['w', 'e']],
    ['time to lead', TIME_TO_LEAD_SQL, ['w', 'e']],
    ['demand totals', DEMAND_TOTALS_SQL, ['s']],
    ['unmet demand', UNMET_DEMAND_SQL, ['s']],
    ['returning visitors', VISITOR_RETURN_SQL, ['v']],
    ['acquisition', ACQUISITION_SQL, ['v', 'w']],
  ]) {
    for (const alias of aliases) assert.ok(has(sql, peopleSql(alias)), `${name}: people filter on ${alias}`);
  }
});

test('every listing read leaves test agencies out, and live means public', () => {
  for (const [name, sql] of [
    ['funnel closes', FUNNEL_SQL], ['supply', SUPPLY_BY_MONTH_SQL], ['snapshot', SNAPSHOT_SQL],
    ['liquidity', LIQUIDITY_SQL], ['time to lead', TIME_TO_LEAD_SQL], ['closes', CLOSES_SQL], ['agent repeat', AGENT_REPEAT_SQL],
  ]) {
    assert.ok(has(sql, NOT_TEST_LISTING_SQL), `${name}: test listings excluded`);
  }
  assert.match(normalizeSql(SNAPSHOT_SQL), /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(normalizeSql(RESPONSE_SQL), /is_test/);
  // Closes read approve_status only: a sold listing is status = 0.
  assert.ok(!/p\.status = 1/.test(normalizeSql(CLOSES_SQL)));
});

test('a median needs MIN_SAMPLE values; a rate needs a denominator', () => {
  assert.equal(MIN_SAMPLE, 5);
  assert.equal(sampled(12.5, 4), null);
  assert.equal(sampled('12.5', 5), 12.5);
  assert.equal(sampled(null, 50), null);
  assert.equal(ratio(3, 0), null);
  assert.equal(ratio(3, 12), 0.25);
});

test('the funnel keeps "not measured" apart from zero', async () => {
  reset();
  enqueue([
    { month: '2026-08', page_views: 10, listing_views: 4, visitors: null, whatsapp: 1, calls: 0, visit_requests: 0, rollup_days: 0, closes: 0 },
    { month: '2026-10', page_views: 90, listing_views: 40, visitors: 30, whatsapp: 9, calls: 2, visit_requests: 0, rollup_days: 26, closes: 1 },
  ]);
  const err = Object.assign(new Error('relation "search_events" does not exist'), { code: '42P01' });
  const original = calls.push;
  let n = 0;
  calls.push = function push(entry) {
    n += 1;
    const out = original.call(this, entry);
    if (n === 2) throw err;
    return out;
  };
  try {
    const rows = await getFunnelByMonth(2);
    assert.equal(rows[0].visitRequests, null, 'no rollup day → unknown, not 0');
    assert.equal(rows[1].visitRequests, 0, 'a rolled-up month with no request is a real 0');
    assert.equal(rows[0].visitors, null);
    assert.equal(rows[0].searches, null, 'no search_events table → unknown');
  } finally {
    calls.push = original;
  }
});

test('a missing table makes a section unavailable, never zero', async () => {
  reset();
  const err = Object.assign(new Error('missing'), { code: '42P01' });
  const original = calls.push;
  calls.push = function push() {
    throw err;
  };
  try {
    assert.equal(await getDemand(), null);
    assert.equal(await getResponsiveness(), null);
  } finally {
    calls.push = original;
  }
});

test('a budget median is only given per purpose and from enough budgets', async () => {
  reset();
  enqueue([{ searches: 40, zero_results: 10, searchers: 20, zero_searchers: 6 }]);
  enqueue([
    { commune: 'Gombe', purpose: 'rent', property_type: 'appartement', searches: 6, searchers: 5, budgets: 5, median_budget: 800 },
    { commune: 'Gombe', purpose: 'rent', property_type: null, searches: 3, searchers: 3, budgets: 2, median_budget: 500 },
    { commune: null, purpose: null, property_type: null, searches: 9, searchers: 4, budgets: 9, median_budget: 9000 },
  ]);
  const demand = await getDemand({ days: 90 });
  assert.equal(demand.zeroShare, 0.25);
  assert.deepEqual(demand.unmet.map((r) => r.medianBudget), [800, null, null]);
  assert.deepEqual(calls[1].values, [90, 10, null]);
});

test('the page is in the console nav, behind market.view, and exports through the audited route', () => {
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/investisseurs'));
  assert.equal(SECTION_PERMISSIONS['/admin/investisseurs'], 'market.view');
  const route = readFileSync(new URL('../../app/admin/export/[dataset]/route.js', import.meta.url), 'utf8');
  assert.match(route, /investors: \{\s*permission: 'data\.export'/);
  const sidebar = readFileSync(new URL('../../app/admin/AdminSidebar.js', import.meta.url), 'utf8');
  assert.match(sidebar, /const ICONS = \{[^}]*Presentation/);
});

test('every window starts at launch: pre-launch testing is never counted', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  assert.equal(monthsSince('2026-10-03T08:00:00Z', now), 1);
  assert.equal(monthsSince('2025-12-31T23:00:00Z', now), 11);
  assert.equal(monthsSince('2024-01-01T00:00:00Z', now), 12, 'capped at a year');
  assert.equal(monthsSince(null, now), 12);
  assert.equal(daysSince('2026-10-03T12:00:00Z', 90, now), 23);
  assert.equal(daysSince('2026-01-01T00:00:00Z', 90, now), 90);
  // Monthly figures start at the launch instant, not the 1st of its month.
  for (const sql of [FUNNEL_SQL, SEARCHES_BY_MONTH_SQL, VISITOR_RETURN_SQL]) {
    assert.match(normalizeSql(sql), /\$2::timestamptz IS NULL OR [a-z]\.created_at >= \$2::timestamptz/);
  }
  assert.match(normalizeSql(TRACKING_STARTS_SQL), /min\(p\.created_at\) FROM properties p WHERE NOT EXISTS/);
});

test('traffic referred by localhost (local testing on production data) is not people', () => {
  assert.match(peopleSql('v'), /COALESCE\(v\.source, ''\) <> 'localhost'/);
});
