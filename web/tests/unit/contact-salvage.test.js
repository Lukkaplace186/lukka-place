import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanVisitName, isVisitIntent, visitContactFromBody } from '../../lib/visitContact.js';
import {
  CONTACT_OUTCOMES, CONTACT_OUTCOME_LABELS_FR, contactOutcomeItems, isContactOutcome,
} from '../../lib/contactOutcomeRules.js';
import { attachJourneys, buildContactRows, journeySummary } from '../../lib/contactLog.js';
import { matchTapAlerts } from '../../lib/contactTapMatch.js';
import { LISTING_EVENT_TYPES } from '../../lib/trackIngest.js';
import fr from '../../lib/i18n/fr.json' with { type: 'json' };
import en from '../../lib/i18n/en.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

// Salvaging what direct WhatsApp contacts used to lose (2026-11-20, owner).

test('the customer\'s number is optional, visit-only, and never a guess', () => {
  assert.equal(isVisitIntent('visit'), true);
  assert.equal(isVisitIntent('video_visit'), true);
  assert.equal(isVisitIntent('availability'), false);
  assert.deepEqual(visitContactFromBody({ contact: { name: '  Kera  ', phone: '243812345678' } }, 'visit'), { name: 'Kera', phone: '243812345678' });
  assert.equal(visitContactFromBody({ contact: { phone: '243812345678' } }, 'availability'), null, 'an enquiry carries no number');
  assert.equal(visitContactFromBody({ contact: { phone: '12' } }, 'visit'), null);
  assert.equal(visitContactFromBody({}, 'visit'), null);
  assert.equal(cleanVisitName('   '), null);
  assert.equal(cleanVisitName('x'.repeat(200)).length, 80);
});

test('the lead-click route forwards the contact to the engine only, never into whatsapp_clicks', () => {
  const route = read('app/api/telemetry/lead-click/route.js');
  assert.match(route, /visitContactFromBody\(body, intent\)/);
  assert.match(route, /alertAgentOfContactTap\(\{ listingId: id, kind: tapKind, visitorId, intent, contact \}\)/);
  const insert = route.slice(route.indexOf('recordLeadClick('), route.indexOf('});', route.indexOf('recordLeadClick(')));
  assert.doesNotMatch(insert, /\bcontact\b|phone/i);
});

test('the WhatsApp sheet offers the number step for visits, with a skip, and asks "message parti ?" on return', () => {
  const sheet = read('components/WhatsAppIntentSheet.js');
  assert.match(sheet, /setStep\('contact'\)/);
  assert.match(sheet, /listings\.waIntent\.contact\.skip/);
  assert.match(sheet, /visibilitychange/);
  assert.match(sheet, /trackWhatsAppOutcome/);
  assert.ok(LISTING_EVENT_TYPES.includes('whatsapp_sent'));
  assert.ok(LISTING_EVENT_TYPES.includes('whatsapp_not_sent'));
});

test('"Faites le point" outcomes: five answers, labelled, a customer shown only when they left a number', () => {
  assert.deepEqual(CONTACT_OUTCOMES, ['VISIT_PLANNED', 'VISITED', 'TALKING', 'NOT_INTERESTED', 'CLOSED']);
  for (const o of CONTACT_OUTCOMES) assert.ok(CONTACT_OUTCOME_LABELS_FR[o]);
  assert.equal(isContactOutcome('MAYBE'), false);
  const items = contactOutcomeItems([
    { id: 1, property_id: 719, kind: 'whatsapp', intent: 'visit', created_at: '2026-11-19T12:00:00Z', customer_name: 'Kera', customer_phone: '243812345678', outcome: 'VISIT_PLANNED' },
    { id: 2, property_id: 720, kind: 'call', created_at: '2026-11-19T13:00:00Z', answer: 'NOTHING', outcome: 'WEIRD' },
  ], new Map([[719, { title: 'Studio à louer à Limete' }]]));
  assert.equal(items[0].listingTitle, 'Studio à louer à Limete');
  assert.equal(items[0].customer, 'Kera · +243812345678');
  assert.equal(items[0].what, 'Le client veut visiter');
  assert.equal(items[0].outcome, 'VISIT_PLANNED');
  assert.equal(items[1].listingTitle, 'Annonce n° 720');
  assert.equal(items[1].customer, null);
  assert.equal(items[1].outcome, null, 'an unknown outcome is none');
  assert.equal(items[1].saidNothing, true);
  assert.match(items[0].when, /\d/);
});

