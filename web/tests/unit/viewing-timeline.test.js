import test from 'node:test';
import assert from 'node:assert/strict';
import { viewingTimeline, VIEWING_STATUS_LABEL_KEYS } from '@/lib/viewingTimeline';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

/**
 * The Espace Client visit timeline (Phase 2 of the customer account audit).
 * Its permissions mirror the engine's rules; scripts/verify-pipeline.js §33
 * pins the engine side.
 */

const NOW = new Date('2026-09-20T12:00:00Z');
const keys = (timeline) => timeline.steps.map((s) => `${s.key}:${s.state}`);

test('an unanswered request is waiting on the agent and can be cancelled', () => {
  const t = viewingTimeline({ status: 'PENDING' }, NOW);
  assert.deepEqual(keys(t), ['requested:done', 'awaitingAgent:current', 'visit:upcoming', 'feedback:upcoming']);
  assert.equal(t.canCancel, true);
  assert.equal(t.canAcceptSlot, false);
  assert.equal(t.canCheckin, false);
});

test('an escalated request says alternatives were sent, still PENDING', () => {
  const t = viewingTimeline({ status: 'PENDING', sla_alerted_at: '2026-09-20T10:00:00Z' }, NOW);
  assert.equal(t.steps[1].key, 'awaitingAgentAlternatives');
});

test('only a proposed new slot can be accepted', () => {
  assert.equal(viewingTimeline({ status: 'RESCHEDULED' }, NOW).canAcceptSlot, true);
  for (const status of ['PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED']) {
    assert.equal(viewingTimeline({ status }, NOW).canAcceptSlot, false, status);
  }
});

test('a confirmed visit in the future is upcoming, cancellable, not reviewable', () => {
  const t = viewingTimeline({ status: 'CONFIRMED', scheduled_at: '2026-09-21T13:00:00Z' }, NOW);
  assert.deepEqual(keys(t), ['requested:done', 'confirmed:done', 'visit:current', 'feedback:upcoming']);
  assert.equal(t.canCancel, true);
  assert.equal(t.canCheckin, false);
});

test('once its time has passed a confirmed visit is reviewed, not cancelled', () => {
  const t = viewingTimeline({ status: 'CONFIRMED', scheduled_at: '2026-09-20T09:00:00Z' }, NOW);
  assert.equal(t.canCancel, false);
  assert.equal(t.canCheckin, true);
  assert.equal(t.steps.at(-1).state, 'current');
});

test('a confirmed visit with no agreed instant is never asked about', () => {
  assert.equal(viewingTimeline({ status: 'CONFIRMED', scheduled_at: null }, NOW).canCheckin, false);
});

test('a 👎 asks for a reason until one is given; an agent no-show is shown as such', () => {
  assert.equal(viewingTimeline({ status: 'COMPLETED', checkin_response: 'BAD' }, NOW).canGiveReason, true);
  assert.equal(
    viewingTimeline({ status: 'COMPLETED', checkin_response: 'BAD', customer_reason_code: 'OTHER' }, NOW).canGiveReason,
    false,
  );
  const absent = viewingTimeline({ status: 'CONFIRMED', scheduled_at: '2026-09-20T09:00:00Z', checkin_response: 'AGENT_ABSENT' }, NOW);
  assert.ok(keys(absent).includes('agentAbsent:stopped'));
  assert.equal(absent.canCheckin, false);
});

test('a declined or cancelled visit stops, and says who cancelled it', () => {
  assert.deepEqual(keys(viewingTimeline({ status: 'DECLINED' }, NOW)), ['requested:done', 'declined:stopped']);
  assert.equal(viewingTimeline({ status: 'CANCELLED', cancelled_by: 'CUSTOMER' }, NOW).steps[1].key, 'cancelledByYou');
  assert.equal(viewingTimeline({ status: 'CANCELLED', cancelled_by: 'AGENT' }, NOW).steps[1].key, 'cancelledByAgent');
  assert.equal(viewingTimeline({ status: 'CANCELLED' }, NOW).canCancel, false);
});

test('every step and status the timeline can produce has copy in both languages', () => {
  const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  const stepKeys = ['requested', 'awaitingAgent', 'awaitingAgentAlternatives', 'newSlot', 'confirmed', 'declined',
    'cancelledByYou', 'cancelledByAgent', 'cancelled', 'visit', 'agentAbsent', 'feedback', 'feedbackGiven'];
  for (const dict of [fr, en]) {
    for (const key of stepKeys) assert.equal(typeof lookup(dict, `account.visits.steps.${key}`), 'string', key);
    for (const key of Object.values(VIEWING_STATUS_LABEL_KEYS)) assert.equal(typeof lookup(dict, key), 'string', key);
  }
});
