import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { contactTapKind } from '@/lib/contactTapAlert';
import { mergeInteractionCounts } from '@/lib/interactionCounts';

// "Un client vous contacte" (2026-11-08): a visitor's tap on a verified
// agent's WhatsApp / Appeler button tells that agent straight away
// (engine services/contactTapAlert.js). These pin who triggers it.

const root = path.resolve(import.meta.dirname, '..', '..');

test('only a visitor tapping a DIRECT button alerts the agent', () => {
  assert.equal(contactTapKind({ event: 'whatsapp_cta_clicked', routingType: 'DIRECT_WA', viewerKind: 'visitor', recorded: true }), 'whatsapp');
  assert.equal(contactTapKind({ event: 'call_click', routingType: 'DIRECT', viewerKind: 'visitor', recorded: true }), 'call');
  // The central number is our own WhatsApp: nothing to tell an agent.
  assert.equal(contactTapKind({ event: 'whatsapp_cta_clicked', routingType: 'CENTRAL_FALLBACK', viewerKind: 'visitor', recorded: true }), null);
  assert.equal(contactTapKind({ event: 'call_click', routingType: 'CENTRAL', viewerKind: 'visitor', recorded: true }), null);
  for (const viewerKind of ['agent', 'owner', 'staff', 'bot', 'prefetch']) {
    assert.equal(contactTapKind({ event: 'whatsapp_cta_clicked', routingType: 'DIRECT_WA', viewerKind, recorded: true }), null, viewerKind);
  }
  assert.equal(contactTapKind({ event: 'whatsapp_cta_clicked', routingType: 'DIRECT_WA', viewerKind: 'visitor', recorded: false }), null);
  assert.equal(contactTapKind({ event: 'listing_saved', routingType: 'DIRECT', viewerKind: 'visitor', recorded: true }), null);
});

test('both tap endpoints send the alert after the response, never awaited', () => {
  const leadClick = readFileSync(path.join(root, 'app', 'api', 'telemetry', 'lead-click', 'route.js'), 'utf8');
  const track = readFileSync(path.join(root, 'app', 'api', 'track', 'route.js'), 'utf8');
  for (const src of [leadClick, track]) {
    assert.match(src, /import \{ after \} from 'next\/server'/);
    assert.match(src, /after\(\(\) => alertAgentOfContactTap\(/);
    assert.doesNotMatch(src, /await alertAgentOfContactTap/);
  }
});

test('alert answers are reported beside the total, never added to it', () => {
  const counts = mergeInteractionCounts({
    taps: [{ agentId: 43, routingType: 'DIRECT_WA', count: 5 }],
    engine: {
      leads: [],
      viewings: [],
      contactTaps: [{ agentId: 43, propertyId: 303, kind: 'whatsapp', alerted: 3, replied: 2, nothing: 1 }],
    },
  });
  assert.equal(counts.total, 5);
  assert.deepEqual(counts.tapAlerts, { alerted: 3, replied: 2, nothing: 1 });
  const agent = counts.agents.find((a) => a.agentId === 43);
  assert.deepEqual(agent.tapAlerts, { alerted: 3, replied: 2, nothing: 1 });
  assert.equal(agent.total, 5);
});
