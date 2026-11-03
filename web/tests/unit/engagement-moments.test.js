import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bestSavedSearchMatch, matchForCriteria, criteriaFromQuery, MIN_SHOWN_PERCENT } from '@/lib/savedSearchMatch';
import { runFavoritePriceDropSweep, priceDropMessageText, dropPercent, MAX_PER_MESSAGE } from '@/lib/favoritePriceDropSweep';
import { visitCountdown } from '@/lib/visitAgenda';
import { nextVisitStamps, SESSION_GAP_MS } from '@/lib/visitStamps';
import { milestoneToCelebrate, RECENT_DAYS } from '@/lib/agentMilestoneRules';
import { buildSoldCaption } from '@/lib/marketing/soldShareKit';
import * as favoriteDrops from '@/lib/favoritePriceDrops';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * The 2026-11-03 engagement pass: match % on cards, price-drop alerts on saved
 * listings, "new since your last visit", the confirmed-visit countdown, agent
 * firsts and the "Loué via Lukka Place" card. Each rule here is one that a
 * well-meant "simplification" would turn into an invented number or a spammy
 * message.
 */

test.beforeEach(() => reset());

const flat = { id: 1, purpose: 'rent', commune: 'Gombe', category_name: 'Appartement', price: 900, beds: 2 };

test('match %: budget and bedrooms score, inside the search only', () => {
  const q = 'transaction_type=location&commune=Gombe&price_max=1000&beds_min=2';
  assert.equal(bestSavedSearchMatch(flat, [q]), 100);
  // Over budget lowers the score; far over drops below the shown threshold.
  assert.equal(bestSavedSearchMatch({ ...flat, price: 1100 }, [q]), 95);
  assert.equal(bestSavedSearchMatch({ ...flat, price: 2500, beds: 0 }, [q]), null);
});

test('match %: another transaction, commune or type is no badge, never a low number', () => {
  const q = 'transaction_type=location&commune=Gombe&property_type=appartement&price_max=1000';
  assert.equal(matchForCriteria({ ...flat, purpose: 'sale' }, criteriaFromQuery(q)), null);
  assert.equal(matchForCriteria({ ...flat, commune: 'Limete' }, criteriaFromQuery(q)), null);
  assert.equal(matchForCriteria({ ...flat, category_name: 'Maison' }, criteriaFromQuery(q)), null);
  assert.equal(matchForCriteria({ ...flat, listing_status: 'closed' }, criteriaFromQuery(q)), null);
});

test('match %: a search with neither budget nor bedrooms gives nothing to score', () => {
  assert.equal(bestSavedSearchMatch(flat, ['transaction_type=location&commune=Gombe']), null);
  assert.ok(MIN_SHOWN_PERCENT >= 60);
});

test('match %: the best of several saved searches wins; extra communes count', () => {
  const far = 'commune=Limete&price_max=500';
  const near = 'commune=Kalamu&communes=Gombe&price_max=900';
  assert.equal(bestSavedSearchMatch(flat, [far, near]), 100);
});

test('price drops: one message per customer, newest cuts first, capped', async () => {
  const rows = [];
  for (let i = 0; i < MAX_PER_MESSAGE + 2; i += 1) {
    rows.push({ customer_id: 7, phone: '243900000001', property_id: 100 + i, title: `Bien ${i}`, price: 900, price_drop_from: 1000, purpose: 'rent', price_period: null, price_drop_at: new Date(2026, 10, 1, i) });
  }
  rows.push({ customer_id: 8, phone: '243900000002', property_id: 300, title: 'Villa', price: 180000, price_drop_from: 200000, purpose: 'sale', price_drop_at: new Date() });
  const sent = [];
  const recorded = [];
  const result = await runFavoritePriceDropSweep({
    siteUrl: 'https://lukkaplace.com',
    deps: {
      getDrops: async () => rows,
      send: async (phone, text) => sent.push({ phone, text }),
      recordNotified: async (customerId, drops) => recorded.push({ customerId, ids: drops.map((d) => d.property_id) }),
    },
  });
  assert.equal(sent.length, 2);
  assert.equal(result.notifiedDrops, MAX_PER_MESSAGE + 1);
  assert.deepEqual(recorded[0].ids, [106, 105, 104, 103, 102]);
  assert.match(sent[1].text, /un bien que vous avez enregistré baisse de prix/);
  assert.match(sent[1].text, /\(−10 %\)/);
  assert.match(sent[1].text, /lukkaplace\.com\/listings\/300/);
  assert.match(sent[1].text, /Ne plus recevoir ces messages : https:\/\/lukkaplace\.com\/compte\/client\/parametres/);
});

test('price drops: a failed send records nothing, so it is retried tomorrow', async () => {
  const recorded = [];
  const result = await runFavoritePriceDropSweep({
    siteUrl: 'https://lukkaplace.com',
    deps: {
      getDrops: async () => [{ customer_id: 1, phone: '1', property_id: 2, price: 9, price_drop_from: 10, price_drop_at: new Date() }],
      send: async () => { throw new Error('refused'); },
      recordNotified: async () => recorded.push(1),
    },
  });
  assert.equal(recorded.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(dropPercent(1000, 1000), null);
  assert.equal(priceDropMessageText({ drops: [], siteUrl: '' }).includes('baissent'), false);
});

test('price drops: SQL reads the public gate, the 1–50 % band, cuts after the save, and opted-out customers are skipped', async () => {
  enqueue([]);
  await favoriteDrops.getUnnotifiedFavoritePriceDrops();
  const sql = calls.map((c) => c.sql).join('\n');
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /BETWEEN 0\.01 AND 0\.5/);
  assert.match(sql, /cf\.created_at < pd\.price_drop_at/);
  assert.match(sql, /whatsapp_alerts_opted_out_at/);
  assert.match(sql, /phone_verified_at IS NOT NULL/);
  assert.match(sql, /customer_price_drop_notifications/);
});

