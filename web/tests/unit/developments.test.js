import test from 'node:test';
import assert from 'node:assert/strict';
import * as developments from '@/lib/developments';
import {
  idFromSlug, lotSummary, matchesProjectFilter, normalisePaymentPlan, parsePolygon, paymentSchedule,
  portionRows, pricePerM2, publishBlockers, slugify, timelineIsStale, unitTypeSummary,
  validateDevelopmentInput, validateLotInput, validateUnitTypeInput, youtubeEmbedUrl, safeUrl,
} from '@/lib/developmentRules';
import { comparablePrice, matchesDemandCell } from '@/lib/demandRules';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * /projets. Two classes of assertion:
 *  - SQL text: every PUBLIC read carries `d.status = 1 AND d.approve_status = 1`
 *    (no RLS on developments either), and every developer write is scoped by
 *    `d.agent_id` in the statement itself;
 *  - the pure rules: nothing is invented — a missing number stays missing.
 */

const PUBLIC = 'd.status = 1 AND d.approve_status = 1';
const allSql = () => calls.map((c) => c.sql).join('\n');

test.beforeEach(() => reset());

test('public reads apply the publication gate', async () => {
  enqueue([]);
  await developments.getPublicProjects({});
  assert.ok(allSql().includes(PUBLIC));

  reset();
  enqueue([]);
  await developments.getPublicProjectById(5);
  assert.ok(allSql().includes(PUBLIC), 'a guessed URL to a draft must 404');

  reset();
  enqueue([]);
  await developments.getProjectCommunes();
  assert.ok(allSql().includes(PUBLIC));

  reset();
  enqueue([]);
  await developments.getSitemapProjects();
  assert.ok(allSql().includes(PUBLIC));
});

test('a developer phone reaches a public payload only when verified and routing is on', async () => {
  enqueue([]);
  await developments.getPublicProjectById(5);
  const sql = allSql();
  assert.match(sql, /CASE WHEN a\.phone_verified_at IS NOT NULL AND a\.direct_routing_enabled IS NOT FALSE\s+THEN a\.phone END AS agent_phone/);
  assert.ok(!/\ba\.phone AS agent_phone/.test(sql), 'the raw phone must never be selected');
});

test('developer writes are scoped to their own projects inside the UPDATE', async () => {
  enqueue([]);
  await developments.agentSetUnitsAvailable(7, 3, 2);
  assert.match(allSql(), /d\.agent_id = \$1/);
  reset();
  enqueue([]);
  await developments.agentSetLotStatus(7, 3, 'sold');
  assert.match(allSql(), /d\.agent_id = \$1/);
});

test('a non-numeric id never reaches the database', async () => {
  assert.equal(await developments.getPublicProjectById('abc'), null);
  assert.equal(calls.length, 0);
});

test('projectPosition: own coordinates, else commune centroid flagged approximate, else nothing', () => {
  assert.deepEqual(developments.projectPosition({ latitude: -4.3, longitude: 15.3 }), { lat: -4.3, lng: 15.3, approximate: false });
  const fallback = developments.projectPosition({ latitude: null, longitude: null, commune: 'Gombe' });
  assert.equal(fallback.approximate, true);
  assert.equal(developments.projectPosition({ latitude: null, longitude: null, commune: null }), null);
});

test('slug and id round-trip; only the trailing id matters', () => {
  assert.equal(slugify('Résidence Élite — Gombe'), 'residence-elite-gombe');
  assert.equal(idFromSlug('residence-elite-gombe-12'), 12);
  assert.equal(idFromSlug('12'), 12);
  assert.equal(idFromSlug('residence'), null);
});

test('unit summary: unstated availability is null, never zero; sold-out types do not set "dès"', () => {
  const none = unitTypeSummary([{ price_min: '900', purpose: 'sale' }]);
  assert.equal(none.available, null);
  const s = unitTypeSummary([
    { price_min: '500', units_available: 0, units_total: 4, purpose: 'sale', bedrooms: 1 },
    { price_min: '900', price_max: '1200', units_available: 3, units_total: 6, purpose: 'sale', bedrooms: 3 },
  ]);
  assert.equal(s.available, 3);
  assert.equal(s.total, 10);
  assert.equal(s.priceMin, 900);
  assert.equal(s.bedsMin, 1);
  assert.equal(s.bedsMax, 3);
});

test('lot summary counts statuses and quotes the cheapest AVAILABLE lot', () => {
  const s = lotSummary([
    { status: 'sold', price: '1000' },
    { status: 'available', price: '5000' },
    { status: 'reserved', price: '2000' },
  ]);
  assert.deepEqual([s.available, s.reserved, s.sold, s.priceMin], [1, 1, 1, 5000]);
});

test('portions: price per m² from the seller’s numbers, saving only when bigger is cheaper', () => {
  const rows = portionRows([
    { id: 2, label: 'B', share_percent: '100', price: '42000', status: 'available' },
    { id: 1, label: 'A', share_percent: '30', price: '15000', status: 'available' },
    { id: 3, label: 'C', share_percent: '50', price: null, status: 'available' },
  ], 1000);
  assert.deepEqual(rows.map((r) => r.share), [30, 50, 100]);
  assert.equal(rows[0].perM2, 50);
  assert.equal(rows[1].perM2, null, 'no price, no price per m²');
  assert.equal(rows[2].savingPerM2, 8);
  assert.equal(pricePerM2(1000, 0), null);
});

