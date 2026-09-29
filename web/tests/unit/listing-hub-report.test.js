import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  CREATE_LINK_SQL, REVOKE_LINK_SQL, createReportLink, parseReportToken, reportToken, resolveReportToken, signReportLink,
} from '@/lib/reportLinks';
import { FUNNEL_LABELS_FR, FUNNEL_STEPS, changeText, funnelRows } from '@/lib/listingFunnel';
import {
  MARKET_MIN_SAMPLE, PERFORMANCE_RANGES, comparableAmount, daysOnMarket, lifetimeWindow, performanceWindow, pickMarketPosition,
} from '@/lib/listingPerformance';
import { VIEW_RANGES } from '@/lib/analytics';
import { marketPositionText } from '@/lib/marketing/liveReportCopy';

beforeEach(() => reset());

// --- the owner's link ------------------------------------------------------------

const ROW = { id: 12, property_id: 310, nonce: 'n0nce-n0nce-n0nce-123' };

test('a report token is the row id plus an HMAC signature, and parses back', () => {
  const token = reportToken(ROW);
  assert.match(token, /^12-[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(parseReportToken(token), { id: 12, signature: token.slice(3) });
  assert.equal(parseReportToken('12'), null);
  assert.equal(parseReportToken('abc-xyz'), null);
  assert.equal(parseReportToken(`12-${'a'.repeat(31)}`), null);
});

test('the signature binds the listing and the nonce — a copied id cannot open another report', () => {
  const base = signReportLink({ id: 12, propertyId: 310, nonce: ROW.nonce });
  assert.notEqual(signReportLink({ id: 12, propertyId: 311, nonce: ROW.nonce }), base);
  assert.notEqual(signReportLink({ id: 12, propertyId: 310, nonce: 'other-nonce-value-00' }), base);
  assert.notEqual(signReportLink({ id: 13, propertyId: 310, nonce: ROW.nonce }), base);
});

test('resolving: a good token opens the link; a forged signature or a revoked row is a 404', async () => {
  enqueue([{ ...ROW, agent_id: 7, created_at: new Date(), last_viewed_at: null, view_count: 0 }]);
  const link = await resolveReportToken(reportToken(ROW));
  assert.equal(link.propertyId, 310);
  assert.equal(link.agentId, 7);
  assert.match(calls[0].sql, /revoked_at IS NULL/);

  enqueue([{ ...ROW, agent_id: 7 }]);
  const forged = `12-${'A'.repeat(32)}`;
  assert.equal(await resolveReportToken(forged), null);

  enqueue([]); // revoked or unknown
  assert.equal(await resolveReportToken(reportToken(ROW)), null);
});

test('links are created and revoked only on the agent’s own listing, one active per listing', async () => {
  assert.match(CREATE_LINK_SQL.replace(/\s+/g, ' '), /WHERE p\.id = \$1 AND p\.agent_id = \$2/);
  assert.match(CREATE_LINK_SQL, /ON CONFLICT \(property_id\) WHERE revoked_at IS NULL DO NOTHING/);
  assert.match(REVOKE_LINK_SQL.replace(/\s+/g, ' '), /p\.agent_id = \$2 AND l\.revoked_at IS NULL/);

  enqueue([]); // INSERT inserted nothing (not theirs)
  enqueue([]); // and no existing link
  assert.deepEqual(await createReportLink(33, 310), { ok: false, reason: 'not_found' });
  assert.equal(calls[0].values[0], 310);
  assert.equal(calls[0].values[1], 33);
  assert.ok(calls[0].values[2].length >= 16, 'a random nonce');
});

test('"nouveau lien" revokes the old link before creating the new one', async () => {
  enqueue([]); // revoke
  enqueue([{ ...ROW, created_at: new Date(), view_count: 0 }]);
  const result = await createReportLink(33, 310, { fresh: true });
  assert.equal(result.ok, true);
  assert.match(calls[0].sql, /^UPDATE property_report_links/);
  assert.match(calls[1].sql, /^INSERT INTO property_report_links/);
  assert.match(result.link.url, /\/rapport\/12-/);
});

test('before the migration the feature answers "unavailable", never an error', async () => {
  const pool = (await import('../support/fakePool.js')).getPool();
  const original = pool.query;
  pool.query = async () => { pool.query = original; throw Object.assign(new Error('no table'), { code: '42P01' }); };
  assert.deepEqual(await createReportLink(33, 310), { ok: false, reason: 'unavailable' });
});

// --- the funnel ------------------------------------------------------------------

test('the funnel lists every step in order, with a French label for the owner', () => {
  assert.deepEqual(FUNNEL_STEPS.map((s) => s.key), [
    'views', 'people', 'galleryPeople', 'galleryCompletePeople', 'whatsappClicks', 'calls', 'saves', 'shares', 'visitRequests',
  ]);
  for (const { key } of FUNNEL_STEPS) assert.ok(FUNNEL_LABELS_FR[key], key);
});

test('an unknown count stays unknown — never drawn as 0 — and bars are relative to the widest step', () => {
  const rows = funnelRows({ current: { views: 120, people: 38, calls: null }, previous: { views: 60 } }, FUNNEL_LABELS_FR);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.views.share, 1);
  assert.equal(byKey.people.share, 38 / 120);
  assert.equal(byKey.calls.value, null);
  assert.equal(byKey.calls.share, 0);
  assert.equal(byKey.views.previous, 60);
  assert.equal(byKey.people.previous, null);
  assert.equal(byKey.calls.since, true, 'calls are only measured from the tracking start');
});

test('a change from zero is not a percentage', () => {
  assert.equal(changeText(120, 60), '+100 %');
  assert.equal(changeText(30, 60), '−50 %');
  assert.equal(changeText(60, 60), '=');
  assert.equal(changeText(5, 0), null);
  assert.equal(changeText(null, 3), null);
});

// --- windows, time on market, market position ----------------------------------

test('the page’s ranges are the chart’s ranges, so one ?range= drives both', () => {
  assert.deepEqual(Object.keys(PERFORMANCE_RANGES), Object.keys(VIEW_RANGES));
});

test('windows are whole UTC days, the current one ending tomorrow at midnight', () => {
  const now = new Date('2026-09-29T15:00:00Z');
  const week = performanceWindow(7, now);
  assert.equal(week.from.toISOString(), '2026-09-23T00:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-09-30T00:00:00.000Z');
  assert.equal(week.previousFrom.toISOString(), '2026-09-16T00:00:00.000Z');
  const life = lifetimeWindow('2026-08-24T10:00:00Z', now);
  assert.equal(life.from.toISOString(), '2026-08-24T00:00:00.000Z');
  assert.equal(life.previousFrom.getTime(), life.from.getTime(), 'no earlier period to compare with');
});

test('time on market runs from publication to today, or to the day it closed', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  assert.equal(daysOnMarket({ created_at: '2026-09-06T12:00:00Z' }, now), 23);
  assert.equal(daysOnMarket({ created_at: '2026-09-06T12:00:00Z', listing_status: 'closed', sold_at: '2026-09-16' }, now), 9);
  assert.equal(daysOnMarket({}, now), null);
});

