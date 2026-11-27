import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMinBudgetInput } from '@/lib/agentMinBudget';

// Agency minimum budget (2026-11-25, root docs/claude/leads-and-enquiries.md,
// "Agency minimum budget"): empty means every budget, never 0.

test('an empty field is "no minimum", not 0', () => {
  assert.equal(parseMinBudgetInput(''), null);
  assert.equal(parseMinBudgetInput('   '), null);
  assert.equal(parseMinBudgetInput(null), null);
});

test('amounts are read as typed, with spaces or a dollar sign', () => {
  assert.equal(parseMinBudgetInput('1500'), 1500);
  assert.equal(parseMinBudgetInput('1 500'), 1500);
  assert.equal(parseMinBudgetInput('1500 $'), 1500);
  assert.equal(parseMinBudgetInput('1500usd'), 1500);
});

test('anything that is not a positive amount in range is refused', () => {
  for (const bad of ['abc', '0', '-100', '1.500.000', '15 00 x']) assert.equal(parseMinBudgetInput(bad), undefined, bad);
  assert.equal(parseMinBudgetInput('60000', { max: 50000 }), undefined);
});

test('both edit paths write through lib/agentMinBudget with their own source', () => {
  const admin = readFileSync(new URL('../../app/admin/agents/[id]/actions.js', import.meta.url), 'utf8');
  const agent = readFileSync(new URL('../../app/compte/agent/actions.js', import.meta.url), 'utf8');
  assert.match(admin, /setAgentMinBudget\(agentId, \{ \.\.\.changed, source: 'admin' \}\)/);
  assert.match(agent, /setAgentMinBudget\(agentId, \{ rental, sale, source: 'agent' \}\)/);
});
