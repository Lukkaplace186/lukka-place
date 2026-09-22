import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgentTodo, TODO_KINDS, TODO_SEE_ALL_HREF } from '@/lib/agentTodo';
import {
  buildVisitIcs,
  confirmPrefill,
  directionsUrl,
  fromKinshasaInputs,
  groupAgenda,
  kinshasaDayKey,
  slotPhraseFr,
  toKinshasaInputs,
  todaysRemainingVisits,
  validateAgreedSlot,
  visitSlotAt,
} from '@/lib/visitAgenda';
import { calls, reset, normalizeSql } from '../support/fakePool.js';
import { getListingPlaces } from '@/lib/agentAgenda';

// Monday 2026-09-21, 09:00 in Kinshasa (08:00 UTC).
const NOW = new Date('2026-09-21T08:00:00Z');

const visit = (id, over = {}) => ({
  id,
  status: 'PENDING',
  created_at: '2026-09-20 10:00:00',
  requested_time: null,
  requested_slot_at: null,
  scheduled_at: null,
  lead_name: `Client ${id}`,
  lead_wa_id: '243990000000',
  ...over,
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test('ranking: overdue visits, then open visits by age, then new leads, then listings', () => {
  const { items } = buildAgentTodo({
    now: NOW,
    limit: 50,
    visits: [
      visit(1, { created_at: '2026-09-20 12:00:00' }),
      visit(2, { created_at: '2026-09-19 12:00:00' }),
      visit(3, { requested_slot_at: '2026-09-20T13:00:00.000Z', created_at: '2026-09-19 18:00:00' }), // passed
      visit(4, { status: 'RESCHEDULED', scheduled_at: '2026-09-21T07:00:00.000Z' }), // agent's own proposal, passed
      visit(5, { status: 'CONFIRMED' }), // not a to-do
      visit(6, { status: 'DECLINED' }),
    ],
    leads: [
      { id: 10, status: 'NEW', created_at: '2026-09-21 07:00:00' },
      { id: 11, status: 'NEW', created_at: '2026-09-18 07:00:00' },
      { id: 12, status: 'CONTACTED', created_at: '2026-09-17 07:00:00' },
    ],
    listingsToConfirm: [
      { id: 20, title: 'A', daysSince: 10 },
      { id: 21, title: 'B', daysSince: 40 },
    ],
    incompleteListings: [
      { id: 30, title: 'C', gaps: ['photos'] },
      { id: 31, title: 'D', gaps: ['photos', 'commune', 'prix'] },
    ],
  });

  assert.deepEqual(
    items.map((i) => i.key),
    [
      'visit-3', // slot passed yesterday
      'visit-4', // slot passed this morning
      'visit-2', 'visit-1', // open, oldest request first
      'lead-11', 'lead-10', // NEW only, oldest first
      'listing-confirm-21', 'listing-confirm-20', // longest unconfirmed first
      'listing-incomplete-31', 'listing-incomplete-30', // most gaps first
    ],
  );
});

test('production shape: 6 unanswered visits, 3 past their time → 3 overdue on top, all asking for a new slot', () => {
  const visits = [1, 2, 3, 4, 5, 6].map((id) =>
    visit(id, {
      created_at: `2026-09-1${id + 3} 10:00:00`,
      // Slots that passed within the last 48h: still "en retard", not stale.
      requested_slot_at: id <= 3 ? `2026-09-20T0${id + 5}:00:00.000Z` : null,
    }),
  );
  const todo = buildAgentTodo({ visits, now: NOW, limit: 6 });
  assert.equal(todo.total, 6);
  assert.equal(todo.overdueCount, 3);
  assert.deepEqual(todo.visible.slice(0, 3).map((i) => i.id), [1, 2, 3]);
  for (const item of todo.visible.slice(0, 3)) assert.equal(item.primary.type, 'propose-slot');
  for (const item of todo.visible.slice(3)) {
    assert.equal(item.primary.type, 'confirm-visit');
    assert.equal(item.primary.prefill, null, 'no readable time → the form opens, nothing is guessed');
  }
});

test('a visit overdue for more than 48h, or asked a week ago with no time, drops below new leads as "relancer ou clore"', () => {
  const todo = buildAgentTodo({
    now: NOW,
    limit: 50,
    visits: [
      visit(1, { requested_slot_at: '2026-09-15T09:00:00.000Z', created_at: '2026-09-13 10:00:00' }), // 6 days past
      visit(2, { created_at: '2026-09-10 10:00:00' }), // 11 days, no time
      visit(3, { requested_slot_at: '2026-09-20T13:00:00.000Z' }), // 19h past: still overdue
    ],
    leads: [{ id: 10, status: 'NEW', created_at: '2026-09-21 07:00:00' }],
  });
  assert.deepEqual(todo.items.map((i) => i.key), ['visit-3', 'lead-10', 'visit-2', 'visit-1']);
  assert.equal(todo.overdueCount, 1, 'a stale row is not counted "en retard"');
  const stale = todo.items.filter((i) => i.stale);
  assert.equal(stale.length, 2);
  for (const item of stale) {
    assert.equal(item.primary.type, 'propose-slot');
    assert.deepEqual(item.secondary, { type: 'close-visit', href: '/compte/agent/demandes?tab=visites' });
  }
});

test('one row per request: the lead behind a visit is folded into it, and a bare number borrows the name', () => {
  const todo = buildAgentTodo({
    now: NOW,
    limit: 50,
    visits: [
      visit(1, { lead_id: 50, lead_name: 'Mimbo', lead_wa_id: '447932673460', property_id: 286 }),
      visit(2, { lead_id: 51, lead_name: 'Henoc Mimbo', lead_wa_id: '447932673460', property_id: 290 }),
    ],
    leads: [
      { id: 50, status: 'NEW', wa_id: '447932673460', name: '447932673460', property_id: 286 }, // same ask as visit 1
      { id: 52, status: 'NEW', wa_id: '447932673460', name: null, property_id: 290 }, // same number + listing as visit 2
      { id: 53, status: 'NEW', wa_id: '447932673460', name: null, property_id: 999 }, // a different ask
      { id: 54, status: 'NEW', wa_id: '243811111111', name: 'Aline', property_id: 286 },
    ],
  });
  assert.deepEqual(todo.items.map((i) => i.key), ['visit-1', 'visit-2', 'lead-53', 'lead-54']);
  const byKey = Object.fromEntries(todo.items.map((i) => [i.key, i]));
  assert.equal(byKey['visit-1'].customerName, 'Mimbo');
  assert.equal(byKey['lead-53'].customerName, 'Mimbo', 'the number is known by a name elsewhere');
  assert.equal(byKey['lead-54'].customerName, 'Aline');
});

test('a visit whose slot is still ahead confirms in one tap with that slot', () => {
  const [item] = buildAgentTodo({
    now: NOW,
    visits: [visit(7, { requested_slot_at: '2026-09-23T13:00:00.000Z' })],
  }).items;
  assert.equal(item.overdue, false);
  assert.deepEqual(item.primary, { type: 'confirm-visit', prefill: '2026-09-23T13:00:00.000Z' });
});

test("a RESCHEDULED visit ignores the customer's old phrase and uses the agent's own proposal", () => {
  const v = visit(8, { status: 'RESCHEDULED', requested_slot_at: '2026-09-20T13:00:00.000Z', scheduled_at: null });
  assert.equal(visitSlotAt(v), null);
  const [item] = buildAgentTodo({ now: NOW, visits: [v] }).items;
  assert.equal(item.overdue, false);
  assert.equal(item.primary.prefill, null);
});

test('the cap keeps the ranking and counts what is hidden, per kind, for "voir tout"', () => {
  const visits = Array.from({ length: 5 }, (_, i) => visit(i + 1));
  const leads = Array.from({ length: 3 }, (_, i) => ({ id: 100 + i, status: 'NEW', created_at: '2026-09-20 10:00:00' }));
  const todo = buildAgentTodo({ visits, leads, listingsToConfirm: [{ id: 9, daysSince: 3 }], now: NOW });
  assert.equal(todo.visible.length, 4, 'four rows on the overview, the rest behind "voir tout"');
  assert.equal(todo.total, 9);
  assert.deepEqual(todo.hiddenByKind, { [TODO_KINDS.VISIT]: 1, [TODO_KINDS.LEAD]: 3, [TODO_KINDS.LISTING_CONFIRM]: 1 });
  assert.equal(TODO_SEE_ALL_HREF[TODO_KINDS.VISIT], '/compte/agent/demandes?tab=visites');
});

test('listing items link to the listing, leads to their focused inbox row; duplicates are dropped', () => {
  const todo = buildAgentTodo({
    now: NOW,
    leads: [{ id: 5, status: 'NEW' }, { id: 5, status: 'NEW' }],
    listingsToConfirm: [{ id: 42, title: 'T', lastConfirmedAt: null, daysSince: null }],
    incompleteListings: [{ id: 43, title: 'U', gaps: 'not-an-array' }],
  });
  assert.equal(todo.total, 3);
  const byKind = Object.fromEntries(todo.items.map((i) => [i.kind, i]));
  assert.deepEqual(byKind.lead.primary, { type: 'open-lead', href: '/compte/agent/demandes?lead=5' });
  assert.deepEqual(byKind['listing-confirm'].primary, { type: 'confirm-availability', href: '/compte/agent/biens/42/edit' });
  assert.deepEqual(byKind['listing-incomplete'].primary, { type: 'complete', href: '/compte/agent/biens/43/edit' });
  assert.deepEqual(byKind['listing-incomplete'].listing.gaps, []);
});

test('nothing to do is an empty list, not an error', () => {
  const todo = buildAgentTodo({ now: NOW });
  assert.deepEqual([todo.total, todo.visible.length, todo.overdueCount], [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// Time: Kinshasa wall clock, whatever the device says
// ---------------------------------------------------------------------------

test('form values are Kinshasa time and round-trip to an ISO instant with +01:00', () => {
  assert.deepEqual(toKinshasaInputs('2026-09-26T13:30:00.000Z'), { date: '2026-09-26', time: '14:30' });
  assert.equal(fromKinshasaInputs('2026-09-26', '14:30'), '2026-09-26T14:30:00+01:00');
  assert.equal(new Date(fromKinshasaInputs('2026-09-26', '14:30')).toISOString(), '2026-09-26T13:30:00.000Z');
  // 23:30 in Kinshasa is still that day, not the next UTC day.
  assert.equal(kinshasaDayKey('2026-09-26T22:30:00Z'), '2026-09-26');
  assert.equal(kinshasaDayKey('2026-09-26T23:30:00Z'), '2026-09-27');
});

test('a day with no hour is refused, and so is a date that does not exist', () => {
  assert.equal(fromKinshasaInputs('2026-09-26', ''), null);
  assert.equal(fromKinshasaInputs('', '14:00'), null);
  assert.equal(fromKinshasaInputs('2026-02-31', '10:00'), null);
  assert.equal(fromKinshasaInputs('2026-09-26', '25:00'), null);
});

test('the Server Action accepts only a future ISO instant with an offset', () => {
  assert.deepEqual(validateAgreedSlot('2026-09-26T14:30:00+01:00', NOW), { value: '2026-09-26T14:30:00+01:00' });
  assert.equal(validateAgreedSlot('', NOW).errorKey, 'agent.agenda.confirm.timeRequired');
  assert.equal(validateAgreedSlot('2026-09-26', NOW).errorKey, 'agent.agenda.confirm.timeInvalid');
  assert.equal(validateAgreedSlot('2026-09-26T14:30', NOW).errorKey, 'agent.agenda.confirm.timeInvalid', 'no offset');
  assert.equal(validateAgreedSlot('2026-09-20T14:30:00+01:00', NOW).errorKey, 'agent.agenda.confirm.timeInPast');
});

test('the confirm form only prefills a slot that is still ahead', () => {
  assert.equal(confirmPrefill(visit(1, { requested_slot_at: '2026-09-22T09:00:00.000Z' }), NOW), '2026-09-22T09:00:00.000Z');
  assert.equal(confirmPrefill(visit(1, { requested_slot_at: '2026-09-20T09:00:00.000Z' }), NOW), null);
  assert.equal(confirmPrefill(visit(1), NOW), null);
});

test("a proposed slot is written in the engine's own French shape, with a computed weekday", () => {
  // 2026-09-27 is a Sunday; the engine's parser trusts the weekday over the date.
  assert.equal(slotPhraseFr('2026-09-27T13:30:00.000Z'), 'dimanche 27 septembre à 14h30');
  assert.equal(slotPhraseFr('2026-09-26T08:05:00.000Z'), 'samedi 26 septembre à 09h05');
});

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

test('the agenda places only CONFIRMED visits with an agreed time on a day', () => {
  const visits = [
    visit(1, { status: 'CONFIRMED', scheduled_at: '2026-09-21T13:00:00.000Z' }), // today 14h
    visit(2, { status: 'CONFIRMED', scheduled_at: '2026-09-21T07:30:00.000Z' }), // today 08h30 (passed)
    visit(3, { status: 'CONFIRMED', scheduled_at: '2026-09-23T09:00:00.000Z' }),
    visit(4, { status: 'CONFIRMED', scheduled_at: '2026-09-18T09:00:00.000Z' }), // past
    visit(5, { status: 'CONFIRMED', requested_time: 'samedi matin' }), // no agreed time
    visit(6, { status: 'PENDING', scheduled_at: '2026-09-22T09:00:00.000Z' }), // not agreed
  ];
  const agenda = groupAgenda(visits, NOW);
  assert.deepEqual(agenda.days.map((d) => [d.key, d.visits.map((v) => v.id)]), [
    ['2026-09-21', [2, 1]],
    ['2026-09-23', [3]],
  ]);
  assert.equal(agenda.days[0].isToday, true);
  assert.deepEqual(agenda.past.map((v) => v.id), [4]);
  assert.deepEqual(agenda.unscheduled.map((v) => v.id), [5]);
  assert.deepEqual(agenda.week.map((d) => d.count), [2, 0, 1, 0, 0, 0, 0]);
  assert.equal(agenda.week[0].key, '2026-09-21');
  // Morning reminder: today's visits not already long finished.
  assert.deepEqual(todaysRemainingVisits(visits, NOW).map((v) => v.id), [2, 1]);
  assert.deepEqual(todaysRemainingVisits(visits, new Date('2026-09-21T10:00:00Z')).map((v) => v.id), [1]);
});

test('directions use real coordinates, else the address text, and never invent a point', () => {
  assert.equal(
    directionsUrl({ lat: '-4.3317', lng: '15.3139', address: 'x' }),
    'https://www.google.com/maps/search/?api=1&query=-4.3317%2C15.3139',
  );
  assert.equal(
    directionsUrl({ lat: null, lng: null, address: '12 av. Kasa-Vubu', quartier: 'Matonge', commune: 'Kalamu' }),
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('12 av. Kasa-Vubu, Matonge, Kalamu, Kinshasa')}`,
  );
  assert.equal(directionsUrl({ lat: '0', lng: '0', quartier: 'Bandal', commune: 'Bandal' }).includes('Bandal%2C%20Kinshasa'), true);
  assert.equal(directionsUrl({ lat: 'abc', lng: null }), null);
  assert.equal(directionsUrl({}), null);
});

test('the .ics is a valid single event in UTC, escaped, folded, with no invented end time', () => {
  const ics = buildVisitIcs({
    id: 12,
    scheduledAt: '2026-09-26T13:30:00.000Z',
    title: 'Appartement 2 chambres; Gombe, vue fleuve',
    customerName: 'Henoc Mimbo',
    customerPhone: '243990111222',
    requestedTime: 'samedi après-midi',
    place: 'Av. de la Justice, Gombe',
    directions: 'https://www.google.com/maps/search/?api=1&query=Gombe',
    listingUrl: 'https://lukkaplace.com/listings/12',
    dashboardUrl: 'https://lukkaplace.com/compte/agent/visites',
    now: NOW,
  });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /\r\nDTSTART:20260926T133000Z\r\n/);
  assert.match(ics, /\r\nUID:viewing-request-12@lukkaplace\.com\r\n/);
  assert.doesNotMatch(ics, /DTEND|DURATION:/, 'nobody agreed how long a visit lasts');
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /SUMMARY:Visite · Appartement 2 chambres\\; Gombe\\, vue fleuve/);
  assert.match(unfolded, /Téléphone : \+243990111222/);
  for (const line of ics.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line over 75 octets: ${line}`);
  }
  assert.equal(buildVisitIcs({ id: 1, scheduledAt: null }), null, 'no agreed time, no file');
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("listing places are read from the agent's OWN listings only", async () => {
  reset();
  await getListingPlaces(7, [3, '3', 4, 'x']);
  const sql = normalizeSql(calls[0].text);
  assert.match(sql, /WHERE p\.agent_id = \$1 AND p\.id = ANY\(\$2::bigint\[\]\)/);
  assert.deepEqual(calls[0].values, [7, [3, 4]]);
  reset();
  const empty = await getListingPlaces(7, []);
  assert.equal(empty.size, 0);
  assert.equal(calls.length, 0, 'no ids, no query');
});

test('a dashboard confirmation must carry the agreed instant, through the existing write path', () => {
  const actions = readFileSync(new URL('../../app/compte/agent/actions.js', import.meta.url), 'utf8');
  assert.match(actions, /validateAgreedSlot\(formData\.get\('scheduled_at'\)\)/);
  assert.match(actions, /respondToViewingRequest\(viewingRequestId, \{ agentId, status, requestedTime, scheduledAt \}\)/);
  const route = readFileSync(new URL('../../app/compte/agent/visites/[id]/agenda.ics/route.js', import.meta.url), 'utf8');
  assert.match(route, /findOwnedViewingRequest\(agentId, viewingRequestId, \{ status: 'CONFIRMED' \}\)/);
  assert.match(actions, /findOwnedViewingRequest\(agentId, viewingRequestId\)/, 'one ownership rule for answers and the .ics');
  const loader = readFileSync(new URL('../../lib/agentTodoLoader.js', import.meta.url), 'utf8');
  // Both listing sources are wired, each degrading to [] on its own.
  assert.match(loader, /getListingsNeedingConfirmation\(agentId, \{ limit: 20, now \}\)\.catch\(\(\) => \[\]\)/);
  assert.match(loader, /getIncompleteListings\(agentId, \{ limit: 20 \}\)\.catch\(\(\) => \[\]\)/);
});
