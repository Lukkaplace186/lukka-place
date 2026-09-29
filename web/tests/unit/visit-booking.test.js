import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CLASH_MINUTES, MIN_LEAD_HOURS, VISIT_CART_MAX, VISIT_DAYS, VISIT_SLOT_HOURS,
  dayHasFreeSlot, slotIso, slotsForDay, tightPairs, validatePickedSlot, visitDays,
} from '@/lib/visitSlots';
import { addToCart, normaliseCart, removeFromCart } from '@/lib/visitCart';
import { customerToAgentMessage, groupCustomerVisits, visitTone, visitWhen } from '@/lib/customerAgenda';
import { canDeclareVisitOutcome, receiptWhatsAppHref } from '@/lib/visitOutcome';
import { buildVisitIcs } from '@/lib/visitAgenda';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Wednesday 1 October 2031, 08:30 in Kinshasa (07:30 UTC).
const NOW = new Date('2031-10-01T07:30:00Z');

test('seven Kinshasa days from today, four slots each', () => {
  assert.deepEqual(VISIT_SLOT_HOURS, [9, 11, 14, 16]);
  assert.equal(VISIT_DAYS, 7);
  const days = visitDays(NOW);
  assert.equal(days.length, 7);
  assert.equal(days[0], '2031-10-01');
  assert.equal(days[6], '2031-10-07');
  // 23:30 UTC is already the next day in Kinshasa.
  assert.equal(visitDays(new Date('2031-10-01T23:30:00Z'))[0], '2031-10-02');
});

test('a slot is Kinshasa wall time with its offset', () => {
  assert.equal(slotIso('2031-10-01', 9), '2031-10-01T09:00:00+01:00');
  assert.equal(Date.parse(slotIso('2031-10-01', 14)), Date.parse('2031-10-01T13:00:00Z'));
});

test('less than two hours ahead is greyed out; the rest of the day is free', () => {
  assert.equal(MIN_LEAD_HOURS, 2);
  const today = slotsForDay('2031-10-01', { now: NOW });
  // 08:30 now: 09:00 and 11:00 (10:30 cut-off) → 09:00 gone, 11:00 fine.
  assert.deepEqual(today.map((s) => [s.hour, s.reason]), [[9, 'past'], [11, null], [14, null], [16, null]]);
});

test("a slot within an hour of the agent's confirmed visit is greyed out — nothing else is", () => {
  assert.equal(CLASH_MINUTES, 60);
  const busy = ['2031-10-02T13:30:00.000Z']; // 14:30 Kinshasa
  const slots = slotsForDay('2031-10-02', { now: NOW, busy });
  assert.deepEqual(slots.map((s) => s.reason), [null, null, 'busy', null], '14:00 clashes; 16:00 is 90 min away');
  assert.equal(dayHasFreeSlot('2031-10-02', { now: NOW, busy }), true);
  const allBusy = VISIT_SLOT_HOURS.map((h) => new Date(Date.parse(slotIso('2031-10-03', h))).toISOString());
  assert.equal(dayHasFreeSlot('2031-10-03', { now: NOW, busy: allBusy }), false);
});

test('the server accepts only a slot the picker could have offered', () => {
  assert.deepEqual(validatePickedSlot('2031-10-02T14:00:00+01:00', NOW), {
    iso: '2031-10-02T14:00:00+01:00',
    phrase: 'jeudi 2 octobre à 14h00',
  });
  assert.equal(validatePickedSlot('2031-10-02T15:00:00+01:00', NOW).error, 'invalid', 'not one of the four hours');
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
  const card = read('components/EnquiryCard.js');
  assert.match(card, /<VisitSlotPicker propertyId=\{propertyId\} name="preferred_slot_at"/);
  assert.ok(!/name="requested_time"/.test(card), 'no free-text time field left');
  const action = read('app/(site)/listings/[id]/actions.js');
  assert.match(action, /validatePickedSlot\(pickedRaw\)/);
  assert.match(action, /preferredSlotAt: picked\?\.iso/);
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
