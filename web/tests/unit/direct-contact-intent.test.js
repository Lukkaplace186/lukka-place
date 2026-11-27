import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  WHATSAPP_INTENTS, cleanWhatsAppIntent, contactIntentGroup, intentQuestionFr, whatsappIntentEnabled,
} from '@/lib/whatsappIntent';
import { buildWhatsAppMessage } from '@/lib/whatsapp';
import { resolveWhatsAppRouting } from '@/lib/leadRouting';
import { buildContactRows, filterContactRows, summariseContactRows, CONTACT_WANTS } from '@/lib/contactLog';
import { matchTapAlerts } from '@/lib/contactTapMatch';
import { RECORD_LEAD_CLICK_INTENT_SQL, recordLeadClick } from '@/lib/leadClicks';
import { moveRequestBlocker } from '@/lib/moveProjectRules';
import { moveAutoSendEnabled, moveLeadPayload, projectSendBlocker } from '@/lib/moveProjectRequest';
import { getPool } from '@/lib/db';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import { CLAIM_SEND_SQL, claimMoveProjectSend } from '@/lib/moveProjects';

// 2026-11-16, owner: customers and agents talk directly; we still want to
// know whether the customer was enquiring or asking for a visit, and "Mon
// projet" requests must reach agencies instead of disappearing.

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test.beforeEach(() => reset());

// --- the WhatsApp intent ---------------------------------------------------

