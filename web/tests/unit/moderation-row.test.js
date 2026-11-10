import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEW_ACCOUNT_DAYS, SHOWN_ELSEWHERE, agentFacts, agentHeadline, agentSubline, checkFlags, duplicateSummary, initials, photoTone,
} from '@/lib/moderationRow';
import { DUPLICATE_FLAGS, QUALITY_FLAGS } from '@/lib/moderation';

const NOW = Date.parse('2026-11-10T12:00:00Z');

test('each fact appears once: flags another cell shows leave the checks column', () => {
  assert.deepEqual(
    checkFlags(['few_photos', 'duplicate_photo', 'duplicate_listing', 'price_outlier', 'missing_content', 'availability_unanswered']),
    ['missing_content', 'availability_unanswered'],
  );
  // Every flag the queue computes is either shown in the checks column or somewhere else.
  for (const flag of SHOWN_ELSEWHERE) assert.ok(QUALITY_FLAGS.includes(flag), flag);
  for (const flag of DUPLICATE_FLAGS) assert.ok(SHOWN_ELSEWHERE.has(flag), flag);
});

test('one duplicate link for all matches; red only when the same agent has it again', () => {
  // #806 in production: a photo with another agent AND the same title/price as another agent's listing.
  const coMandate = duplicateSummary({
    flags: ['few_photos', 'duplicate_photo', 'duplicate_listing'],
    duplicates: { duplicate_photo: [805], duplicate_listing: [805, 811] },
    duplicateListingSameAgent: false,
  });
  assert.deepEqual(coMandate, { ids: [805, 811], sameAgent: false, danger: false, reasons: ['duplicate_photo', 'duplicate_listing'] });

  const resend = duplicateSummary({
    flags: ['same_agent_resend', 'duplicate_listing'],
    duplicates: { same_agent_resend: [646], duplicate_listing: [646] },
    duplicateListingSameAgent: true,
  });
  assert.equal(resend.danger, true);
  assert.equal(resend.sameAgent, true);
  assert.deepEqual(resend.ids, [646]);

  // Same title and price by the same agent, no shared photo: same agent, but not a re-send (another unit).
  const unit = duplicateSummary({ flags: ['duplicate_listing'], duplicates: { duplicate_listing: [700] }, duplicateListingSameAgent: true });
  assert.equal(unit.sameAgent, true);
  assert.equal(unit.danger, false);

  assert.equal(duplicateSummary({ flags: ['few_photos'], duplicates: {} }), null);
  // A flag without ids (link limit, race) draws no link.
  assert.equal(duplicateSummary({ flags: ['duplicate_photo'], duplicates: { duplicate_photo: [] } }), null);
});

test('the agent cell says when the account is new and how much it has published', () => {
  const minutesOld = agentFacts({ agentCreatedAt: '2026-11-10T10:07:47Z', agentListingCount: 1 }, NOW);
  assert.deepEqual(minutesOld, { newAccount: true, firstListing: true, listingCount: 1 });

  const agency = agentFacts({ agentCreatedAt: '2026-10-23T10:45:42Z', agentListingCount: 71 }, NOW);
  assert.deepEqual(agency, { newAccount: false, firstListing: false, listingCount: 71 });

  const edge = agentFacts({ agentCreatedAt: new Date(NOW - NEW_ACCOUNT_DAYS * 86400000).toISOString(), agentListingCount: null }, NOW);
  assert.deepEqual(edge, { newAccount: false, firstListing: false, listingCount: null });
});

test('name, agency and initials never print phone digits or repeat themselves', () => {
  assert.equal(agentHeadline({ agentName: 'Delmas PERRIER', agentAgency: 'ASS IMM KIN' }), 'Delmas PERRIER');
  assert.equal(agentSubline({ agentName: 'Delmas PERRIER', agentAgency: 'ASS IMM KIN' }), 'ASS IMM KIN');
  // Agent #67 typed the agency as their name: shown once.
  assert.equal(agentSubline({ agentName: 'Prince Immo Tout Kin', agentAgency: 'Prince Immo Tout Kin' }), null);
  assert.equal(agentHeadline({ agentName: null, agentAgency: 'GROUPE GÉANT VERT' }), 'GROUPE GÉANT VERT');
  assert.equal(agentHeadline({ agentName: null, agentAgency: null }), null);
  assert.equal(initials('Delmas PERRIER'), 'DP');
  assert.equal(initials('Andrew'), 'A');
  assert.equal(initials('  '), '#');
  assert.equal(initials('Élodie « Kin » Mbala'), 'ÉM');
});

