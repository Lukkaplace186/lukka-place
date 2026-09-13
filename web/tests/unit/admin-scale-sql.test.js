import test from 'node:test';
import assert from 'node:assert/strict';
import * as agents from '@/lib/agents';
import * as customers from '@/lib/customers';
import * as marketStats from '@/lib/marketStats';
import * as leadRouting from '@/lib/adminLeadRouting';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * SQL-shape tests for the admin console's scale work. Same reasoning as
 * listings-sql.test.js: a row comparison against a 10-agent fixture passes just
 * as happily with the LIMIT deleted, so these assert on what the queries SAY.
 */

const PUBLIC_GATE = 'p.status = 1 AND p.approve_status = 1';

test.beforeEach(() => reset());

test('listAgentsForAdmin reads one page, never the whole table', async () => {
  enqueue([{ total: 30000 }]);
  enqueue([]);
  enqueue([{ total: 30000, verified: 1, active: 2 }]);
  const result = await agents.listAgentsForAdmin({ q: 'gombe', limit: 50, offset: 100 });
  const page = calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
  assert.match(page.sql, /LIMIT \$\d+ OFFSET \$\d+$/);
  assert.deepEqual(page.values.slice(-2), [50, 100]);
  assert.equal(result.total, 30000);
});

test('listAgentsForAdmin clamps the page size and ignores an unknown sort', async () => {
  await agents.listAgentsForAdmin({ limit: 5000, sort: 'a.id; DROP TABLE agents' });
  const page = calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
  assert.equal(page.values.at(-2), 100);
  assert.ok(!page.sql.includes('DROP TABLE'));
});

test('admin agent names never fall back to username (it is the phone number)', async () => {
  enqueue([]);
  await agents.getAgentNamesByIds([3, 3, 'x', 7]);
  assert.ok(!/a\.username\s*(,|\))/.test(calls[0].sql.split('AS display_name')[0]));
  assert.deepEqual(calls[0].values, [[3, 7]]);
});

test('getAgentNamesByIds issues no query for an empty page', async () => {
  const names = await agents.getAgentNamesByIds([]);
  assert.equal(names.size, 0);
  assert.equal(calls.length, 0);
});

test('the agent picker is capped at 20 and applies the routing gate when asked', async () => {
  enqueue([]);
  await agents.searchAgentsForAdmin({ q: 'x', routableOnly: true, limit: 999 });
  assert.equal(calls[0].values.at(-1), 20);
  assert.ok(calls[0].sql.includes('a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS DISTINCT FROM false'));
});

test('a % typed into agent search is escaped, not a wildcard', async () => {
  enqueue([]);
  await agents.searchAgentsForAdmin({ q: '50%' });
  assert.ok(calls[0].values.includes('%50\\%%'));
});

test('bulk status only writes 0 or 1, to an explicit id list', async () => {
  await assert.rejects(() => agents.bulkUpdateAgentStatus([1], 2), /status must be 0 or 1/);
  await agents.bulkUpdateAgentStatus([1, 2, 2], 0);
  assert.match(calls[0].sql, /WHERE id = ANY\(\$2::bigint\[\]\)$/);
  assert.deepEqual(calls[0].values, [0, [1, 2]]);
});

test('the customers page is paginated and treats an expired lockout as active', async () => {
  await customers.adminListCustomersPage({ q: '+44 7932', status: 'active', limit: 25, offset: 50 });
  const page = calls.find((c) => /ORDER BY c\.created_at DESC/.test(c.sql));
  assert.match(page.sql, /LIMIT \$\d+ OFFSET \$\d+$/);
  assert.ok(page.sql.includes('(c.locked_until IS NOT NULL AND c.locked_until > NOW()) AS is_locked'));
  assert.ok(page.values.includes('%447932%'), 'separators are stripped before matching stored digits');
});

test('every published-price query applies the public gate and excludes unpriced listings', () => {
  for (const sql of [marketStats.PRICE_BY_COMMUNE_SQL, marketStats.PRICE_OVERALL_SQL, marketStats.PRICE_HISTOGRAM_SQL]) {
    assert.ok(sql.includes(PUBLIC_GATE), 'a pending or sold listing is not on the market');
    assert.ok(sql.includes('p.price > 0'), '"prix sur demande" must not average in as $0');
    assert.ok(sql.includes("p.price_period = 'an' THEN p.price / 12.0"), 'yearly rent is normalised like lib/format.js');
  }
  assert.ok(marketStats.PURPOSE_COUNTS_SQL.includes(PUBLIC_GATE));
});

test('histogram buckets map width_bucket indexes back onto their edges', async () => {
  enqueue([]);
  enqueue([{ listings: 3, avg_price: 500, median_price: 450 }]);
  enqueue([{ bucket: 1, listings: 2 }, { bucket: 10, listings: 1 }]);
  enqueue([{ purpose: 'rent', listings: 4, unpriced: 1 }]);
  const stats = await marketStats.getPublishedPriceStats({ purpose: 'rent' });
  assert.deepEqual(stats.buckets[0], { from: 0, to: 200, listings: 2 });
  assert.deepEqual(stats.buckets.at(-1), { from: 5000, to: null, listings: 1 });
  assert.equal(stats.purposes.rent.unpriced, 1);
});

test('the tap log is a page with a stable order', async () => {
  await leadRouting.getLeadClicksPage({ limit: 25, offset: 25 });
  const page = calls.find((c) => c.sql.includes('LIMIT $1 OFFSET $2'));
  assert.ok(page.sql.includes('ORDER BY wc.created_at DESC, wc.id DESC'));
  assert.deepEqual(page.values, [25, 25]);
});