test('a tap row takes the customer, the visit and the outcome from its alert', () => {
  const taps = [{ id: 10, created_at: '2026-11-19T12:00:00Z', listing_id: 719, agent_id: 114, visitor_id: 'visitor-aaaa', viewer_kind: 'visitor', routing_type: 'DIRECT_WA', intent: 'visit' }];
  const alerts = [{
    id: 5, property_id: 719, kind: 'whatsapp', visitor_key: 'visitor-aaaa', created_at: '2026-11-19T12:00:20Z', sent_via: 'buttons',
    answer: 'VISIT_SET', answered_at: '2026-11-19T12:10:00Z', customer_name: 'Kera', customer_phone: '243812345678', viewing_request_id: 42, outcome: 'VISIT_PLANNED',
  }];
  const match = matchTapAlerts(taps, alerts).get('10');
  assert.equal(match.viewingId, 42);
  assert.equal(match.customer.phone, '243812345678');
  const rows = buildContactRows({ engine: { tapAlerts: alerts, viewings: [{ id: 42, created_at: '2026-11-19 12:10:00', property_id: 719, agent_id: 114, status: 'PENDING', wa_id: '243812345678', lead_source: 'listing-direct-visit' }] }, waTaps: taps });
  const tap = rows.find((r) => r.key === 'wa:10');
  assert.equal(tap.customer.name, 'Kera');
  assert.equal(tap.viewingId, 42);
  assert.equal(tap.outcome, 'VISIT_PLANNED');
  assert.equal(rows.find((r) => r.key === 'visit:42').surface, 'directVisit');
});

test('the journey: channel, search, other listings, saves — and a device account names an anonymous contact', () => {
  const rows = [
    { key: 'wa:1', visitorId: 'dev-1', listingId: 10, customer: null },
    { key: 'wa:2', visitorId: 'dev-1', listingId: 11, customer: null },
    { key: 'wa:3', visitorId: 'dev-2', listingId: 10, customer: { customerId: 9, phone: '243800000009', name: 'Signed' } },
    { key: 'lead:4', visitorId: null, listingId: 10, customer: null },
  ];
  attachJourneys(rows, {
    touches: new Map([
      ['dev-1', { first_source: 'direct', last_source: 'chatgpt.com' }],
      ['dev-2', { first_source: 'fb', first_medium: 'paid', first_click_id_type: 'fbclid', first_referrer_host: 'm.facebook.com' }],
    ]),
    searches: new Map([['dev-1', { purpose: 'rent', communes: ['Lingwala'], beds_min: 2, price_max: '400' }]]),
    saves: new Map([['dev-1', 3]]),
    accounts: new Map([['dev-1', { account_id: 77, full_name: 'Kera', phone: '+243812345678' }], ['dev-2', { account_id: 78, full_name: 'Other', phone: '243899' }]]),
  });
  assert.equal(rows[0].journey.channel, 'ai');
  assert.equal(rows[2].journey.channel, 'meta_ads_facebook');
  assert.deepEqual(rows[0].journey.search, { purpose: 'rent', communes: ['Lingwala'], bedsMin: 2, priceMax: 400, propertyType: null });
  assert.equal(rows[0].journey.otherListings, 1);
  assert.equal(rows[0].journey.saves, 3);
  assert.equal(rows[0].customer.fromDevice, true);
  assert.equal(rows[0].customer.phone, '243812345678');
  assert.equal(rows[2].customer.name, 'Signed', 'a known customer is never replaced');
  assert.equal(rows[3].journey, undefined, 'no device, no journey');
  assert.match(journeySummary(rows[0].journey), /ai · rent · 2\+ ch\. · ≤ 400 \$ · Lingwala · \+1 autre/);
});

test('every new label exists in both languages', () => {
  for (const dict of [fr, en]) {
    for (const key of ['title', 'lead', 'name', 'phone', 'privacy', 'continue', 'skip', 'invalidPhone']) assert.ok(dict.listings.waIntent.contact[key], key);
    for (const key of ['title', 'failedTitle', 'yes', 'no', 'retry', 'call', 'visit', 'close']) assert.ok(dict.listings.waIntent.returnPrompt[key], key);
    for (const o of CONTACT_OUTCOMES) assert.ok(dict.admin.contacts.outcome[o], o);
    assert.ok(dict.admin.contacts.journey.purpose.rent);
    assert.ok(dict.admin.contacts.surface.directVisit);
  }
});
