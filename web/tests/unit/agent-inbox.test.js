import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildAgentInbox, inboxFilterFromParams, inboxGroup } from '@/lib/agentInbox';
import { formatRelative } from '@/lib/format';

/**
 * The single Demandes inbox (2026-10-06): one row per request, what waits on
 * the agent first, four filters, old links still landing somewhere sensible.
 */

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const visit = (id, status, extra = {}) => ({ id, status, lead_wa_id: '447932673460', created_at: '2026-10-01 10:00:00', ...extra });
const lead = (id, status, extra = {}) => ({ id, status, wa_id: '243990000000', created_at: '2026-10-01 10:00:00', ...extra });

test('a web visit request shows once: its lead is folded into the visit', () => {
  const { items } = buildAgentInbox({
    visits: [visit(7, 'PENDING', { lead_id: 40, property_id: 310 })],
    leads: [
      lead(40, 'VIEWING_REQUESTED', { property_id: 310 }),
      // Same number, same listing, no lead_id link: still the same ask.
      lead(41, 'NEW', { wa_id: '447932673460', property_id: 310 }),
      // Same number, a different listing: a different request, kept.
      lead(42, 'NEW', { wa_id: '447932673460', property_id: 311 }),
    ],
  });
  assert.deepEqual(items.map((i) => i.key), ['v-7', 'l-42']);
});

test('what waits on the agent comes first, then confirmed visits soonest first, then the handled ones', () => {
  const { items, counts } = buildAgentInbox({
    visits: [
      visit(1, 'COMPLETED', { created_at: '2026-10-05 10:00:00' }),
      visit(2, 'CONFIRMED', { scheduled_at: '2026-10-09T13:00:00Z', created_at: '2026-10-04 10:00:00' }),
      visit(3, 'CONFIRMED', { scheduled_at: '2026-10-07T13:00:00Z', created_at: '2026-10-02 10:00:00' }),
      visit(4, 'PENDING', { created_at: '2026-09-30 10:00:00' }),
    ],
    leads: [lead(9, 'NEW', { created_at: '2026-10-03 10:00:00' }), lead(10, 'CONTACTED', { created_at: '2026-10-06 10:00:00' })],
  });
  assert.deepEqual(items.map((i) => i.key), ['l-9', 'v-4', 'v-3', 'v-2', 'l-10', 'v-1']);
  assert.deepEqual(counts, { all: 6, 'a-traiter': 2, confirmees: 2, traitees: 2 });
});

test('each filter shows its group only, and the counts stay whole', () => {
  const input = { visits: [visit(1, 'RESCHEDULED'), visit(2, 'CONFIRMED'), visit(3, 'DECLINED')], leads: [lead(9, 'NEW')] };
  assert.deepEqual(buildAgentInbox({ ...input, filter: 'a-traiter' }).items.map((i) => i.key).sort(), ['l-9', 'v-1']);
  assert.deepEqual(buildAgentInbox({ ...input, filter: 'confirmees' }).items.map((i) => i.key), ['v-2']);
  assert.deepEqual(buildAgentInbox({ ...input, filter: 'traitees' }).items.map((i) => i.key), ['v-3']);
  assert.equal(buildAgentInbox({ ...input, filter: 'nonsense' }).items.length, 4, 'an unknown filter is "all"');
  assert.equal(buildAgentInbox({ ...input, filter: 'confirmees' }).counts.all, 4);
  assert.equal(inboxGroup({ kind: 'lead', row: lead(1, 'QUALIFIED') }), 'traitees');
});

test('the deep-linked request goes first, even when it was folded into a visit', () => {
  const { items, focusFound } = buildAgentInbox({
    visits: [visit(7, 'CONFIRMED', { lead_id: 40 })],
    leads: [lead(9, 'NEW'), lead(40, 'VIEWING_REQUESTED')],
    focusLeadId: 40,
  });
  assert.equal(items[0].key, 'v-7');
  assert.ok(items[0].focused && focusFound);
  assert.equal(buildAgentInbox({ leads: [lead(9, 'NEW')], focusLeadId: 99 }).focusFound, false);
});

test('search matches the name, the number, the request and the listing title', () => {
  const input = {
    visits: [visit(1, 'PENDING', { lead_name: 'Henoc Mimbo', property_id: 310 })],
    leads: [lead(9, 'NEW', { name: 'Kkg', requirements_summary: '2 chambres à Gombe' })],
    titleFor: (id) => (String(id) === '310' ? '3 chambres — Appartement à Kintambo' : null),
  };
  assert.deepEqual(buildAgentInbox({ ...input, q: 'kintambo' }).items.map((i) => i.key), ['v-1']);
  assert.deepEqual(buildAgentInbox({ ...input, q: 'GOMBE' }).items.map((i) => i.key), ['l-9']);
  assert.deepEqual(buildAgentInbox({ ...input, q: '24399' }).items.map((i) => i.key), ['l-9']);
});

test('old links land on the matching filter', () => {
  assert.equal(inboxFilterFromParams({ tab: 'visites' }), '');
  assert.equal(inboxFilterFromParams({ status: 'NEW' }), 'a-traiter');
  assert.equal(inboxFilterFromParams({ status: 'PENDING' }), 'a-traiter');
  assert.equal(inboxFilterFromParams({ status: 'CONFIRMED' }), 'confirmees');
  assert.equal(inboxFilterFromParams({ filtre: 'traitees' }), 'traitees');
});

test('relative times follow the reader’s language — no "il y a" on an English dashboard', () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  assert.equal(formatRelative(twoDaysAgo, 'en'), '2 days ago');
  assert.equal(formatRelative(twoDaysAgo, 'fr'), 'avant-hier');
});

test('one inbox, no sub-tabs, one primary action per card', () => {
  const page = read('app/compte/agent/demandes/page.js');
  assert.doesNotMatch(page, /tabRequests|tabVisits|VisitsTab/);
  assert.match(page, /buildAgentInbox\(/);
  assert.doesNotMatch(page, /formatRelativeFr|'Ajoutez un bien|Aucune demande pour le moment/, 'no hardcoded French');
  const visitCard = read('components/AgentVisitRequestCard.js');
  assert.match(visitCard, /t\('agent\.inbox\.confirmVisit'\)/);
  assert.match(visitCard, /t\('agent\.inbox\.contactWhatsApp'\)/);
  // Déplacer / Refuser / Annuler live behind "···", never beside the primary.
  assert.match(visitCard, /<div hidden=\{!moreOpen\}[\s\S]*agent\.inbox\.move[\s\S]*agent\.inbox\.decline[\s\S]*agent\.visits\.cancelVisit/);
  const leadCard = read('components/AgentLeadCard.js');
  assert.doesNotMatch(leadCard, /Marquer comme convertie|Votre réponse à|Envoyé sur WhatsApp au|% correspondance|>\s*Statut\s*</);
});
