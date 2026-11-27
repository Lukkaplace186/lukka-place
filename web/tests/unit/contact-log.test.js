import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildContactRows, contactWindow, filterContactRows, summariseContactRows, toIso, CONTACT_CHANNELS,
} from '@/lib/contactLog';
import { contactTapPayload, contactTapProps } from '@/lib/contactTapAttrs';
import { RECORD_AGENT_CONTACT_TAP_SQL, recordAgentContactTap } from '@/lib/agentContactTaps';
import { RECORD_LEAD_CLICK_CUSTOMER_SQL, recordLeadClick } from '@/lib/leadClicks';
import { RECORD_LISTING_EVENT_CUSTOMER_SQL, recordListingEvent } from '@/lib/trackIngest';
import { SECTION_PERMISSIONS } from '@/lib/adminRoles';
import { ADMIN_NAV_GROUPS } from '@/lib/adminNav';
import { getPool } from '@/lib/db';
import { calls, normalizeSql, reset } from '../support/fakePool.js';

// 2026-11-15, owner: "where can I see exactly which customer contacted which
// agent". /admin/contacts lists every customer → agent contact, one row each.

const root = path.resolve(import.meta.dirname, '..', '..');
const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const at = (min) => new Date(T0 + min * 60_000);

test.beforeEach(() => reset());

test('engine datetimes are UTC text; ISO and Dates pass through', () => {
  assert.equal(toIso('2026-11-15 09:29:22'), '2026-11-15T09:29:22.000Z');
  assert.equal(toIso('2026-11-15T09:29:22.000Z'), '2026-11-15T09:29:22.000Z');
  assert.equal(toIso(new Date(T0)), '2026-11-15T10:00:00.000Z');
  assert.equal(toIso(null), null);
  assert.equal(contactWindow('7'), 7);
  assert.equal(contactWindow('12'), 30);
});

test('every source becomes one row, newest first, with the customer when known and never guessed', () => {
  const customers = new Map([[501, { phone: '+243 812 000 111', full_name: 'Awa K.' }]]);
  const rows = buildContactRows({
    engine: {
      leads: [
        { id: 66, source: 'listing-whatsapp-enquiry', wa_id: '243894124324', name: null, agent_id: 135, property_id: 1013, status: 'NEW', created_at: '2026-11-15 09:59:00', contact_followup_answer: 'NOT_YET' },
        { id: 70, source: 'listing-visit-request', wa_id: '243800000001', agent_id: 1, property_id: 2, status: 'NEW', created_at: '2026-11-15 10:01:00' },
        { id: 71, source: 'project-enquiry', wa_id: '243811111111', name: 'Jo', agent_id: null, property_id: null, development_id: 9, status: 'CONTACTED', created_at: '2026-11-15 09:00:00' },
      ],
      viewings: [{ id: 28, agent_id: 135, property_id: 979, status: 'PENDING', created_at: '2026-11-15 09:46:00', wa_id: '243894124324', name: 'Mangbau' }],
      tapAlerts: [{ id: 3, property_id: 883, kind: 'whatsapp', visitor_key: 'v1', created_at: at(0.01).toISOString(), sent_via: 'buttons', answer: 'REPLIED', answered_at: at(5).toISOString() }],
    },
    waTaps: [
      { id: 11, created_at: at(0), listing_id: 883, agent_id: 125, visitor_id: 'v1', viewer_kind: 'visitor', routing_type: 'DIRECT_WA', customer_id: null },
      { id: 12, created_at: at(1), listing_id: 850, agent_id: 114, visitor_id: 'v2', viewer_kind: 'visitor', routing_type: 'DIRECT_WA', customer_id: 501 },
      { id: 13, created_at: at(2), listing_id: 850, agent_id: 114, visitor_id: 'v3', viewer_kind: 'staff', routing_type: 'DIRECT_WA' },
      { id: 14, created_at: at(3), listing_id: 850, agent_id: 114, visitor_id: 'v4', viewer_kind: 'visitor', routing_type: 'VIA_LUKKA' },
    ],
    callTaps: [{ id: 21, created_at: at(4), listing_id: 869, agent_id: 65, visitor_id: 'v5', viewer_kind: 'visitor', routing_type: 'DIRECT', customer_id: null }],
    otherTaps: [{ id: 31, created_at: at(6), agent_id: 43, channel: 'whatsapp', surface: 'profile', visitor_id: 'v6', viewer_kind: 'visitor', customer_id: null }],
    chats: [{ id: 41, created_at: at(7), customer_id: 501, agent_id: 114, property_id: 850, agent_first_reply_at: null }],
    customers,
    propertyAgents: new Map([[2, 1]]),
  });

  assert.deepEqual(rows.map((r) => r.key), ['chat:41', 'tap:31', 'call:21', 'wa:12', 'wa:11', 'lead:66', 'visit:28', 'lead:71']);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey['wa:11'].customer, null, 'an anonymous tap stays anonymous');
  assert.equal(byKey['wa:11'].status, 'replied', 'the agent pressed « J’ai répondu »');
  assert.deepEqual(byKey['wa:12'].customer, { customerId: 501, phone: '243812000111', name: 'Awa K.' });
  assert.equal(byKey['wa:12'].status, 'noAlert');
  assert.equal(byKey['call:21'].channel, 'callDirect');
  assert.equal(byKey['tap:31'].surface, 'profile');
  assert.equal(byKey['chat:41'].status, 'waiting');
  assert.deepEqual(byKey['lead:66'].customer, { customerId: null, phone: '243894124324', name: null });
  assert.equal(byKey['lead:66'].status, 'customerWaiting', 'the customer told our follow-up nobody called');
  assert.equal(byKey['visit:28'].status, 'visitPending');
  assert.equal(byKey['lead:71'].channel, 'projectEnquiry');
  assert.equal(byKey['lead:71'].developmentId, 9);
  assert.ok(!rows.some((r) => r.key === 'wa:13'), 'the team is not a customer');
  assert.ok(!rows.some((r) => r.key === 'wa:14'), 'a tap to our number is listed as the message it led to');
  assert.ok(!rows.some((r) => r.key === 'lead:70'), 'a visit request is listed once, from viewing_requests');
});

