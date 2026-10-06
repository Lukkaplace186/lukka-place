import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  entryCostParts,
  needsCheckin,
  homeVisitInbox,
  requestRows,
  freshAlertListings,
  firstName,
  proposedSlotAt,
  proposalExpired,
  isAwaitingCustomer,
} from '@/lib/clientPortalView';
import { groupCustomerVisits } from '@/lib/customerAgenda';

/**
 * The Espace Client redesign (2026-10-05, prototype in
 * web/Design/client-portal-prototype.html): Accueil as an actionable inbox,
 * five tabs with a phone bottom bar, entry costs shown separately.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

test('entry costs are three separate facts, never one summed "Garantie"', () => {
  assert.deepEqual(
    entryCostParts({ purpose: 'rent', deposit_months: 3, advance_months: 1, commission_months: 1 }),
    [{ key: 'deposit', months: 3 }, { key: 'advance', months: 1 }, { key: 'commission', months: 1 }],
  );
  assert.deepEqual(entryCostParts({ purpose: 'rent', deposit_months: '3', advance_months: null }), [{ key: 'deposit', months: 3 }], 'NULL = not stated, left out');
  assert.deepEqual(entryCostParts({ purpose: 'rent', deposit_months: 3, commission_months: 0 }), [{ key: 'deposit', months: 3 }, { key: 'commission', months: 0 }], '0 = none required, kept');
  assert.deepEqual(entryCostParts({ purpose: 'sale', deposit_months: 3 }), [], 'a sale has no entry costs');
  assert.deepEqual(entryCostParts(null), []);
});

const NOW = new Date('2026-10-06T09:00:00Z');
const viewing = (over) => ({ id: 1, lead_id: 10, status: 'PENDING', ...over });

test('Accueil shows what waits on the customer: a proposed slot, a visit to rate, the next visit', () => {
  const inquiries = [{
    lead: { id: 10 },
    listing: { id: 5, title: 'Appartement à Gombe' },
    viewings: [
      viewing({ id: 1, status: 'RESCHEDULED', requested_time: 'samedi 11 octobre à 15h00' }),
      viewing({ id: 6, status: 'RESCHEDULED', requested_time: 'mercredi 30 septembre à 09h30', scheduled_at: '2026-09-23T08:30:00Z' }),
      viewing({ id: 2, status: 'CONFIRMED', scheduled_at: '2026-10-08T09:00:00Z' }),
      viewing({ id: 3, status: 'CONFIRMED', scheduled_at: '2026-10-02T13:00:00Z' }),
      viewing({ id: 4, status: 'CONFIRMED', scheduled_at: '2026-10-01T13:00:00Z', checkin_response: 'GOOD' }),
      viewing({ id: 5, status: 'PENDING', requested_time: 'jeudi matin' }),
    ],
  }];
  const { answer, checkin, next } = homeVisitInbox(groupCustomerVisits(inquiries, NOW), NOW);
  assert.deepEqual(answer.map((v) => v.id), [1]);
  assert.deepEqual(checkin.map((v) => v.id), [3], 'a rated visit is not asked again');
  assert.equal(next?.id, 2);
});

test('an agent proposal is read from its own phrase, and a passed one is not offered for acceptance', () => {
  assert.equal(proposedSlotAt('samedi 11 octobre à 15h00', NOW)?.toISOString(), '2026-10-11T14:00:00.000Z', 'Kinshasa is UTC+1');
  assert.equal(proposedSlotAt('mercredi 30 septembre à 09h30', NOW)?.toISOString(), '2026-09-30T08:30:00.000Z');
  assert.equal(proposedSlotAt('mardi 6 janvier à 9h', NOW)?.toISOString(), '2027-01-06T08:00:00.000Z', 'the nearest year');
  assert.equal(proposedSlotAt('lundi 1er décembre à 10h00', NOW)?.toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(proposedSlotAt('demain matin', NOW), null, 'free text is never guessed');
  assert.equal(proposedSlotAt('31 septembre à 10h00', NOW), null);
  // Production row: proposal "30 septembre", stale scheduled_at 23 September.
  const stale = { status: 'RESCHEDULED', requestedTime: 'mercredi 30 septembre à 09h30' };
  assert.equal(proposalExpired(stale, NOW), true);
  assert.equal(isAwaitingCustomer(stale, NOW), false);
  assert.equal(isAwaitingCustomer({ status: 'RESCHEDULED', requestedTime: 'samedi 11 octobre à 15h00' }, NOW), true);
  assert.equal(isAwaitingCustomer({ status: 'RESCHEDULED', requestedTime: 'quand vous voulez' }, NOW), true, 'unparseable: still the customer\'s to answer');
});

test('a visit is rated only once it has really happened, and only when agreed', () => {
  assert.equal(needsCheckin({ status: 'CONFIRMED', agreed: true, at: '2026-10-06T08:00:00Z' }, NOW), true);
  assert.equal(needsCheckin({ status: 'CONFIRMED', agreed: true, at: '2026-10-06T10:00:00Z' }, NOW), false, 'not before the slot');
  assert.equal(needsCheckin({ status: 'PENDING', agreed: false, at: '2026-10-05T10:00:00Z' }, NOW), false, 'a pick nobody agreed is not a visit');
  assert.equal(needsCheckin({ status: 'CONFIRMED', agreed: true, at: '2026-10-05T10:00:00Z', checkinResponse: 'BAD' }, NOW), false);
});

test('request rows are the customer\'s own searches, not visit requests', () => {
  const rows = requestRows([
    { lead: { id: 1, property_id: null, requirements_summary: 'Location · Gombe' }, listing: null, proposals: [{}, {}], viewings: [] },
    { lead: { id: 2, property_id: 44 }, listing: { id: 44 }, proposals: [], viewings: [{}] },
    { lead: { id: 3, property_id: null }, listing: null, proposals: [], viewings: [] },
    { lead: { id: 4, property_id: null, source: 'developer-application' }, listing: null, proposals: [], viewings: [] },
  ]);
  assert.deepEqual(rows.map((r) => [r.id, r.proposals]), [[1, 2], [3, 0]]);
});

test('the alert rail lists each new listing once, newest first', () => {
  const a = { id: '7', created_at: '2026-10-05' };
  const b = { id: 8, created_at: '2026-10-06' };
  const { listings, total } = freshAlertListings([{ newListings: [a] }, { newListings: [b, { id: 7, created_at: '2026-10-05' }] }]);
  assert.deepEqual(listings.map((l) => String(l.id)), ['8', '7']);
  assert.equal(total, 2);
});

test('Accueil never stamps saved searches viewed (only the Alertes tab does)', () => {
  const home = read('app/(site)/compte/client/page.js');
  assert.doesNotMatch(home, /touchSavedSearchesViewed/);
  assert.match(read('app/(site)/compte/client/favoris/page.js'), /touchSavedSearchesViewed/);
});

test('old ?tab= links still land on Enregistrés', () => {
  const home = read('app/(site)/compte/client/page.js');
  assert.match(home, /redirect\('\/compte\/client\/favoris\?tab=alertes'\)/);
  assert.match(read('next.config.mjs'), /source: '\/compte\/client',\s+has: \[\{ type: 'query', key: 'tab'/, 'a real 307 for links already sent');
  assert.match(read('app/(site)/compte/client/alertes/page.js'), /redirect\('\/compte\/client\/favoris\?tab=alertes'\)/);
  assert.match(read('app/(site)/mises-a-jour/page.js'), /\/compte\/client\/favoris\?tab=alertes/);
  assert.match(read('lib/searchAlertSweep.js'), /\/compte\/client\/favoris\?tab=alertes/, 'the link in every WhatsApp alert');
});

test('five tabs, a phone bottom bar, counts as grey totals', () => {
  const tabs = read('app/(site)/compte/client/ClientPortalTabs.js');
  assert.match(tabs, /grid-cols-5/);
  assert.match(tabs, /lg:hidden/);
  assert.doesNotMatch(tabs, /bg-blue[^-\w].*\{count\}/, 'a total is not an alert');
  assert.match(read('components/Footer.js'), /pb-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\]/, 'the portal footer clears the fixed bar');
});

test('first name for the greeting, never a phone-shaped string from the name field', () => {
  assert.equal(firstName('Grace Ilunga'), 'Grace');
  assert.equal(firstName('  '), null);
  assert.equal(firstName(null), null);
});

test('every new label exists in both languages', async () => {
  const { default: fr } = await import('@/lib/i18n/fr.json', { with: { type: 'json' } });
  const { default: en } = await import('@/lib/i18n/en.json', { with: { type: 'json' } });
  const keys = [
    'account.portal.nav.home', 'account.portal.nav.saved', 'account.portal.nav.visits', 'account.portal.nav.requests', 'account.portal.nav.profile',
    'account.home.answerTitle', 'account.home.nextVisit', 'account.home.newForAlerts', 'account.home.quick.findForMe',
    'account.agenda.band.proposed', 'account.agenda.groups.answer', 'account.agenda.checkin.AGENT_ABSENT',
    'account.entry.deposit', 'account.entry.advance', 'account.entry.commission',
    'account.profile.groups.app', 'account.profile.language',
  ];
  for (const key of keys) {
    for (const dict of [fr, en]) {
      assert.ok(key.split('.').reduce((node, part) => node?.[part], dict) != null, `${key} is missing`);
    }
  }
  assert.equal(fr.account.portal.nav.home, 'Accueil');
  assert.equal(fr.account.entry.deposit.other, 'Garantie {count} mois');
});
