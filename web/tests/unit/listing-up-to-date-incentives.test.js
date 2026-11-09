import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as listings from '@/lib/listings';
import { getAgentTrackRecord, AGENT_TRACK_RECORD_SQL } from '@/lib/agencies';
import { CONFIRM_AFTER_DAYS } from '@/lib/listingAvailability';
import { calls, enqueue, reset, getPool } from '../support/fakePool.js';

/**
 * Incentives for keeping listings up to date (web/CLAUDE.md, 2026-11-09):
 * the default search order puts up-to-date listings first, cards carry
 * "Confirmée le …", and the public agent profile shows a let/sold count and
 * an "Annonces à jour" chip. The engine's lead-routing boost is covered by
 * scripts/verify-pipeline.js §92.
 */

const APPROVED = 'p.status = 1 AND p.approve_status = 1';
const DAY = 86_400_000;
const root = process.cwd();

test.beforeEach(() => reset());

function dataQuery() {
  return calls.find((c) => /ORDER BY/.test(c.sql) && /LIMIT \$\d+ OFFSET/.test(c.sql));
}

test('"up to date" = the stamp, else the publication moment, within CONFIRM_AFTER_DAYS — read through to_jsonb', () => {
  const sql = listings.UP_TO_DATE_SQL;
  assert.ok(sql.includes("NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz"));
  assert.ok(sql.includes("GREATEST(p.created_at, COALESCE(NULLIF(to_jsonb(p) ->> 'moderated_at', '')::timestamptz, p.created_at))"),
    'the fallback is the "Nouveau" badge\'s publication moment');
  assert.ok(sql.includes(`NOW() - interval '${CONFIRM_AFTER_DAYS} days'`));
  assert.equal(CONFIRM_AFTER_DAYS, 14);
  assert.ok(!/p\.availability_confirmed_at/.test(sql), 'a plain column reference 500s before the migration');
});

test('the default order ranks up-to-date listings first, then the completeness order, and keeps the public gate', async () => {
  await listings.getListings({});
  const call = dataQuery();
  assert.ok(call, 'a data query was emitted');
  assert.ok(call.sql.includes(APPROVED));
  const orderBy = call.sql.slice(call.sql.lastIndexOf('ORDER BY'));
  const tier = orderBy.indexOf('(CASE WHEN (COALESCE(');
  const completeness = orderBy.indexOf('property_slider_images');
  assert.ok(tier > -1, 'the up-to-date tier is in the default ORDER BY');
  assert.ok(completeness > tier, 'completeness only orders inside a tier');
  assert.ok(/THEN 0 ELSE 1 END\) ASC/.test(orderBy), 'NULL (no date) sorts as stale, never first');
  for (const c of calls) assert.ok(c.sql.includes(APPROVED), 'count and data queries keep the public filter');
});

test('"complete" (the default named explicitly) gets the same tier', async () => {
  await listings.getListings({ sort: 'complete' });
  assert.ok(dataQuery().sql.includes(listings.UP_TO_DATE_TIER_SQL.replace(/\s+/g, ' ').trim()));
});

for (const sort of ['newest', 'price_asc', 'price_desc']) {
  test(`a visitor's explicit "${sort}" order is left exactly as chosen`, async () => {
    await listings.getListings({ sort });
    const orderBy = dataQuery().sql.slice(dataQuery().sql.lastIndexOf('ORDER BY'));
    assert.ok(!orderBy.includes('availability_confirmed_at'), `no tier in: ${orderBy}`);
  });
}

test('the card SELECT carries the stamp through to_jsonb (feeds the card badge)', async () => {
  await listings.getListings({});
  assert.ok(dataQuery().sql.includes("(to_jsonb(p) ->> 'availability_confirmed_at') AS availability_confirmed_at"));
});

test('the map endpoint keeps its own set and order', async () => {
  await listings.getMapMarkers({}, null);
  assert.ok(calls.length > 0, 'the map read ran');
  const sql = calls.map((c) => c.sql).join('\n');
  assert.ok(!sql.includes('availability_confirmed_at'));
});

test('availabilityBadge: a fresh stamp on an active (or legacy NULL) listing, formatted in both locales', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const stamp = new Date(now.getTime() - 2 * DAY).toISOString();
  const badge = listings.availabilityBadge({ availability_confirmed_at: stamp, listing_status: 'active' }, now);
  assert.deepEqual(badge, { fr: '7 nov.', en: '7 Nov' });
  assert.ok(listings.availabilityBadge({ availability_confirmed_at: stamp, listing_status: null }, now));
});