test('a row that names only a listing is attributed to that listing\'s agent', () => {
  const rows = buildContactRows({
    engine: { leads: [{ id: 1, source: 'listing-whatsapp-enquiry', wa_id: '243800000002', agent_id: null, property_id: 608, status: 'NEW', created_at: '2026-11-12 19:48:49' }] },
    propertyAgents: new Map([[608, 77]]),
  });
  assert.equal(rows[0].agentId, 77);
});

test('a repeat tap by the same visitor within 10 minutes is marked and left out of the totals', () => {
  const tap = (id, min) => ({ id, created_at: at(min), listing_id: 883, agent_id: 125, visitor_id: 'v1', viewer_kind: 'visitor', routing_type: 'DIRECT_WA' });
  const rows = buildContactRows({ waTaps: [tap(1, 0), tap(2, 3), tap(3, 30)] });
  const repeat = Object.fromEntries(rows.map((r) => [r.key, Boolean(r.repeat)]));
  assert.deepEqual(repeat, { 'wa:1': false, 'wa:2': true, 'wa:3': false });
  const summary = summariseContactRows(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.repeats, 1);
  assert.equal(summary.byChannel.whatsappDirect, 2);
});

test('filters: channel, agent, customer known, number or name', () => {
  const rows = buildContactRows({
    engine: { leads: [{ id: 1, source: 'listing-whatsapp-enquiry', wa_id: '243894124324', name: 'Mangbau', agent_id: 135, property_id: 1, status: 'NEW', created_at: '2026-11-15 09:00:00' }] },
    waTaps: [{ id: 2, created_at: at(0), listing_id: 2, agent_id: 125, visitor_id: 'v', viewer_kind: 'visitor', routing_type: 'DIRECT_WA' }],
  });
  assert.deepEqual(filterContactRows(rows, { channel: 'whatsappDirect' }).map((r) => r.key), ['wa:2']);
  assert.deepEqual(filterContactRows(rows, { agentId: '135' }).map((r) => r.key), ['lead:1']);
  assert.deepEqual(filterContactRows(rows, { known: true }).map((r) => r.key), ['lead:1']);
  assert.deepEqual(filterContactRows(rows, { q: '894 124' }).map((r) => r.key), ['lead:1']);
  assert.deepEqual(filterContactRows(rows, { q: 'mangb' }).map((r) => r.key), ['lead:1']);
  assert.equal(filterContactRows(rows, { channel: 'nonsense' }).length, 2, 'an unknown channel filters nothing');
  assert.deepEqual(CONTACT_CHANNELS.slice(0, 2), ['whatsappDirect', 'callDirect']);
});

