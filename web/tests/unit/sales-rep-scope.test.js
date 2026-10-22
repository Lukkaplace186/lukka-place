import test from 'node:test';
import assert from 'node:assert/strict';
import * as agents from '@/lib/agents';
import * as agencies from '@/lib/adminAgencies';
import * as leadRouting from '@/lib/adminLeadRouting';
import { repAgentCondition } from '@/lib/salesScopeSql';
import { scopeAgentPerformance } from '@/lib/agentPerformanceScope';
import { can, sectionPermission } from '@/lib/adminRoles';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * A `sales` console account sees only the agents its rep brought in
 * (lib/salesScope.js), 2026-10-21. These pin what the queries SAY, for the
 * same reason as admin-scale-sql.test.js: a fixture with only the rep's own
 * agents passes just as happily with the scope deleted.
 */

test.beforeEach(() => reset());

test('the scope is an active assignment or the launch attribution, nothing else', () => {
  const sql = repAgentCondition('a.id', '$1');
  assert.match(sql, /sales_account_assignments rsa\s+WHERE rsa\.agent_id = a\.id AND rsa\.rep_id = \$1 AND rsa\.ended_at IS NULL/);
  assert.match(sql, /sales_agent_attributions rat\s+WHERE rat\.agent_id = a\.id AND rat\.rep_id = \$1/);
});

test('listAgentsForAdmin with a rep scopes the page, the count AND the summary', async () => {
  enqueue([{ total: 2 }]);
  enqueue([]);
  enqueue([{ total: 2, verified: 1, active: 2 }]);
  await agents.listAgentsForAdmin({ q: 'gombe', repId: 7 });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.ok(call.sql.includes('rsa.rep_id = $1'), call.sql);
    assert.equal(call.values[0], 7);
  }
});

test('listAgentsForAdmin without a rep is unscoped (every other role)', async () => {
  await agents.listAgentsForAdmin({});
  assert.ok(calls.every((call) => !call.sql.includes('sales_account_assignments')));
});

test('a sales account with no rep linked matches nobody, never the whole table', async () => {
  await agents.listAgentsForAdmin({ repId: 0 });
  assert.ok(calls.every((call) => call.sql.includes('rsa.rep_id = $1') && call.values[0] === 0));
});

test('agencies are those holding one of the rep\'s agents; agency search binds real placeholders', async () => {
  enqueue([{ total: 0 }]);
  enqueue([]);
  await agencies.listAgenciesForAdmin({ q: 'immo', repId: 3 });
  const [count] = calls;
  assert.match(count.sql, /ra\.vendor_id = v\.id AND ra\.deleted_at IS NULL/);
  assert.match(count.sql, /v\.username ILIKE \$2/, 'the search term is a $ placeholder, not a bare number');
  assert.deepEqual(count.values.slice(0, 2), [3, '%immo%']);
});

test('the WhatsApp tap log, totals and communes are scoped to the rep\'s agents\' listings', async () => {
  await leadRouting.getLeadClicksPage({ limit: 25, offset: 0, repId: 4 });
  await leadRouting.getLeadClickTotals({ days: 30, repId: 4 });
  await leadRouting.getLeadClicksByCommune({ days: 30, repId: 4 });
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.match(call.sql, /sp\.id = wc\.listing_id AND/);
    assert.ok(call.values.includes(4));
  }
  const page = calls.find((call) => /OFFSET \$2/.test(call.sql));
  assert.ok(page.sql.includes('rsa.rep_id = $3') && !page.sql.includes('rsa.rep_id = $1'));
});

test('agent performance keeps only the rep\'s agents and recomputes the totals from them', () => {
  const data = {
    agents: [
      { agentId: 1, leads: 4, responded: 2, viewings: 2, avgLatencySeconds: 100, routesDirect: true },
      { agentId: 2, leads: 6, responded: 3, viewings: 1, avgLatencySeconds: 200, routesDirect: false },
      { agentId: 9, leads: 50, responded: 50, viewings: 40, avgLatencySeconds: 10, routesDirect: true },
    ],
    totals: { agents: 3, leads: 60 },
  };
  const scoped = scopeAgentPerformance(data, [1, 2]);
  assert.deepEqual(scoped.agents.map((a) => a.agentId), [1, 2]);
  assert.deepEqual(scoped.totals, {
    agents: 2, directRoutingAgents: 1, leads: 10, responded: 5, viewings: 3, avgLatencySeconds: 160, leadToViewingPct: 30,
  });
  assert.equal(scopeAgentPerformance(data, []).totals.avgLatencySeconds, null);
});

test('a sales rep cannot open Verifications or Market data; deletes are owner only', () => {
  assert.equal(can('sales', sectionPermission('/admin/verifications')), false);
  assert.equal(can('sales', sectionPermission('/admin/market-data')), false);
  assert.equal(can('sales', sectionPermission('/admin/market-data/rapport/Gombe')), false);
  assert.equal(can('analyst', sectionPermission('/admin/market-data')), true);
  assert.equal(can('moderator', sectionPermission('/admin/verifications')), true);
  assert.equal(can('sales', 'agents.manage'), false);
  assert.equal(can('sales', 'agents.delete'), false);
  for (const permission of ['customers.delete', 'sales.delete']) {
    assert.equal(can('owner', permission), true);
    assert.equal(can('finance', permission), false);
    assert.equal(can('support', permission), false);
  }
});