test('availabilityBadge: nothing for no stamp, an old stamp, or a listing that is not simply available', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const recent = new Date(now.getTime() - DAY).toISOString();
  assert.equal(listings.availabilityBadge({ availability_confirmed_at: null }, now), null);
  assert.equal(listings.availabilityBadge({ availability_confirmed_at: new Date(now.getTime() - 31 * DAY).toISOString() }, now), null);
  assert.equal(listings.availabilityBadge({ availability_confirmed_at: recent, listing_status: 'under_offer' }, now), null);
  assert.equal(listings.availabilityBadge({ availability_confirmed_at: recent, listing_status: 'closed' }, now), null);
});

test('card reads (search, ids, similar) hand each row its badge', async () => {
  const recent = new Date(Date.now() - DAY).toISOString();
  enqueue([{ total: '2' }]);
  enqueue([
    { id: 1, availability_confirmed_at: recent, listing_status: 'active' },
    { id: 2, availability_confirmed_at: null, listing_status: 'active' },
  ]);
  const { data } = await listings.getListings({});
  assert.ok(data[0].availability_badge?.fr);
  assert.equal(data[1].availability_badge, null);

  enqueue([{ id: 3, availability_confirmed_at: recent, listing_status: null }]);
  const byIds = await listings.getListingsByIds([3]);
  assert.ok(byIds[0].availability_badge?.en);
});

test('PropertyCard shows the server-decided badge in the date slot, with the i18n keys', () => {
  const src = readFileSync(path.join(root, 'components/PropertyCard.js'), 'utf8');
  assert.ok(src.includes('listing.availability_badge?.[t.locale]'));
  assert.ok(src.includes("t('listings.availability.confirmedShort'"));
  assert.ok(!src.includes('@/lib/listingAvailability'), 'a client component cannot import the server-only module');
  for (const locale of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(path.join(root, `lib/i18n/${locale}.json`), 'utf8'));
    assert.ok(dict.listings.availability.confirmedShort.includes('{date}'));
  }
});

test('track record SQL: closed = approved + closed (no public gate), live = public and not closed, stale counted with NULL as stale', () => {
  const sql = AGENT_TRACK_RECORD_SQL.replace(/\s+/g, ' ');
  assert.ok(sql.includes("FILTER (WHERE p.approve_status = 1 AND p.listing_status = 'closed') AS closed_count"));
  assert.ok(sql.includes("p.status = 1 AND p.approve_status = 1 AND p.listing_status IS DISTINCT FROM 'closed') AS live_count"));
  assert.ok(sql.includes('IS NOT TRUE) AS stale_count'));
  assert.ok(sql.includes('WHERE p.agent_id = $1'));
  assert.ok(!/price/i.test(sql), 'never a price');
});

test('getAgentTrackRecord: counts, and "à jour" only with at least one live listing and none stale', async () => {
  enqueue([{ closed_count: '3', live_count: '2', stale_count: '0' }]);
  assert.deepEqual(await getAgentTrackRecord(7), { closedCount: 3, liveCount: 2, upToDate: true });
  assert.deepEqual(calls[0].values, [7]);

  enqueue([{ closed_count: '0', live_count: '2', stale_count: '1' }]);
  assert.equal((await getAgentTrackRecord(7)).upToDate, false);

  enqueue([{ closed_count: '1', live_count: '0', stale_count: '0' }]);
  assert.deepEqual(await getAgentTrackRecord(7), { closedCount: 1, liveCount: 0, upToDate: false });

  assert.deepEqual(await getAgentTrackRecord('abc'), { closedCount: 0, liveCount: 0, upToDate: false });
});

test('getAgentTrackRecord never throws: a failed read shows neither line', async () => {
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => { throw Object.assign(new Error('boom'), { code: '57014' }); };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await getAgentTrackRecord(7), { closedCount: 0, liveCount: 0, upToDate: false });
  } finally {
    pool.query = original;
    console.error = originalError;
  }
});

test('the profile shows the let/sold count only from 1, and the chip only when up to date', () => {
  const page = readFileSync(path.join(root, 'app/(portfolio)/agents/[id]/page.js'), 'utf8');
  assert.ok(page.includes('getAgentTrackRecord(agent.id)'));
  assert.ok(page.includes("trackRecord.closedCount >= 1 ? t('agent.portfolio.statClosed'"));
  assert.ok(page.includes("trackRecord.upToDate ? t('agent.portfolio.upToDate')"));
  for (const locale of ['fr', 'en']) {
    const dict = JSON.parse(readFileSync(path.join(root, `lib/i18n/${locale}.json`), 'utf8'));
    const p = dict.agent.portfolio;
    assert.ok(p.statClosed.one && p.statClosed.other, 'plural object like statListings');
    assert.ok(p.upToDate);
    assert.ok(p.upToDateHint.includes('{days}'));
  }
  const en = JSON.parse(readFileSync(path.join(root, 'lib/i18n/en.json'), 'utf8'));
  assert.equal(en.agent.portfolio.statClosed.other, 'properties let or sold');
  assert.equal(en.agent.portfolio.upToDate, 'Listings up to date');
});
