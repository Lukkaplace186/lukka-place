import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  INTERACTION_CHANNELS,
  INTRODUCTION_CHANNELS,
  interactionWindow,
  mergeInteractionCounts,
  propertyIdsToAttribute,
} from '@/lib/interactionCounts';
import { CALLS_BY_AGENT_SQL, TAPS_BY_AGENT_SQL, getAgentInteractions } from '@/lib/agentInteractions';
import { SECTION_PERMISSIONS } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { NON_SEARCH_LEAD_SOURCES } from '@/lib/clientPortalView';

const root = path.resolve(import.meta.dirname, '..', '..');

beforeEach(() => reset());

test('every channel adds up per agent and in the total; central taps stay beside it', () => {
  const counts = mergeInteractionCounts({
    taps: [
      { agentId: 7, routingType: 'DIRECT_WA', count: 5 },
      { agentId: 7, routingType: 'CENTRAL_FALLBACK', count: 3 },
    ],
    calls: [{ agentId: 7, routingType: 'DIRECT', count: 2 }, { agentId: null, routingType: 'CENTRAL', count: 4 }],
    engine: {
      leads: [
        { source: 'listing-whatsapp-enquiry', agentId: null, propertyId: 310, count: 2, contacted: 1 },
        { source: 'team-introduction', agentId: 9, propertyId: null, count: 1, contacted: 1 },
        { source: 'agent-profile-inquiry', agentId: 9, propertyId: null, count: 1, contacted: 0 },
        { source: 'site', agentId: null, propertyId: null, count: 50, contacted: 0 },
      ],
      viewings: [{ agentId: null, propertyId: 311, count: 3, contacted: 2 }],
    },
    propertyAgents: new Map([[310, 7], [311, null]]),
  });

  assert.equal(counts.total, 5 + 2 + 2 + 1 + 1 + 3, 'the "site" search (several agencies) is not an interaction');
  assert.deepEqual(counts.central, { whatsapp: 3, call: 4 });
  assert.equal(counts.channels.whatsappEnquiry, 2);
  assert.equal(counts.channels.teamIntroduction, 1);

  const seven = counts.agents.find((a) => a.agentId === 7);
  assert.equal(seven.total, 9, 'taps + calls + the enquiry attributed through listing 310');
  assert.equal(seven.channels.whatsappEnquiry, 2);
  const none = counts.agents.find((a) => a.agentId === null);
  assert.equal(none.channels.visitRequest, 3, 'a listing with no agent stays visible as "no agent", never dropped');
  assert.equal(counts.agents[0].agentId, 7, 'most contacted first');

  // Taps carry no "answered" figure; requests do.
  assert.equal(counts.answerable, 2 + 1 + 1 + 3);
  assert.equal(counts.contacted, 1 + 1 + 0 + 2);
});

test('only listing-only rows are sent to Postgres for their agent', () => {
  assert.deepEqual(propertyIdsToAttribute({
    leads: [{ agentId: 3, propertyId: 1 }, { agentId: null, propertyId: 2 }],
    viewings: [{ agentId: null, propertyId: 2 }, { agentId: null, propertyId: null }, { agentId: null, propertyId: 4 }],
  }), [2, 4]);
});

test('the window is 7, 30 or 90 days, 30 by default', () => {
  assert.equal(interactionWindow('7'), 7);
  assert.equal(interactionWindow('90'), 90);
  assert.equal(interactionWindow('365'), 30);
  assert.equal(interactionWindow(undefined), 30);
});

test('only visitors\' taps and calls count, per agent', () => {
  for (const sql of [TAPS_BY_AGENT_SQL, CALLS_BY_AGENT_SQL]) {
    assert.match(sql, /COALESCE\((e\.)?viewer_kind, 'visitor'\) = 'visitor'/);
    assert.match(sql, /make_interval\(days => \$1::int\)/);
  }
  assert.match(CALLS_BY_AGENT_SQL, /e\.event = 'call_click'/);
});

test('the engine being down leaves the taps on the page and says so', async () => {
  enqueue([{ agent_id: 5, routing_type: 'DIRECT_WA', count: 4 }]);
  enqueue([]);
  enqueue([{ id: 5, agency_name: 'Immo Kin', person_name: 'Jean K.' }]);
  const saved = process.env.ENGINE_API_BASE;
  process.env.ENGINE_API_BASE = 'http://127.0.0.1:9';
  try {
    const { counts, names, errors } = await getAgentInteractions({ days: 30 });
    assert.ok(errors.engine, 'the missing half is named');
    assert.equal(errors.taps, null);
    assert.equal(counts.total, 4);
    assert.equal(names.get(5), 'Jean K.', 'person first, never the username');
    assert.ok(calls.length >= 2);
  } finally {
    if (saved === undefined) delete process.env.ENGINE_API_BASE; else process.env.ENGINE_API_BASE = saved;
  }
});

test('the desk form offers exactly the engine\'s channels, and the page is wired', () => {
  const engine = readFileSync(path.join(root, '..', 'services', 'teamIntroduction.js'), 'utf8');
  assert.match(engine, new RegExp(`CHANNELS = \\[${INTRODUCTION_CHANNELS.map((c) => `'${c}'`).join(', ')}\\]`));
  assert.equal(SECTION_PERMISSIONS['/admin/interactions'], 'leads.view');
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/interactions'));
  const action = readFileSync(path.join(root, 'app', 'admin', 'interactions', 'actions.js'), 'utf8');
  assert.match(action, /requireAdmin\('leads\.manage'\)/);
  assert.match(action, /phoneFromForm\(formData, 'phone'\)/);
  assert.ok(INTERACTION_CHANNELS.length === 7);
});

test('an introduction is not shown to the customer as a search of theirs', () => {
  assert.ok(NON_SEARCH_LEAD_SOURCES.includes('team-introduction'));
});
