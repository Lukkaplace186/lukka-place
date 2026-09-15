import test from 'node:test';
import assert from 'node:assert/strict';
import { runAlertSweepChunk, alertMessageText, ALERT_BATCH_SIZE } from '@/lib/searchAlertSweep';
import * as searchAlerts from '@/lib/searchAlerts';
import { getRecentListingIds } from '@/lib/listings';
import { calls, reset } from '../support/fakePool.js';

/**
 * The saved-search WhatsApp alert sweep (Phase 3 of the customer account
 * audit). The engine side (daily window, cursor loop) is pinned by
 * scripts/verify-pipeline.js §18.
 */

const NOW = new Date('2026-09-20T09:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000);

function harness({ recent, searches, listings = {}, notified = {}, markThrows = false, failSendFor = null }) {
  const sent = [];
  const recorded = [];
  const marked = [];
  const deps = {
    getRecentListings: async () => recent,
    getDueSearches: async () => searches,
    getListings: async (options) => listings[options.commune || 'default']?.(options) ?? { data: [] },
    getNotified: async (id) => new Set(notified[id] || []),
    send: async (phone, message) => {
      if (phone === failSendFor) throw new Error('send refused');
      sent.push({ phone, ...message });
    },
    recordNotified: async (id, ids) => recorded.push({ id, ids }),
    markAlerted: async (id) => {
      if (markThrows) throw new Error('column "last_alerted_at" does not exist');
      marked.push(id);
    },
  };
  return { deps, sent, recorded, marked };
}

const search = (id, extra = {}) => ({
  id, query: 'commune=Gombe', label: 'Gombe', phone: `2439000000${id}`, created_at: day(3).toISOString(), ...extra,
});
const listingRow = (id) => ({ id, title: `Bien ${id}`, price: 900, purpose: 'rent', price_period: 'month' });

test('no new listing: nothing is read and nothing is sent', async () => {
  let asked = false;
  const { deps, sent } = harness({ recent: [], searches: [] });
  deps.getDueSearches = async () => { asked = true; return []; };
  const result = await runAlertSweepChunk({ now: NOW, deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(result.done, true);
  assert.equal(asked, false, 'an empty window must not page through a single saved search');
  assert.equal(sent.length, 0);
});

test('a search is matched against the new listings only, and alerted once', async () => {
  let asked;
  const h = harness({
    recent: [{ id: 11, publishedAt: day(1) }, { id: 12, publishedAt: day(5) }],
    searches: [search(1)],
    listings: { Gombe: (options) => { asked = options; return { data: [listingRow(11)] }; } },
  });
  const result = await runAlertSweepChunk({ now: NOW, deps: h.deps, siteUrl: 'https://lukkaplace.com' });
  assert.deepEqual(asked.ids, [11], 'listing 12 was published before the search was saved');
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /ids=11/);
  assert.match(h.sent[0].text, /compte\/client\?tab=alertes/, 'every alert says how to stop it');
  assert.deepEqual(h.recorded, [{ id: 1, ids: [11] }]);
  assert.deepEqual(h.marked, [1]);
  assert.equal(result.notifiedSearches, 1);
});

test('a widened result is never sent as an alert', async () => {
  const h = harness({
    recent: [{ id: 11, publishedAt: day(1) }],
    searches: [search(1), search(2, { query: 'commune=Limete&radius=1' })],
    listings: {
      Gombe: () => ({ data: [listingRow(11)], locationRelaxed: true }),
      Limete: () => ({ data: [listingRow(11)], radiusExpanded: true }),
    },
  });
  await runAlertSweepChunk({ now: NOW, deps: h.deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(h.sent.length, 0);
});

test('a listing already sent for that search is not sent again', async () => {
  const h = harness({
    recent: [{ id: 11, publishedAt: day(1) }],
    searches: [search(1)],
    listings: { Gombe: () => ({ data: [listingRow(11)] }) },
    notified: { 1: [11] },
  });
  await runAlertSweepChunk({ now: NOW, deps: h.deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(h.sent.length, 0);
});

test('before the preferences migration, a missing column warns but does not fail the sweep', async () => {
  const h = harness({
    recent: [{ id: 11, publishedAt: day(1) }],
    searches: [search(1), search(2)],
    listings: { Gombe: () => ({ data: [listingRow(11)] }) },
    markThrows: true,
  });
  const result = await runAlertSweepChunk({ now: NOW, deps: h.deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(result.notifiedSearches, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1, 'warned once, not per search');
});

test('a failed send records nothing, so it is retried, and the rest carry on', async () => {
  const h = harness({
    recent: [{ id: 11, publishedAt: day(1) }],
    searches: [search(1), search(2)],
    listings: { Gombe: () => ({ data: [listingRow(11)] }) },
    failSendFor: '24390000001',
  });
  const result = await runAlertSweepChunk({ now: NOW, deps: h.deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(result.errors.length, 1);
  assert.deepEqual(h.recorded.map((r) => r.id), [2]);
});

test('a full page hands back a cursor; a time-boxed chunk stops before the unprocessed search', async () => {
  const full = Array.from({ length: ALERT_BATCH_SIZE }, (_, i) => search(i + 1, { query: 'commune=None' }));
  const page = harness({ recent: [{ id: 11, publishedAt: day(1) }], searches: full });
  const paged = await runAlertSweepChunk({ now: NOW, deps: page.deps, siteUrl: 'https://lukkaplace.com' });
  assert.equal(paged.done, false);
  assert.equal(paged.cursor, ALERT_BATCH_SIZE);

  let ticks = 0;
  const timed = harness({ recent: [{ id: 11, publishedAt: day(1) }], searches: [search(1), search(2), search(3)] });
  const boxed = await runAlertSweepChunk({
    now: NOW, deps: timed.deps, siteUrl: 'https://lukkaplace.com', timeBudgetMs: 10,
    // Tick 1 starts the budget, tick 2 lets search 1 through, tick 3 is over it.
    clock: () => { ticks += 1; return ticks <= 2 ? 0 : 1000; },
  });
  assert.equal(boxed.done, false);
  assert.equal(boxed.cursor, 1, 'search 2 was never looked at, so the next chunk starts there');
});

test('the due-search query pages by id and only reaches verified, opted-in, due searches', async () => {
  reset();
  await searchAlerts.getSavedSearchesDueForAlerts({ afterId: 400, limit: 200, newestPublishedAt: NOW });
  const { sql, values } = calls[0];
  assert.match(sql, /css\.id > \$1/);
  assert.match(sql, /ORDER BY css\.id LIMIT \$3/);
  assert.match(sql, /c\.phone_verified_at IS NOT NULL/);
  assert.match(sql, /whatsapp_alerts_opted_out_at'\) IS NULL/);
  assert.match(sql, /<> 'off'/);
  assert.match(sql, /interval '20 hours'/);
  assert.match(sql, /interval '6 days'/);
  assert.deepEqual(values, [400, NOW, 200]);
});

test('the new-listing read keeps the public approval gate', async () => {
  reset();
  await getRecentListingIds({ since: day(8) });
  assert.match(calls[0].sql, /p\.status = 1 AND p\.approve_status = 1/);
});

test('an alert message fits a WhatsApp session message', () => {
  const text = alertMessageText({
    label: 'x'.repeat(500), count: 3, topLine: 'y'.repeat(800), link: 'https://lukkaplace.com/listings?ids=1', manageLink: 'https://lukkaplace.com/compte/client?tab=alertes',
  });
  assert.ok(text.length <= 1000);
  assert.match(text, /3 nouveaux biens/);
});