test('the narrowest comparison with enough listings wins; below the minimum there is no figure', () => {
  const row = { beds_n: 3, beds_median: 900, type_n: 6, type_median: 1000, commune_n: 11, commune_median: 800 };
  assert.deepEqual(pickMarketPosition(row, 1300), { scope: 'type', n: 6, median: 1000, differencePct: 30 });
  assert.deepEqual(
    pickMarketPosition({ beds_n: 1, type_n: 2, commune_n: MARKET_MIN_SAMPLE - 1, commune_median: 700 }, 700),
    { scope: null, n: MARKET_MIN_SAMPLE - 1, median: null, differencePct: null },
  );
  assert.equal(comparableAmount({ price: 12000, purpose: 'rent', price_period: 'an' }), 1000, 'a yearly rent compares per month');
});

test('the owner reads the sample size beside the median, and nothing when there is none', () => {
  const listing = { commune: 'Kintambo', purpose: 'rent' };
  assert.match(marketPositionText({ scope: 'beds', n: 7, median: 1200, differencePct: 8 }, listing),
    /Loyer médian demandé pour 7 biens comparables de même type et même nombre de chambres à Kintambo : 1 200 \$ \/ mois\. Ce bien : \+8 %\./);
  assert.match(marketPositionText({ scope: null, n: 3, median: null }, listing), /Pas encore assez .* \(3\)/);
  assert.equal(marketPositionText({ scope: null, n: 0, median: null }, listing), null);
});
