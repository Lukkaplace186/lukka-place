import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { matchTapAlerts, tapAlertQuery, tapCanAlert } from '@/lib/contactTapMatch';
import { LEAD_CLICKS_PAGE_SQL } from '@/lib/adminLeadRouting';

// 2026-11-15, owner: WhatsApp goes straight to the agent again, and the tap log
// on /admin/telemetry shows per tap that the agent was told ("Un client vous
// contacte", engine contact_tap_alerts) and what they answered.

const root = path.resolve(import.meta.dirname, '..', '..');
const T0 = Date.parse('2026-11-15T10:00:00.000Z');
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();
const tap = (id, offsetMs, extra = {}) => ({
  id, listing_id: 883, created_at: new Date(T0 + offsetMs), routing_type: 'DIRECT_WA', viewer_kind: 'visitor', visitor_id: 'v1', ...extra,
});
const alert = (id, offsetMs, extra = {}) => ({
  id, property_id: 883, kind: 'whatsapp', visitor_key: 'v1', created_at: iso(offsetMs), sent_via: 'buttons', answer: null, answered_at: null, ...extra,
});

test('only a customer\'s tap on the agent\'s own WhatsApp can have alerted the agent', () => {
  assert.equal(tapCanAlert(tap(1, 0)), true);
  assert.equal(tapCanAlert(tap(1, 0, { routing_type: 'VIA_LUKKA' })), false);
  assert.equal(tapCanAlert(tap(1, 0, { routing_type: 'CENTRAL_FALLBACK' })), false);
  assert.equal(tapCanAlert(tap(1, 0, { viewer_kind: 'staff' })), false);
  assert.equal(tapCanAlert(tap(1, 0, { viewer_kind: null })), true, 'NULL predates the column: a visitor');
});

test('the engine is asked for the page\'s listings, from 24 h before the oldest tap', () => {
  assert.equal(tapAlertQuery([tap(1, 0, { routing_type: 'VIA_LUKKA' })]), null);
  const query = tapAlertQuery([tap(1, 60_000), tap(2, 0, { listing_id: 850 }), tap(3, 0)]);
  assert.deepEqual(query.propertyIds.sort(), [850, 883]);
  assert.equal(query.since, iso(-24 * 60 * 60 * 1000));
});

test('a tap gets the alert written just after it, with the agent\'s answer', () => {
  const matched = matchTapAlerts(
    [tap(1, 0)],
    [alert(7, 800, { answer: 'REPLIED', answered_at: iso(600_000) })],
  );
  assert.deepEqual(matched.get('1'), {
    state: 'replied', via: 'buttons', answeredAt: iso(600_000), alertAt: iso(800),
    // 2026-11-20: the alert's customer (when left), visit and outcome ride along.
    alertId: 7, customer: null, viewingId: null, outcome: null,
  });
});

test('states: no answer yet, "rien reçu", a send that failed', () => {
  const matched = matchTapAlerts(
    [tap(1, 0), tap(2, 0, { listing_id: 850 }), tap(3, 0, { listing_id: 869 })],
    [alert(7, 500), alert(8, 500, { property_id: 850, answer: 'NOTHING' }), alert(9, 500, { property_id: 869, sent_via: null })],
  );
  assert.equal(matched.get('1').state, 'waiting');
  assert.equal(matched.get('2').state, 'nothing');
  assert.equal(matched.get('3').state, 'failed');
});

test('a repeat tap covered by the engine\'s dedupe reads "already alerted", never "no alert"', () => {
  const matched = matchTapAlerts(
    [tap(1, 0), tap(2, 3 * 60 * 60 * 1000), tap(3, 10 * 60 * 1000, { visitor_id: 'v2' })],
    [alert(7, 500)],
  );
  assert.equal(matched.get('1').state, 'waiting');
  assert.equal(matched.get('2').state, 'earlier', 'same visitor 3 h later: inside the 24 h window');
  assert.equal(matched.get('3').state, 'earlier', 'another visitor 10 min later: inside the 30 min window');
});

test('an alert is one tap\'s only, and another listing\'s or visitor\'s alert is never borrowed', () => {
  const matched = matchTapAlerts(
    [tap(1, 0), tap(2, 1000, { visitor_id: 'v2' }), tap(3, 0, { listing_id: 850 })],
    [alert(7, 500)],
  );
  assert.equal(matched.get('1').state, 'waiting');
  assert.equal(matched.get('2').state, 'earlier', 'v2 was not alerted itself; the listing\'s 30 min window covers it');
  assert.equal(matched.has('3'), false, 'listing 850 had no alert at all');
  const late = matchTapAlerts([tap(1, 0)], [alert(7, 3 * 60 * 1000)]);
  assert.equal(late.has('1'), false, 'an alert 3 min after the tap is not that tap\'s');
  const call = matchTapAlerts([tap(1, 0)], [alert(7, 500, { kind: 'call' })]);
  assert.equal(call.has('1'), false, 'an Appeler alert is not a WhatsApp tap\'s');
});

test('the tap log selects visitor_id and the page shows the "Agent prévenu" column', () => {
  assert.match(LEAD_CLICKS_PAGE_SQL, /wc\.visitor_id,/);
  const page = readFileSync(path.join(root, 'app', 'admin', 'telemetry', 'page.js'), 'utf8');
  assert.match(page, /getContactTapAlerts\(alertQuery\)/);
  assert.match(page, /admin\.telemetry\.colAgentAlert/);
  for (const dict of ['fr', 'en']) {
    const json = JSON.parse(readFileSync(path.join(root, 'lib', 'i18n', `${dict}.json`), 'utf8'));
    const keys = json.admin.telemetry.agentAlert;
    for (const state of ['replied', 'nothing', 'waiting', 'failed', 'earlier', 'none', 'unavailable']) {
      assert.ok(keys[state], `${dict}: admin.telemetry.agentAlert.${state}`);
    }
  }
});
