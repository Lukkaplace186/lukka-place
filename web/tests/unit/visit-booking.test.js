import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CLASH_MINUTES, MIN_LEAD_HOURS, VISIT_CART_MAX, VISIT_DAYS, VISIT_SLOT_TIMES,
  dayHasFreeSlot, slotIso, slotsForDay, tightPairs, validatePickedSlot, visitDays,
  calendarWeeks, dayClosed, normaliseAvailability, weekdayOf,
} from '@/lib/visitSlots';
import { addToCart, normaliseCart, removeFromCart } from '@/lib/visitCart';
import { customerToAgentMessage, groupCustomerVisits, visitTone, visitWhen } from '@/lib/customerAgenda';
import { canDeclareVisitOutcome, receiptWhatsAppHref } from '@/lib/visitOutcome';
import { buildVisitIcs } from '@/lib/visitAgenda';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Wednesday 1 October 2031, 08:30 in Kinshasa (07:30 UTC).
const NOW = new Date('2031-10-01T07:30:00Z');

test('fourteen Kinshasa days from today, a time every quarter of an hour from 08:00 to 20:00', () => {
  assert.equal(VISIT_SLOT_TIMES.length, 49);
  assert.deepEqual(VISIT_SLOT_TIMES.slice(0, 5), ['08:00', '08:15', '08:30', '08:45', '09:00']);
  assert.equal(VISIT_SLOT_TIMES.at(-1), '20:00');
  assert.equal(VISIT_DAYS, 14);
  const days = visitDays(NOW);
  assert.equal(days.length, 14);
  assert.equal(days[0], '2031-10-01');
  assert.equal(days[13], '2031-10-14');
  // 23:30 UTC is already the next day in Kinshasa.
  assert.equal(visitDays(new Date('2031-10-01T23:30:00Z'))[0], '2031-10-02');
});

test('a slot is Kinshasa wall time with its offset', () => {
  assert.equal(slotIso('2031-10-01', 9), '2031-10-01T09:00:00+01:00');
  assert.equal(Date.parse(slotIso('2031-10-01', 14)), Date.parse('2031-10-01T13:00:00Z'));
  assert.equal(slotIso('2031-10-01', '11:45'), '2031-10-01T11:45:00+01:00');
});

test('less than two hours ahead is greyed out; the rest of the day is free', () => {
  assert.equal(MIN_LEAD_HOURS, 2);
  const today = slotsForDay('2031-10-01', { now: NOW });
  // 08:30 now, so the cut-off is 10:30: everything before it is gone.
  const reasonAt = (time) => today.find((s) => s.time === time).reason;
  assert.equal(reasonAt('08:00'), 'past');
  assert.equal(reasonAt('10:15'), 'past');
  assert.equal(reasonAt('10:30'), null);
  assert.equal(reasonAt('20:00'), null);
  assert.ok(today.filter((s) => s.reason === 'past').every((s) => s.time < '10:30'));
});

