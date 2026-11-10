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