test('price drops: the tab dot never throws', async () => {
  // The fake pool answers nothing for this query: a failure must read as 0.
  assert.equal(typeof (await favoriteDrops.countUnseenFavoritePriceDrops(1, null)), 'number');
});

test('visit countdown: minutes, hours, then Kinshasa calendar days', () => {
  const now = new Date('2026-11-03T10:00:00Z'); // 11:00 in Kinshasa
  assert.deepEqual(visitCountdown('2026-11-03T10:20:00Z', now), { kind: 'minutes', count: 20 });
  assert.deepEqual(visitCountdown('2026-11-03T13:00:00Z', now), { kind: 'hours', count: 3 });
  assert.deepEqual(visitCountdown('2026-11-03T20:00:00Z', now), { kind: 'today' });
  // 23:30 UTC is 00:30 the next day in Kinshasa.
  assert.deepEqual(visitCountdown('2026-11-03T23:30:00Z', now), { kind: 'tomorrow' });
  assert.deepEqual(visitCountdown('2026-11-06T09:00:00Z', now), { kind: 'days', count: 3 });
  assert.equal(visitCountdown('2026-11-03T09:00:00Z', now), null);
});

test('new since last visit: a new session compares with the previous one, not the last page', () => {
  const now = 1_000_000_000;
  assert.deepEqual(nextVisitStamps({ last: null, prev: null, now }), { since: null, prev: null, last: now });
  const back = nextVisitStamps({ last: now - SESSION_GAP_MS - 1, prev: null, now });
  assert.equal(back.since, now - SESSION_GAP_MS - 1);
  // Same session: keeps comparing with the stamp set when it started.
  assert.equal(nextVisitStamps({ last: now - 1000, prev: 42, now }).since, 42);
});

test('agent firsts: only recent and unseen, the most important first', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const day = 24 * 3600 * 1000;
  const ms = [
    { key: 'firstView', at: new Date(now - 2 * day).toISOString() },
    { key: 'firstVisit', at: new Date(now - day).toISOString() },
    { key: 'firstDeal', at: new Date(now - (RECENT_DAYS + 1) * day).toISOString() },
  ];
  assert.equal(milestoneToCelebrate(ms, new Set(), now).key, 'firstVisit');
  assert.equal(milestoneToCelebrate(ms, new Set(['firstVisit']), now).key, 'firstView');
  assert.equal(milestoneToCelebrate(ms, new Set(['firstVisit', 'firstView']), now), null);
});

test('"Loué via Lukka Place": no price, the agent page link, the right word', () => {
  const caption = buildSoldCaption({ purpose: 'rent', typeText: 'Appartement', place: 'Bel-Air, Kampemba', pageUrl: 'https://lukkaplace.com/agents/37' });
  assert.match(caption, /\*LOUÉ via Lukka Place\*/);
  assert.match(caption, /agents\/37/);
  assert.doesNotMatch(caption, /\$/);
  assert.match(buildSoldCaption({ purpose: 'sale', pageUrl: null, style: 'social' }), /^✅ VENDU via Lukka Place/);
  const kit = readFileSync(new URL('../../lib/marketing/soldShareKit.js', import.meta.url), 'utf8');
  assert.match(kit, /listing\?\.listing_status !== 'closed'/);
});

test('the "Bravo" dialog keeps DialogContent fixed (a position class would override it)', () => {
  // tailwind-merge keeps the LAST position utility: a "relative" passed to
  // DialogContent replaced its "fixed", and the dialog opened below the fold.
  const host = readFileSync(new URL('../../components/SoldShareHost.js', import.meta.url), 'utf8');
  for (const [, cls] of host.matchAll(/<DialogContent className="([^"]*)"/g)) {
    assert.doesNotMatch(cls, /(relative|absolute|static|sticky)/);
  }
});

test('the new client pieces never read the clock during the server render', () => {
  for (const file of ['components/SavedSearchMatchBadge.js', 'components/NewSinceLastVisit.js']) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(source, /'use client'/);
  }
});

test('the listing page median line stays hidden until 1,000 live listings, site-wide', async () => {
  const source = readFileSync(new URL('../../components/listings/MarketMedianLine.js', import.meta.url), 'utf8');
  assert.match(source, /MARKET_MEDIAN_MIN_LIVE_LISTINGS = 1000/);
  // The gate runs before the comparables query, so a hidden line costs nothing.
  assert.ok(source.indexOf('MARKET_MEDIAN_MIN_LIVE_LISTINGS) return null') < source.indexOf('getMarketPosition(listing)'));
  const { countLiveListings } = await import('@/lib/listings');
  enqueue([{ n: 42 }]);
  assert.equal(await countLiveListings(), 42);
  const sql = calls.at(-1).sql;
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.doesNotMatch(sql, /city_id/, 'every city counts toward the threshold');
});
