import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  agentListingState,
  isLiveListing,
  matchesListingFilter,
  LISTING_FILTER_PILLS,
} from '@/lib/agentListingFilters';
import { windowStartKey, trendPercent, VIEW_RANGES } from '@/lib/analytics';
import { quotaTone } from '@/lib/listingQuotaRules';
import { leadTelHref } from '@/lib/leadContact';

/**
 * The agent portal redesign (2026-10-05, prototype in
 * web/Design/agent-portal-prototype.html). These pin the rules behind the
 * three numbers that disagreed on the live portal, and the decisions that
 * came with the redesign.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const row = (over) => ({ id: 1, status: 1, approve_status: 1, listing_status: 'active', ...over });

test('one state per listing, in the documented order', () => {
  assert.equal(agentListingState(row()), 'live');
  assert.equal(agentListingState(row({ listing_status: 'under_offer' })), 'under_offer');
  assert.equal(agentListingState(row({ approve_status: 0 })), 'pending');
  assert.equal(agentListingState(row({ approve_status: '0' })), 'pending', 'a string id from pg still reads');
  assert.equal(agentListingState(row({ approve_status: 2 })), 'rejected');
  assert.equal(agentListingState(row({ status: 0 })), 'archived');
  assert.equal(agentListingState(row({ listing_status: 'closed', status: 0 })), 'closed', 'closed wins over archived');
});

test('"En ligne" is what the public sees — under offer in, pending moderation out', () => {
  assert.equal(isLiveListing(row()), true);
  assert.equal(isLiveListing(row({ listing_status: 'under_offer' })), true);
  assert.equal(isLiveListing(row({ approve_status: 0 })), false, 'the old chip counted these: 20 vs 18 on the overview');
  assert.equal(matchesListingFilter(row({ approve_status: 0 }), 'active'), false);
  assert.equal(matchesListingFilter(row({ approve_status: 0 }), 'review'), true);
  assert.equal(matchesListingFilter(row({ listing_status: 'under_offer' }), 'under_offer'), true);
  assert.equal(matchesListingFilter(row(), 'nonsense'), false);
});

test('the chips partition the inventory: every listing has exactly one state chip', () => {
  const listings = [
    row({ id: 1 }),
    row({ id: 2, listing_status: 'under_offer' }),
    row({ id: 3, approve_status: 0 }),
    row({ id: 4, approve_status: 2 }),
    row({ id: 5, status: 0 }),
    row({ id: 6, listing_status: 'closed' }),
  ];
  const count = (filter) => listings.filter((l) => matchesListingFilter(l, filter)).length;
  assert.equal(count(''), 6);
  // live already includes under offer; the other state chips are disjoint.
  assert.equal(count('active') + count('review') + count('rejected') + count('archived') + count('closed'), 6);
  assert.deepEqual(
    LISTING_FILTER_PILLS.filter((p) => p.always).map((p) => p.value),
    ['', 'active', 'review', 'under_offer'],
    'Tous · En ligne · En revue · Sous offre are always shown',
  );
  assert.ok(LISTING_FILTER_PILLS.some((p) => p.value === 'incomplete'), '"À compléter" is kept');
});

test('one 30-day window: the headline, its trend and the chart all start on the same day', () => {
  assert.equal(windowStartKey(30, new Date('2026-10-05T09:41:00Z')), '2026-09-06');
  assert.equal(windowStartKey(60, new Date('2026-10-05T09:41:00Z')), '2026-08-07');
  assert.equal(windowStartKey(1, new Date('2026-10-05T23:59:00Z')), '2026-10-05');
  assert.deepEqual(
    { unit: VIEW_RANGES['30d'].unit, buckets: VIEW_RANGES['30d'].buckets },
    { unit: 'day', buckets: 30 },
    'five ISO weeks covered 29–35 days, so the bars never added up to the figure',
  );
});

test('a trend is a real comparison or nothing — never "−100 %" from a part-month', () => {
  assert.equal(trendPercent(198, 177), 12);
  assert.equal(trendPercent(14, 17), -18);
  assert.equal(trendPercent(5, 0), null);
  assert.equal(trendPercent(0, 0), null);
  assert.equal(trendPercent(null, 10), null);
  const analytics = read('lib/analytics.js');
  assert.doesNotMatch(analytics, /date_trunc\('month', now\(\)\)/, 'no month-to-date comparison is left');
  assert.doesNotMatch(read('app/compte/agent/page.js'), /getAgentMonthlyDeltas|getAgentWhatsAppClicks/);
});

test('the listings bar turns amber from 80 % and red at the limit', () => {
  assert.equal(quotaTone(18, 25), 'ok');
  assert.equal(quotaTone(20, 25), 'warn');
  assert.equal(quotaTone(21, 25), 'warn');
  assert.equal(quotaTone(25, 25), 'full');
  assert.equal(quotaTone(3, null), 'ok', 'a plan without a cap has no bar colour');
});

test('no lead quota anywhere in the agent UI', () => {
  assert.doesNotMatch(read('components/AgentSubscriptionCard.js'), /leadQuota|leadsHandledThisMonth/);
  assert.doesNotMatch(read('components/AgentPlanPicker.js'), /\{pkg\.monthly_pitch_limit/);
  assert.match(read('components/AgentPlanPicker.js'), /agent\.plans\.listingsIncluded/);
});

test('the bell and the Demandes badge count the same thing', () => {
  assert.match(read('lib/agentDashboard.js'), /waitingCount: newLeadsCount \+ pendingVisitsCount/);
  for (const page of ['app/compte/agent/page.js', 'app/compte/agent/biens/page.js', 'app/compte/agent/demandes/page.js', 'app/compte/agent/abonnement/page.js', 'app/compte/agent/parametres/page.js']) {
    assert.match(read(page), /newLeadsCount=\{waitingCount\}/, `${page} passes the waiting count to its header`);
  }
});

test('a lead\'s call link is the customer\'s own number, or nothing', () => {
  assert.equal(leadTelHref('243815550142'), 'tel:+243815550142');
  assert.equal(leadTelHref('+44 7932 673460'), 'tel:+447932673460');
  assert.equal(leadTelHref('123'), null);
  assert.equal(leadTelHref(null), null);
});

test('to-do gaps are labels, not raw codes', () => {
  const panel = read('components/AgentTodayPanel.js');
  assert.doesNotMatch(panel, /item\.listing\.gaps\.join/, 'it printed "À compléter : missing_area"');
  assert.match(panel, /gapLabelKey\(code\)/);
});

test('every new label exists in both languages', async () => {
  const { default: fr } = await import('@/lib/i18n/fr.json', { with: { type: 'json' } });
  const { default: en } = await import('@/lib/i18n/en.json', { with: { type: 'json' } });
  const keys = [
    'agent.overview.liveListings',
    'agent.overview.windowCaption',
    'agent.portfolio.shareHeadline',
    'agent.listings.filters.review',
    'agent.today.kind.lead',
    'agent.visits.slotPicked',
    'agent.subscription.placesLeft',
    'agent.settings.progressTitle',
  ];
  for (const key of keys) {
    for (const dict of [fr, en]) {
      const value = key.split('.').reduce((node, part) => node?.[part], dict);
      assert.ok(value != null, `${key} is missing`);
    }
  }
  assert.equal(fr.agent.listings.state.pending, 'En revue');
  assert.doesNotMatch(JSON.stringify(fr), /compromis/, 'one word for it: "sous offre"');
});

test('Réglages and the overview banner read one profile checklist', async () => {
  const { profileChecklist } = await import('@/lib/completenessRules');
  const completion = {
    items: [
      { labelKey: 'agent.completion.nameLabel', done: true },
      { labelKey: 'agent.completion.photoLabel', done: true },
      { labelKey: 'agent.completion.communesLabel', done: true },
    ],
  };
  const full = profileChecklist(completion, []);
  assert.equal(full.percent, 100);
  assert.equal(full.items.length, 5, 'agency name and opening hours are always listed');

  const missingName = profileChecklist(completion, ['no_agency_name']);
  assert.ok(missingName.percent < 100, 'a gap the overview reports can never read as 100 %');
  assert.equal(missingName.items.length, 5, 'the list length does not move with the gaps');

  const noLogo = profileChecklist(completion, ['no_logo']);
  const photo = noLogo.items.find((i) => i.labelKey === 'agent.completion.photoLabel');
  assert.equal(photo.done, false, 'the same fact is one item, not two');
  assert.match(photo.href, /section=identity/);
});

test('a missing floor area is never a reminder (most Kinshasa listings state none)', async () => {
  const { listingGaps, LISTING_GAP_CODES } = await import('@/lib/completenessRules');
  assert.ok(!LISTING_GAP_CODES.includes('missing_area'));
  const complete = {
    price: 800, commune: 'Gombe', photo_count: 5, description: 'Appartement de 2 chambres, eau et courant.',
    purpose: 'rent', deposit_months: 3, quartier: 'Golf', area: '0',
  };
  assert.deepEqual(listingGaps(complete), [], 'area "0" (not given) leaves a listing complete');
  assert.deepEqual(listingGaps({ ...complete, area: null }), []);
});