test('payment plan: must sum to 100, rounding lands on the last instalment', () => {
  assert.equal(normalisePaymentPlan([{ label: 'a', percent: 30 }, { label: 'b', percent: 60 }]).complete, false);
  const schedule = paymentSchedule([{ label: 'a', percent: 30 }, { label: 'b', percent: 40 }, { label: 'c', percent: 30 }], 99999);
  assert.equal(schedule.reduce((sum, row) => sum + row.amount, 0), 99999);
  assert.deepEqual(paymentSchedule([{ label: 'a', percent: 50 }], 1000), [], 'an incomplete plan computes nothing');
});

test('polygon parsing refuses fewer than three points or anything off the plan', () => {
  assert.deepEqual(parsePolygon('10,10 100,10 100,100'), [[10, 10], [100, 10], [100, 100]]);
  assert.equal(parsePolygon('10,10 100,10'), null);
  assert.equal(parsePolygon('10,10 100,10 1200,100'), null);
  assert.equal(parsePolygon('a,b c,d e,f'), null);
});

test('filters: off-plan is pre-launch or under construction; land is its own bucket', () => {
  assert.equal(matchesProjectFilter({ kind: 'building', stage: 'pre_launch' }, 'off_plan'), true);
  assert.equal(matchesProjectFilter({ kind: 'building', stage: 'delivered' }, 'off_plan'), false);
  assert.equal(matchesProjectFilter({ kind: 'land' }, 'land'), true);
  assert.equal(matchesProjectFilter({ kind: 'land' }, 'delivered'), false);
});

test('a stalled off-plan timeline is flagged; delivered buildings never are', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const old = [{ taken_on: '2026-05-01' }];
  assert.equal(timelineIsStale({ kind: 'building', stage: 'under_construction' }, old, now), true);
  assert.equal(timelineIsStale({ kind: 'building', stage: 'delivered' }, old, now), false);
  assert.equal(timelineIsStale({ kind: 'building', stage: 'under_construction' }, [{ taken_on: '2026-09-01' }], now), false);
});

test('publish blockers: something to look at, a place, and something on offer', () => {
  assert.deepEqual(publishBlockers({ kind: 'building', photos: [], renders: [], commune: null, unit_types: [] }), ['media', 'commune', 'units']);
  assert.deepEqual(publishBlockers({ kind: 'land', photos: [], renders: ['x'], commune: 'Gombe', lots: [{}] }), []);
});

test('admin input validation', () => {
  assert.equal(validateDevelopmentInput({ name: '' }).errorKey, 'admin.projects.errors.name');
  assert.equal(validateDevelopmentInput({ name: 'X', kind: 'building' }).errorKey, 'admin.projects.errors.stage');
  assert.equal(validateDevelopmentInput({ name: 'X', kind: 'land', latitude: '-4.3' }).errorKey, 'admin.projects.errors.coordinates');
  assert.equal(validateDevelopmentInput({ name: 'X', kind: 'land', latitude: '48.8', longitude: '2.3' }).errorKey, 'admin.projects.errors.coordinates');
  assert.equal(
    validateDevelopmentInput({ name: 'X', kind: 'land', payment_plan: [{ label: 'a', percent: '40' }] }).errorKey,
    'admin.projects.errors.paymentPlan',
  );
  const ok = validateDevelopmentInput({ name: 'X', kind: 'building', stage: 'delivered', delivery_expected: '2027-01-01', video_url: 'javascript:alert(1)' });
  assert.equal(ok.value.delivery_expected, null, 'a delivered building has no expected delivery');
  assert.equal(ok.value.video_url, null, 'only https links survive');
  assert.equal(validateUnitTypeInput({ label: 'T2', units_total: '3', units_available: '4' }).errorKey, 'admin.projects.errors.units');
  assert.equal(validateLotInput({ label: 'L1', polygon: '1,1 2,2' }).errorKey, 'admin.projects.errors.polygon');
});

test('video: only YouTube is embedded, through the no-cookie host', () => {
  assert.equal(youtubeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(youtubeEmbedUrl('https://vimeo.com/1'), null);
  assert.equal(safeUrl('http://example.com'), null);
});

test('demand cells match live supply on commune, purpose, bedrooms and budget', () => {
  const cell = { commune: 'Gombe', transaction_type: 'location', bedrooms: 2, budget_min: 600, budget_max: 1000 };
  assert.equal(matchesDemandCell({ commune: 'Gombe', purpose: 'rent', beds: 3, price: '900' }, cell), true);
  assert.equal(matchesDemandCell({ commune: 'Gombe', purpose: 'sale', beds: 3, price: '900' }, cell), false);
  assert.equal(matchesDemandCell({ commune: 'Gombe', purpose: 'rent', beds: 1, price: '900' }, cell), false);
  assert.equal(matchesDemandCell({ commune: 'Gombe', purpose: 'rent', beds: 2, price: null }, cell), false, 'no price is never within budget');
  assert.equal(matchesDemandCell({ commune: 'Gombe', purpose: 'rent', beds: 2, price: '9600', price_period: 'an' }, cell), true, 'yearly rent compared per month');
  assert.equal(comparablePrice({ purpose: 'rent', price_period: 'an', price: '1200' }), 100);
});

test('a DATE column is never shifted a day by the time zone it is read in', async () => {
  const { dateOnly, dateOnlyInputValue } = await import('@/lib/developmentRules');
  const { dayLabel, deliveryLabel } = await import('@/lib/projectView');
  // node-postgres builds a DATE with LOCAL components, whatever the machine's zone.
  const fromPg = new Date(2026, 7, 20);
  assert.equal(dateOnlyInputValue(fromPg), '2026-08-20');
  assert.equal(dayLabel(fromPg, 'fr'), '20 août 2026');
  assert.equal(dayLabel('2026-04-02', 'fr'), '2 avril 2026');
  assert.equal(deliveryLabel(new Date(2027, 5, 30), 'fr'), 'juin 2027');
  assert.equal(dateOnly(null), null);
});