test('a direct link outside a listing carries its tap marker; the beacon reads it back', () => {
  const props = contactTapProps({ surface: 'profile', channel: 'whatsapp', agentId: 43 });
  assert.deepEqual(props, { 'data-contact-tap': 'profile', 'data-contact-channel': 'whatsapp', 'data-contact-agent': '43' });
  assert.deepEqual(contactTapProps({ surface: 'profile', channel: 'whatsapp', agentId: null }), {}, 'nothing named, nothing marked');
  assert.deepEqual(contactTapProps({ surface: 'elsewhere', channel: 'whatsapp', agentId: 1 }), {});
  assert.deepEqual(
    contactTapPayload({ contactTap: 'project', contactChannel: 'call', contactProject: 'tour-a' }),
    { surface: 'project', channel: 'call', projectSlug: 'tour-a' },
  );
  assert.equal(contactTapPayload({ contactTap: 'project', contactChannel: 'call' }), null);
});

test('a surface tap is attributed server-side and only to a live agent; nothing named stores nothing', async () => {
  const sql = normalizeSql(RECORD_AGENT_CONTACT_TAP_SQL);
  assert.match(sql, /FROM developments d WHERE \$4::text IS NOT NULL AND LOWER\(d\.slug\) = LOWER\(\$4::text\)/);
  assert.match(sql, /FROM properties p WHERE \$3::bigint IS NOT NULL AND p\.id = \$3::bigint/);
  assert.match(sql, /a\.deleted_at IS NULL/);
  assert.equal(await recordAgentContactTap(getPool(), { surface: 'profile', channel: 'whatsapp' }), false);
  assert.equal(calls.length, 0);
  await recordAgentContactTap(getPool(), { surface: 'directory', channel: 'call', agentId: '43', customerId: 7, visitorId: 'v' });
  assert.deepEqual(calls[0].values, ['call', 'directory', null, null, 'v', 7, 'visitor', null, 43]);
});

test('a signed-in customer\'s listing tap and call keep who they are; an anonymous one does not ask', async () => {
  await recordLeadClick(getPool(), { listingId: 883, routingType: 'DIRECT_WA', customerId: 501, placement: 'card' });
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(RECORD_LEAD_CLICK_CUSTOMER_SQL));
  assert.deepEqual(calls[0].values.slice(-2), ['card', 501]);
  reset();
  await recordLeadClick(getPool(), { listingId: 883, routingType: 'DIRECT_WA' });
  assert.ok(!/customer_id/.test(calls[0].sql));
  reset();
  await recordListingEvent(getPool(), { event: 'call_click', listingId: 869, routingType: 'DIRECT', customerId: 501 });
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(RECORD_LISTING_EVENT_CUSTOMER_SQL));
  reset();
  await recordListingEvent(getPool(), { event: 'listing_saved', listingId: 869, customerId: 501 });
  assert.ok(!/customer_id/.test(calls[0].sql), 'only a call tap keeps the customer');
});

test('the page is in the console, behind leads.view, and every surface link is marked', () => {
  assert.equal(SECTION_PERMISSIONS['/admin/contacts'], 'leads.view');
  assert.ok(ADMIN_NAV_GROUPS.some((g) => g.items.some((i) => i.href === '/admin/contacts')));
  const marked = {
    'app/(portfolio)/agents/[id]/AgentProfileView.js': 4,
    'app/(portfolio)/agents/page.js': 2,
    'components/projects/ProjectEnquiryCard.js': 2,
    'app/(site)/compte/client/visites/VisitCard.js': 3,
    'app/(site)/compte/client/messages/InquiryThreads.js': 2,
  };
  for (const [file, count] of Object.entries(marked)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    assert.equal((src.match(/contactTapProps\(\{/g) || []).length, count, file);
  }
  for (const layout of ['app/(site)/layout.js', 'app/(portfolio)/layout.js']) {
    assert.match(readFileSync(path.join(root, layout), 'utf8'), /<ContactTapBeacon \/>/, layout);
  }
  const migration = readFileSync(path.join(root, '..', 'migrations', '20261115_contact_log.sql'), 'utf8');
  assert.match(migration, /ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS customer_id bigint/);
  assert.match(migration, /ALTER TABLE agent_contact_taps ENABLE ROW LEVEL SECURITY/);
  for (const dict of ['fr', 'en']) {
    const json = JSON.parse(readFileSync(path.join(root, 'lib', 'i18n', `${dict}.json`), 'utf8'));
    assert.ok(json.admin.nav.contacts, `${dict}: admin.nav.contacts`);
    for (const code of ['replied', 'nothing', 'waiting', 'failed', 'earlier', 'noAlert', 'tapOnly', 'notContacted', 'contacted',
      'customerWaiting', 'customerConfirmed', 'visitPending', 'visitConfirmed', 'visitRescheduled', 'visitDeclined', 'visitCancelled', 'visitDone', 'visitOther']) {
      assert.ok(json.admin.contacts.status[code], `${dict}: admin.contacts.status.${code}`);
    }
  }
});