test('three intents, anything else is none; on unless switched off', () => {
  assert.deepEqual(WHATSAPP_INTENTS, ['visit', 'video_visit', 'availability', 'question']);
  assert.equal(cleanWhatsAppIntent('visit'), 'visit');
  assert.equal(cleanWhatsAppIntent('VISIT'), null);
  assert.equal(cleanWhatsAppIntent(undefined), null);
  const saved = process.env.NEXT_PUBLIC_WHATSAPP_INTENT;
  delete process.env.NEXT_PUBLIC_WHATSAPP_INTENT;
  assert.equal(whatsappIntentEnabled(), true);
  process.env.NEXT_PUBLIC_WHATSAPP_INTENT = 'off';
  assert.equal(whatsappIntentEnabled(), false);
  if (saved === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_INTENT; else process.env.NEXT_PUBLIC_WHATSAPP_INTENT = saved;
});

test('the pre-typed message asks what the customer chose, keeps the opening and ends on the link', () => {
  const base = { id: 286, propertyType: 'Appartement', commune: 'Limete', price: 700, purpose: 'rent', pricePeriod: 'mois' };
  const visit = buildWhatsAppMessage({ ...base, intent: 'visit' });
  assert.match(visit, /^Bonjour, je vous contacte via Lukka Place au sujet de ce bien :/);
  assert.match(visit, /Je souhaite visiter ce bien\. Quand seriez-vous disponible \?/);
  assert.match(visit, /\nhttps:\/\/[^\n]+\/listings\/286$/);
  assert.match(buildWhatsAppMessage({ ...base, intent: 'availability' }), /\n\nEst-il toujours disponible \?\n\n/);
  // Another question: the link first, the question line last — the customer types after it.
  assert.match(buildWhatsAppMessage({ ...base, intent: 'question' }), /\/listings\/286\n\nJ’ai une question sur ce bien :$/);
  // No choice: exactly the line every message carried before.
  assert.match(buildWhatsAppMessage(base), /Est-il toujours disponible \? Si oui, quand serait-il possible de le visiter \?/);
  assert.equal(intentQuestionFr('nope'), intentQuestionFr(null));
});

test('the intent changes the words, never where the message goes', () => {
  const listing = { id: 5, category_name: 'Studio', commune: 'Gombe', price: 400, purpose: 'rent', agent_phone: '243811000111' };
  const plain = resolveWhatsAppRouting(listing);
  const visit = resolveWhatsAppRouting(listing, 'visit');
  assert.equal(visit.routingType, plain.routingType);
  assert.ok(visit.href.startsWith('https://wa.me/243811000111?text='));
  assert.match(decodeURIComponent(visit.href), /Je souhaite visiter ce bien/);
});

test('a tap with an intent is stored with it; before the migration it is kept without', async () => {
  const pool = getPool();
  const tap = {
    listingId: 7, commune: 'Gombe', device: 'mobile', source: 'direct', price: 500, routingType: 'DIRECT_WA', visitorId: 'v1',
  };
  await recordLeadClick(pool, { ...tap, intent: 'visit' });
  assert.equal(normalizeSql(calls[0].text), normalizeSql(RECORD_LEAD_CLICK_INTENT_SQL));
  assert.equal(calls[0].values.at(-1), 'visit');
  reset();
  await recordLeadClick(pool, { ...tap, intent: 'pizza' });
  assert.ok(!normalizeSql(calls[0].text).includes('intent'), 'an unknown intent is not stored');
});

test('the WhatsApp buttons open the chooser: cards, the phone bar and the desktop card', () => {
  for (const file of ['components/WhatsAppCTA.js', 'components/MobileListingBar.js', 'components/EnquiryCard.js']) {
    const src = read(file);
    assert.match(src, /<WhatsAppIntentButton/, file);
    assert.doesNotMatch(src, /trackLeadClick\(/, `${file}: the chooser sends the tap`);
  }
  const sheet = read('components/WhatsAppIntentSheet.js') + read('components/WhatsAppIntentPanel.js');
  assert.match(sheet, /trackLeadClick\(listing, chosen\.routingType, placement, intent(, contact)?\)/);
  // A card button sits inside the card's <Link>: clicks must stop at the sheet.
  // …the dimmed backdrop included: the wrapper around the whole <Sheet> stops them.
  // Since 2026-11-21 the sheet is its own chunk (WhatsAppIntentPanel.js), still inside that wrapper.
  assert.match(sheet, /<span className="contents" onClick=\{\(event\) => event\.stopPropagation\(\)\}>\s*\{panelMounted \? \(\s*<WhatsAppIntentPanel /);
  assert.match(read('components/WhatsAppIntentPanel.js'), /<Sheet open=\{open\} onOpenChange=\{show\}>/);
  assert.match(sheet, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  const route = read('app/api/telemetry/lead-click/route.js');
  // 2026-11-20: a visit's optional name + number rides along (lib/visitContact.js).
  assert.match(route, /alertAgentOfContactTap\(\{ listingId: id, kind: tapKind, visitorId, intent(, contact)? \}\)/);
});

// --- /admin/contacts --------------------------------------------------------

test('contacts: a visit choice or a visit request is a visit; availability and questions are information; the rest unknown', () => {
  assert.equal(contactIntentGroup('visit'), 'visit');
  assert.equal(contactIntentGroup('availability'), 'enquiry');
  assert.equal(contactIntentGroup('question'), 'enquiry');
  assert.equal(contactIntentGroup(null), 'unknown');
  const T = '2026-11-16T10:00:00.000Z';
  const rows = buildContactRows({
    waTaps: [
      { id: 1, created_at: T, listing_id: 9, agent_id: 3, visitor_id: 'a', routing_type: 'DIRECT_WA', intent: 'visit' },
      { id: 2, created_at: T, listing_id: 9, agent_id: 3, visitor_id: 'b', routing_type: 'DIRECT_WA', intent: 'question' },
      { id: 3, created_at: T, listing_id: 9, agent_id: 3, visitor_id: 'c', routing_type: 'DIRECT_WA', intent: null },
    ],
    callTaps: [{ id: 4, created_at: T, listing_id: 9, agent_id: 3, visitor_id: 'd', routing_type: 'DIRECT' }],
    engine: { viewings: [{ id: 5, created_at: T, property_id: 9, agent_id: 3, status: 'PENDING', wa_id: '243800000001' }] },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.wants]));
  assert.deepEqual(byKey, { 'wa:1': 'visit', 'wa:2': 'enquiry', 'wa:3': 'unknown', 'call:4': 'unknown', 'visit:5': 'visit' });
  assert.deepEqual(summariseContactRows(rows).byWants, { visit: 2, enquiry: 1, unknown: 2 });
  assert.deepEqual(filterContactRows(rows, { wants: 'visit' }).map((r) => r.key).sort(), ['visit:5', 'wa:1']);
  assert.equal(filterContactRows(rows, { wants: 'nonsense' }).length, rows.length);
  assert.deepEqual(CONTACT_WANTS, ['visit', 'enquiry', 'unknown']);
});

test('the agent\'s « Visite fixée » shows as its own state', () => {
  const T = Date.parse('2026-11-16T10:00:00.000Z');
  const map = matchTapAlerts(
    [{ id: 1, listing_id: 9, created_at: new Date(T).toISOString(), routing_type: 'DIRECT_WA', visitor_id: 'a' }],
    [{ id: 7, property_id: 9, kind: 'whatsapp', visitor_key: 'a', created_at: new Date(T + 1000).toISOString(), sent_via: 'buttons', answer: 'VISIT_SET' }],
  );
  assert.equal(map.get('1').state, 'visitSet');
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    assert.ok(dict.admin.contacts.status.visitSet, lang);
    assert.ok(dict.admin.telemetry.agentAlert.visitSet, lang);
    for (const key of CONTACT_WANTS) assert.ok(dict.admin.contacts.wants[key], `${lang} wants.${key}`);
    for (const key of WHATSAPP_INTENTS) assert.ok(dict.listings.waIntent.options[key].label, `${lang} waIntent.${key}`);
  }
});

// --- "Mon projet" reaches agencies ---------------------------------------

const project = (extra = {}) => ({
  id: 3, status: 'active', transactionType: 'location', city: 'Kinshasa', communes: [], budgetMin: 100, budgetMax: 200,
  bedroomsMin: 2, reasons: ['nouveau_travail'], lastLeadId: null, lastLeadAt: null, ...extra,
});
const customer = { phone: '243820000001', full_name: 'Kera' };

test('a city is enough to send; neither city nor commune still is not', () => {
  assert.equal(moveRequestBlocker(project()), null);
  assert.equal(moveRequestBlocker(project({ city: null, communes: ['Gombe'] })), null);
  assert.equal(moveRequestBlocker(project({ city: null })), 'communes');
  assert.equal(moveRequestBlocker(project({ city: 'Atlantis' })), 'communes');
  assert.equal(moveRequestBlocker(project({ transactionType: null })), 'transaction');
});

test('send blockers: paused or found, no number, sent less than 20 h ago', () => {
  assert.equal(projectSendBlocker(project(), customer), null);
  assert.equal(projectSendBlocker(project({ status: 'paused' }), customer), 'inactive');
  assert.equal(projectSendBlocker(project(), { phone: null }), 'phone');
  assert.equal(projectSendBlocker(project({ lastLeadAt: new Date(Date.now() - 60_000).toISOString() }), customer), 'recent');
  assert.equal(projectSendBlocker(project({ lastLeadAt: new Date(Date.now() - 21 * 3600_000).toISOString() }), customer), null);
  assert.equal(projectSendBlocker(null, customer), 'missing');
});

test('the lead names the city only when no commune was picked', () => {
  const wide = moveLeadPayload(project(), customer);
  assert.equal(wide.city, 'Kinshasa');
  assert.equal(wide.commune, undefined);
  assert.equal(wide.source, 'move-project');
  assert.equal(wide.waId, '243820000001');
  assert.equal(wide.priceMax, 200);
  const local = moveLeadPayload(project({ communes: ['Gombe', 'Ngaliema'] }), customer);
  assert.equal(local.city, undefined);
  assert.equal(local.commune, 'Gombe');
  assert.deepEqual(local.communes, ['Gombe', 'Ngaliema']);
});

test('a saved project is sent by itself, once; MOVE_AUTO_SEND=off brings back the tap only', () => {
  const saved = process.env.MOVE_AUTO_SEND;
  delete process.env.MOVE_AUTO_SEND;
  assert.equal(moveAutoSendEnabled(), true);
  process.env.MOVE_AUTO_SEND = 'off';
  assert.equal(moveAutoSendEnabled(), false);
  if (saved === undefined) delete process.env.MOVE_AUTO_SEND; else process.env.MOVE_AUTO_SEND = saved;
  const lib = read('lib/moveProjectRequest.js');
  assert.match(lib, /onlyIfNeverSent && project\?\.lastLeadId\) return \{ status: 'skipped', code: 'already-sent' \}/);
  assert.match(lib, /autoSendMoveProject[\s\S]*onlyIfNeverSent: true/);
  for (const file of ['app/(site)/compte/inscription/actions.js', 'app/(site)/compte/connexion/actions.js', 'app/(site)/compte/client/projet/actions.js']) {
    assert.match(read(file), /autoSendMoveProject\(/, file);
  }
  assert.match(read('lib/adminApi.js'), /\r?\n\s+city,\r?\n\s+\}\),/);
});

test('the console\'s « Envoyer aux agences » needs leads.manage and confirms first', () => {
  const action = read('app/admin/move-projects/actions.js');
  assert.match(action, /requireAdmin\('leads\.manage'\)/);
  assert.match(action, /recordAudit\(/);
  assert.match(read('app/admin/move-projects/SendProjectButton.js'), /sendConfirm/);
});

test('a send is reserved before the engine is called: the second of two sends at once gets nothing', async () => {
  enqueue([{ previous_at: null }]);
  const first = await claimMoveProjectSend(78, 10, 20 * 3600_000);
  assert.deepEqual(first, { claimed: true, previousAt: null });
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(CLAIM_SEND_SQL));
  assert.deepEqual(calls[0].values, [78, 72000, 10]);
  enqueue([]);
  assert.deepEqual(await claimMoveProjectSend(78, 10, 20 * 3600_000), { claimed: false, previousAt: null });
  assert.ok(CLAIM_SEND_SQL.includes('AND (last_lead_at IS NULL OR last_lead_at < NOW() - make_interval'));
  const lib = read('lib/moveProjectRequest.js');
  assert.ok(lib.indexOf('claimMoveProjectSend(') < lib.indexOf('createLead(moveLeadPayload'), 'reserved before the engine call');
  assert.ok(lib.includes('releaseMoveProjectSend(customerId, project.id, slot.previousAt)'));
});
