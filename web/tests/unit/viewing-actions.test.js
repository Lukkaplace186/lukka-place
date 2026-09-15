import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_SETTABLE_VIEWING_STATUSES,
  AGENT_VIEWING_ACTIONS,
  agentActionsFor,
  canAgentSetStatus,
} from '@/lib/viewingActions';
import { VIEWING_REQUEST_STATUSES } from '@/lib/adminLabels';

test('an unanswered request can be confirmed, rescheduled or declined — not cancelled', () => {
  for (const status of ['PENDING', 'RESCHEDULED']) {
    assert.deepEqual([...agentActionsFor(status)].sort(), ['CONFIRMED', 'DECLINED', 'RESCHEDULED']);
    assert.equal(canAgentSetStatus(status, 'CANCELLED'), false, 'nothing was agreed yet, so a refusal is a DECLINE');
  }
});

test('a confirmed visit cannot be confirmed again — that would message the customer twice', () => {
  assert.equal(canAgentSetStatus('CONFIRMED', 'CONFIRMED'), false);
  assert.deepEqual([...agentActionsFor('CONFIRMED')].sort(), ['CANCELLED', 'RESCHEDULED']);
  assert.equal(canAgentSetStatus('CONFIRMED', 'DECLINED'), false, 'after agreeing, calling it off is a CANCEL');
});

test('settled requests offer nothing', () => {
  for (const status of ['DECLINED', 'CANCELLED', 'COMPLETED', 'SOMETHING_NEW', undefined]) {
    assert.deepEqual([...agentActionsFor(status)], [], String(status));
  }
});

test('the table covers every real status, and only ever targets a settable one', () => {
  assert.deepEqual(Object.keys(AGENT_VIEWING_ACTIONS).sort(), [...VIEWING_REQUEST_STATUSES].sort());
  for (const targets of Object.values(AGENT_VIEWING_ACTIONS)) {
    for (const target of targets) assert.ok(AGENT_SETTABLE_VIEWING_STATUSES.includes(target), target);
  }
  assert.equal(AGENT_SETTABLE_VIEWING_STATUSES.includes('COMPLETED'), false, 'only the customer check-in completes a visit');
  assert.equal(AGENT_SETTABLE_VIEWING_STATUSES.includes('PENDING'), false);
});
