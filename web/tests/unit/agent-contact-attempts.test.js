import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// "Record taps only" (owner decision 2026-11-09): every wa.me / tel: link an
// agent's dashboard opens to a customer records the tap through
// AgentContactLink → POST /api/agent/contact-attempt → engine
// agent_contact_attempts. These pin that each surface uses it, and that the
// route trusts the session, never the body, for who the agent is.

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const SURFACES = [
  ['components/AgentLeadCard.js', ['source="lead_card"', 'channel="whatsapp"', 'channel="phone"']],
  ['components/AgentVisitRequestCard.js', ['source="visit_card"', 'channel="whatsapp"', 'channel="phone"']],
  ['components/AgentQuickReplies.js', ['source="quick_reply"']],
  ['components/AgentAlternativesDialog.js', ['source="alternatives"']],
  ['components/AgentTodayList.js', ['source="today"']],
  ['app/compte/agent/visites/page.js', ['source="agenda"', 'channel="whatsapp"', 'channel="phone"']],
];

test('every dashboard link to a customer records the tap', () => {
  for (const [file, needles] of SURFACES) {
    const src = read(file);
    assert.match(src, /AgentContactLink/, `${file} uses AgentContactLink`);
    for (const needle of needles) assert.ok(src.includes(needle), `${file} carries ${needle}`);
  }
});

test('the tap is sent with keepalive so it survives WhatsApp taking over the page', () => {
  const src = read('lib/analyticsClient.js');
  assert.match(src, /export function trackAgentContact/);
  assert.match(src, /\/api\/agent\/contact-attempt[\s\S]{0,400}keepalive: true/);
});

test('the route reads the agent from the session and checks ownership before recording', () => {
  const src = read('app/api/agent/contact-attempt/route.js');
  assert.match(src, /getCurrentAgentId\(\)/);
  assert.doesNotMatch(src, /body\??\.agentId/, 'the agent id never comes from the body');
  assert.match(src, /findOwnedLead\(agentId, leadId\)/);
  assert.match(src, /findOwnedViewingRequest\(agentId, viewingRequestId\)/);
  assert.match(src, /status: 404/);
});

test('lead ownership includes the dispatcher\'s pushes, and is not a Server Action', () => {
  const src = read('lib/agentLeadOwnership.js');
  assert.match(src, /^import 'server-only';/);
  assert.doesNotMatch(src, /'use server'/);
  assert.match(src, /matchedAgentId: agentId/);
  assert.match(src, /agentId,/);
  const actions = read('app/compte/agent/actions.js');
  assert.doesNotMatch(actions, /export async function assertOwnedLead/, 'never callable from the browser');
  assert.match(actions, /findOwnedLead\(agentId, leadId\)/);
});

test('a lead card offers "J\'ai déjà contacté le client" while the lead is new', () => {
  const src = read('components/AgentLeadCard.js');
  assert.match(src, /lead\.status === 'NEW'/);
  assert.match(src, /source: 'declared'/);
});