test("a slot within an hour of the agent's confirmed visit is greyed out — nothing else is", () => {
  assert.equal(CLASH_MINUTES, 60);
  const busy = ['2031-10-02T13:30:00.000Z']; // 14:30 Kinshasa
  const slots = slotsForDay('2031-10-02', { now: NOW, busy });
  assert.deepEqual(
    slots.filter((s) => s.reason === 'busy').map((s) => s.time),
    ['13:45', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15'],
    'under an hour either side of 14:30; 13:30 and 15:30 are a full hour away',
  );
  assert.ok(slots.every((s) => s.reason === null || s.reason === 'busy'));
  assert.equal(dayHasFreeSlot('2031-10-02', { now: NOW, busy }), true);
  const allBusy = VISIT_SLOT_TIMES.map((time) => new Date(Date.parse(slotIso('2031-10-03', time))).toISOString());
  assert.equal(dayHasFreeSlot('2031-10-03', { now: NOW, busy: allBusy }), false);
});

test('the server accepts only a slot the picker could have offered', () => {
  assert.deepEqual(validatePickedSlot('2031-10-02T14:00:00+01:00', NOW), {
    iso: '2031-10-02T14:00:00+01:00',
    phrase: 'jeudi 2 octobre à 14h00',
  });
  assert.equal(validatePickedSlot('2031-10-02T11:45:00+01:00', NOW).phrase, 'jeudi 2 octobre à 11h45');
  assert.equal(validatePickedSlot('2031-10-02T11:50:00+01:00', NOW).error, 'invalid', 'not on a quarter of an hour');
  assert.equal(validatePickedSlot('2031-10-02T20:15:00+01:00', NOW).error, 'invalid', 'after the last time offered');
  assert.equal(validatePickedSlot('2031-10-02T07:45:00+01:00', NOW).error, 'invalid', 'before the first');
  assert.equal(validatePickedSlot('2031-10-02T14:00:00Z', NOW).error, 'invalid', 'must carry the Kinshasa offset');
  assert.equal(validatePickedSlot('2031-10-20T14:00:00+01:00', NOW).error, 'out_of_range');
  assert.equal(validatePickedSlot('2031-10-01T09:00:00+01:00', NOW).error, 'too_soon');
  assert.equal(validatePickedSlot('demain 14h', NOW).error, 'invalid');
});

test('two picks under an hour apart are flagged, not refused', () => {
  assert.deepEqual(tightPairs(['2031-10-02T09:00:00+01:00', '2031-10-02T09:00:00+01:00']).length, 1);
  assert.deepEqual(tightPairs(['2031-10-02T09:00:00+01:00', '2031-10-02T11:00:00+01:00']), []);
});

test('the visit form posts the picked instant; the action derives the phrase and passes the slot', () => {
  const card = read('components/VisitRequestDialog.js');
  assert.match(card, /<VisitSlotPicker propertyId=\{propertyId\} name="preferred_slot_at"/);
  assert.ok(!/name="requested_time"/.test(card), 'no free-text time field left');
  const action = read('app/(site)/listings/[id]/actions.js');
  assert.match(action, /validatePickedSlot\(pickedRaw\)/);
  assert.match(action, /preferredSlotAt: picked\?\.iso/);
});

// --- The calendar, agent days off, one booking dialog (2026-10-10) ---------------

test('the calendar lays the fourteen days out in Monday-first weeks', () => {
  // 1 October 2031 is a Wednesday: two blanks, then the days, then the tail.
  const weeks = calendarWeeks(NOW);
  assert.equal(weeks.length, 3);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.deepEqual(weeks[0], [null, null, '2031-10-01', '2031-10-02', '2031-10-03', '2031-10-04', '2031-10-05']);
  assert.deepEqual(weeks[2].filter(Boolean), ['2031-10-13', '2031-10-14']);
  assert.deepEqual(weeks.flat().filter(Boolean), visitDays(NOW));
  assert.equal(weekdayOf('2031-10-05'), 0, 'a Sunday in Kinshasa, whatever the runtime timezone');
});

test('a day the agent takes no visits is closed whole; an agent who set nothing blocks nothing', () => {
  const availability = { closedWeekdays: [0], blockedDates: ['2031-10-03'] };
  assert.equal(dayClosed('2031-10-05', availability), true, 'Sunday');
  assert.equal(dayClosed('2031-10-03', availability), true, 'a blocked date');
  assert.equal(dayClosed('2031-10-02', availability), false);
  assert.ok(slotsForDay('2031-10-03', { now: NOW, availability }).every((slot) => slot.reason === 'closed'));
  assert.equal(dayHasFreeSlot('2031-10-05', { now: NOW, availability }), false);
  assert.equal(dayHasFreeSlot('2031-10-02', { now: NOW, availability }), true);
  // "Too soon" still wins on today: the reason shown is the one that is true first.
  assert.equal(slotsForDay('2031-10-01', { now: NOW, availability: { closedWeekdays: [3] } })[0].reason, 'past');
  for (const none of [null, undefined, {}, { closedWeekdays: 'x', blockedDates: null }]) {
    assert.equal(dayClosed('2031-10-05', none), false);
  }
});

test('availability is cleaned before it is trusted', () => {
  assert.deepEqual(
    normaliseAvailability({ closedWeekdays: [6, '0', 0, 7, -1, 2.5, 'x'], blockedDates: ['2031-10-03T00:00:00Z', 'nope', '2031-10-03', 20311004] }),
    { closedWeekdays: [0, 6], blockedDates: ['2031-10-03'] },
  );
});

test('every surface books through the one dialog, and a blocked day is refused server-side', () => {
  const board = read('app/(site)/compte/client/favoris/FavoritesBoard.js');
  assert.match(board, /<VisitRequestDialog[\s\S]*returnTo="visites"/, 'the saved-listings board opens the calendar');
  assert.ok(!/planifier une visite pour ce bien/i.test(board), 'no hand-built wa.me visit message');
  assert.ok(!/whatsappNumber/.test(board), 'no central-number prop: routing is resolveWhatsAppRouting');
  assert.match(board, /resolveWhatsAppRouting\(listing\)/);
  assert.match(read('components/EnquiryCard.js'), /<VisitRequestDialog propertyId=\{propertyId\} open=\{open\}/);

  const action = read('app/(site)/listings/[id]/actions.js');
  assert.match(action, /formData\.get\('return_to'\) === 'visites' \? '\/compte\/client\/visites' : `\/listings\/\$\{propertyId\}`/, 'two fixed destinations, never a path from the form');
  assert.match(action, /dayClosed\(kinshasaDayKey\(picked\.iso\), await getListingAvailability\(listing\.id\)\)/);
  assert.match(read('app/(site)/listings/visitBatchActions.js'), /dayClosed\(kinshasaDayKey\(slot\.iso\), await getListingAvailability\(listing\.id\)\)/);
});

test('availability reads keep the public gate and never throw into the calendar', async () => {
  const lib = read('lib/agentAvailability.js');
  assert.match(lib, /WHERE p\.id = \$1 AND p\.status = 1 AND p\.approve_status = 1/);
  assert.match(lib, /agent_id = \$1/, 'the agent page reads its own row only');
  assert.match(lib, /ON CONFLICT \(agent_id\) DO UPDATE/);
  const action = read('app/compte/agent/visitAvailabilityActions.js');
  assert.match(action, /const agentId = await getCurrentAgentId\(\);/, 'the session decides whose settings are written');
  assert.ok(!/input\?\.agentId|input\.agent_id/.test(action));
  const migration = readFileSync(new URL('../../../migrations/20261010_agent_visit_availability.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_visit_availability/);
  assert.match(migration, /REVOKE ALL ON agent_visit_availability/);
});

// --- "Mes visites" ----------------------------------------------------------------

test('the cart holds at most four distinct listings and only display facts', () => {
  assert.equal(VISIT_CART_MAX, 4);
  let cart = [];
  for (const id of [1, 2, 3, 4]) cart = addToCart(cart, { id, title: `Bien ${id}`, agent_phone: '243000' }).cart;
  assert.equal(cart.length, 4);
  assert.ok(!('agent_phone' in cart[0]), 'nothing but display facts is kept');
  assert.equal(addToCart(cart, { id: 5 }).reason, 'full');
  assert.equal(addToCart(cart, { id: 2 }).reason, 'present');
  assert.deepEqual(removeFromCart(cart, 2).map((i) => i.id), [1, 3, 4]);
  assert.deepEqual(normaliseCart([{ id: 'x' }, { id: 7 }, { id: 7 }]).map((i) => i.id), [7]);
});

test('the batch action re-reads every listing under the public gate and re-checks every slot', () => {
  const action = read('app/(site)/listings/visitBatchActions.js');
  assert.match(action, /await getListingById\(id\)/);
  assert.match(action, /validatePickedSlot\(item\?\.slot, now\)/);
  assert.match(action, /err\?\.status === 429/);
});

// --- the customer's agenda ------------------------------------------------------------

const listing = { id: 310, title: 'Appartement Kintambo', reference: 'LKP-9', agency_name: 'Makam Immo' };
const row = (viewing) => ({ lead: { id: 1 }, listing, viewings: [viewing] });

test('a PENDING pick shows on its day as requested; an agreed slot as confirmed; free text is "heure à préciser"', () => {
  const groups = groupCustomerVisits([
    row({ id: 1, status: 'PENDING', preferred_slot_at: '2031-10-01T13:00:00.000Z' }),
    row({ id: 2, status: 'CONFIRMED', scheduled_at: '2031-10-02T08:00:00.000Z' }),
    row({ id: 3, status: 'PENDING', requested_time: 'samedi matin' }),
    row({ id: 4, status: 'CONFIRMED', scheduled_at: '2031-10-05T08:00:00.000Z' }),
    row({ id: 5, status: 'CANCELLED', scheduled_at: '2031-09-20T08:00:00.000Z' }),
  ], NOW);
  assert.deepEqual(groups.today.map((v) => [v.id, v.agreed, v.tone]), [[1, false, 'pending']]);
  assert.deepEqual(groups.tomorrow.map((v) => [v.id, v.agreed, v.tone]), [[2, true, 'confirmed']]);
  assert.deepEqual(groups.unscheduled.map((v) => v.id), [3]);
  assert.deepEqual(groups.upcoming.map((v) => v.id), [4]);
  assert.deepEqual(groups.past.map((v) => v.id), [5]);
});

test("a slot the agent proposed in words is never placed on the customer's old pick", () => {
  const rescheduled = { status: 'RESCHEDULED', preferred_slot_at: '2031-10-01T13:00:00.000Z', scheduled_at: '2031-10-03T13:00:00.000Z', requested_time: 'vendredi 14h' };
  assert.deepEqual(visitWhen(rescheduled), { at: null, agreed: false });
  assert.equal(visitTone(rescheduled), 'rescheduled');
  assert.equal(visitTone({ status: 'CONFIRMED', agent_visit_outcome: 'DONE' }), 'done');
});

test("the customer's WhatsApp to the agent names the visit and the listing, in French", () => {
  assert.equal(
    customerToAgentMessage({ agentName: 'Makam Immo', phrase: 'jeudi 2 octobre à 09h00', listing }),
    'Bonjour Makam, concernant notre visite jeudi 2 octobre à 09h00 pour Réf. LKP-9 (via Lukka Place)…',
  );
});

test("the customer's calendar file names the agent, not a client", () => {
  const ics = buildVisitIcs({ id: 9, scheduledAt: '2031-10-02T08:00:00Z', title: 'Appartement', customerName: 'Makam Immo', contactLabel: 'Agent', now: NOW });
  assert.match(ics, /Agent : Makam Immo/);
  assert.ok(!/Client :/.test(ics));
  const route = read('app/(site)/compte/client/visites/[id]/agenda.ics/route.js');
  assert.match(route, /viewing\.status !== 'CONFIRMED' \|\| !found\.viewing\.scheduled_at/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
});

// --- bon de visite (agent side) ------------------------------------------------------

test('"Visite effectuée" only on a confirmed visit whose slot has started, once', () => {
  const base = { status: 'CONFIRMED', scheduled_at: '2031-10-01T07:00:00Z' };
  assert.equal(canDeclareVisitOutcome(base, NOW), true);
  assert.equal(canDeclareVisitOutcome({ ...base, scheduled_at: '2031-10-01T09:00:00Z' }, NOW), false, 'not yet');
  assert.equal(canDeclareVisitOutcome({ ...base, agent_visit_outcome: 'DONE' }, NOW), false, 'already answered');
  assert.equal(canDeclareVisitOutcome({ ...base, status: 'PENDING' }, NOW), false);
  assert.equal(receiptWhatsAppHref('+243 990 111 222', 'Merci'), 'https://wa.me/243990111222?text=Merci');
});

test('the agent agenda shows what still needs confirming, with the Demandes card', () => {
  const page = read('app/compte/agent/visites/page.js');
  assert.match(page, /status: 'PENDING'/);
  assert.match(page, /status: 'RESCHEDULED'/);
  assert.match(page, /<AgentVisitRequestCard/);
  assert.match(page, /href=\{`tel:\+\$\{phone\}`\}/);
  assert.match(page, /canDeclareVisitOutcome\(visit, now\) && <AgentVisitDoneButtons/);
});

test('storefront visit components never call useToast — the site layout has no ToastProvider', () => {
  for (const file of ['components/AddToVisitCartButton.js', 'components/VisitCartSheet.js', 'components/VisitSlotPicker.js', 'components/EnquiryCard.js']) {
    assert.ok(!/useToast\(/.test(read(file)), `${file} would crash the listing page`);
  }
  assert.ok(!/ToastProvider/.test(read('app/(site)/layout.js')), 'if the site layout gains one, this guard can go');
});