test('the photo badge turns amber for 1–2 photos and red for none', () => {
  assert.equal(photoTone({ flags: ['no_photos'] }), 'danger');
  assert.equal(photoTone({ flags: ['few_photos'] }), 'warning');
  assert.equal(photoTone({ flags: [] }), 'plain');
});

test('Prêtes: verified agent older than a week, no flag, at least 3 photos; everything else is checked', async () => {
  const { readiness, splitQueue, reviewOrder, queueSummary } = await import('@/lib/moderationRow');
  const ok = { id: 810, agentId: 60, agentVerified: true, agentCreatedAt: '2026-10-22T11:16:49Z', flags: [], photoCount: 8, createdAt: '2026-11-10T10:56:19Z' };
  assert.equal(readiness(ok, NOW), 'ready');
  assert.equal(readiness({ ...ok, photoCount: 2 }, NOW), 'check');
  assert.equal(readiness({ ...ok, flags: ['price_outlier'] }, NOW), 'check');
  assert.equal(readiness({ ...ok, agentVerified: false }, NOW), 'check');
  assert.equal(readiness({ ...ok, agentId: null }, NOW), 'check');
  assert.equal(readiness({ ...ok, agentCreatedAt: '2026-11-10T10:07:47Z' }, NOW), 'check');
  assert.equal(readiness({ ...ok, agentCreatedAt: null }, NOW), 'check');

  const customer = { ...ok, id: 806, agentCreatedAt: '2026-11-10T10:07:47Z', photoCount: 1, flags: ['few_photos'], createdAt: '2026-11-10T10:07:48Z' };
  const rows = [customer, ok, { ...ok, id: 809, createdAt: '2026-11-10T09:00:00Z' }];
  assert.deepEqual(splitQueue(rows, NOW).check.map((r) => r.id), [806]);
  assert.deepEqual(reviewOrder(rows, NOW).map((r) => r.id), [806, 809, 810]);
  assert.deepEqual(reviewOrder(rows, NOW, { only: 'check' }).map((r) => r.id), [806]);

  const summary = queueSummary(rows, 3, NOW);
  assert.deepEqual(summary, { total: 3, oldestAt: '2026-11-10T09:00:00Z', oldestMinutes: 180, toCheck: 1, complete: true });
  assert.equal(queueSummary(rows, 140, NOW).complete, false);
});

test('a name that reads like a message is pointed out; real names and agencies are not', async () => {
  const { nameLooksLikeSentence } = await import('@/lib/moderationRow');
  for (const name of ['Je contacte parce que j’ai vu cette annonce dans votre site', 'Ok', 'J’ai vu cette annoncr dans votre site', 'Bonjour monsieur', 'La visite est gratuite ?']) {
    assert.equal(nameLooksLikeSentence(name), true, name);
  }
  for (const name of ['Delmas PERRIER', 'Prince Immo Tout Kin', 'Mr Trésor', 'Andrew', 'Groupe Géant Vert', '', null]) {
    assert.equal(nameLooksLikeSentence(name), false, String(name));
  }
});

test('the grey line is what the agent typed first, else what we read, else the description', async () => {
  const { agentTextLine } = await import('@/lib/moderationRow');
  const source = { messages: [{ kind: 'media', body: null }, { kind: 'text', body: 'Bonjour, je vous contacte\nvia Lukka Place' }], rawText: 'lu' };
  assert.equal(agentTextLine(source, {}), 'Bonjour, je vous contacte via Lukka Place');
  assert.equal(agentTextLine({ messages: [], rawText: 'Appartement 2 chambres' }, {}), 'Appartement 2 chambres');
  assert.equal(agentTextLine({ channel: 'web', messages: [] }, { descriptionSnippet: 'Belle villa' }), 'Belle villa');
  assert.equal(agentTextLine(null, {}), null);
});
