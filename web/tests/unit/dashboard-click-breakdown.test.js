import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLICK_BASE_CTE,
  PEOPLE_KINDS_SQL,
  PRICE_BANDS,
  getWhatsAppClickBreakdown,
  getWhatsAppClickTotals,
  getWhatsAppConversionRate,
  parseClickPeriod,
  peopleSql,
} from '@/lib/analytics';
import {
  LEAD_CLICK_PLACEMENTS,
  RECORD_LEAD_CLICK_PLACEMENT_SQL,
  RECORD_LEAD_CLICK_SQL,
  recordLeadClick,
} from '@/lib/leadClicks';
import { getPool } from '@/lib/db';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

/**
 * The admin dashboard's WhatsApp click splits (lib/analytics.js). What
 * matters is that the headline and every split except "Audience" count
 * PEOPLE — not the team, an agent on their own listing, or a crawler — and
 * that the period is bound, so the SQL text is asserted.
 */

test('the period picker accepts only its own keys', () => {
  assert.equal(parseClickPeriod('7').days, 7);
  assert.equal(parseClickPeriod(['90']).days, 90);
  assert.equal(parseClickPeriod('tout').days, null);
  assert.equal(parseClickPeriod('365').key, '30', 'an unknown period falls back to the default');
  assert.equal(parseClickPeriod(undefined).key, '30');
});

test('a person is a visitor, or a pre-tracking row, and never a crawler', () => {
  const sql = normalizeSql(peopleSql('w'));
  assert.match(sql, /COALESCE\(to_jsonb\(w\) ->> 'viewer_kind', 'visitor'\) = 'visitor'/);
  assert.match(sql, /COALESCE\(w\.device, ''\) <> 'bot'/);
  const base = normalizeSql(CLICK_BASE_CTE);
  // Read through to_jsonb so the dashboard never 42703s before the migrations.
  for (const column of ['viewer_kind', 'routing_type', 'placement', 'visitor_id']) {
    assert.match(base, new RegExp(`to_jsonb\\(w\\) ->> '${column}'`));
  }
  assert.match(base, /THEN 'bot'/, 'a crawler row is a bot whatever its viewer_kind');
  assert.match(base, /\$1::int IS NULL OR w\.created_at >= NOW\(\) - make_interval\(days => \$1::int\)/);
  assert.equal(PEOPLE_KINDS_SQL, `c.kind IN ('visitor', 'avant_suivi')`);
});

test('totals: people headline, excluded remainder, previous window of the same length', async () => {
  reset();
  enqueue([{ all_clicks: 40, people: 32, unique_visitors: 18, identified: 25 }]);
  enqueue([{ people: 20 }]);
  const totals = await getWhatsAppClickTotals({ sinceDays: 30 });
  assert.deepEqual(totals, { all: 40, people: 32, excluded: 8, uniqueVisitors: 18, previous: 20 });
  assert.deepEqual(calls[0].values, [30]);
  assert.match(normalizeSql(calls[1].sql), /days => \$1::int \* 2/);

  reset();
  enqueue([{ all_clicks: 5, people: 5, unique_visitors: 0, identified: 0 }]);
  const allTime = await getWhatsAppClickTotals({ sinceDays: null });
  assert.equal(allTime.previous, null, 'no previous window for "since the start"');
  assert.equal(allTime.uniqueVisitors, null, 'no visitor ids yet → unknown, not 0');
  assert.equal(calls.length, 1);
});

test('every split but Audience counts people only, and each is bound to the period', async () => {
  reset();
  const breakdown = await getWhatsAppClickBreakdown({ sinceDays: 7 });
  // 8 splits + the weekly trend.
  assert.equal(calls.length, 9);
  const [audience, ...rest] = calls.slice(0, 8);
  assert.ok(!normalizeSql(audience.sql).includes(PEOPLE_KINDS_SQL), 'Audience shows everybody');
  for (const call of rest) {
    assert.ok(normalizeSql(call.sql).includes(PEOPLE_KINDS_SQL), normalizeSql(call.sql).slice(0, 200));
    assert.equal(call.values[0], 7);
  }
  assert.deepEqual(Object.keys(breakdown), [
    'audience', 'routing', 'placement', 'source', 'commune', 'propertyType', 'priceBand', 'topListings', 'weekly',
  ]);
});

test('price bands are rent per month in dollars; anything else is "unknown", never guessed', async () => {
  reset();
  // audience, routing, placement, source, commune, type — then price.
  for (let i = 0; i < 6; i += 1) enqueue([]);
  enqueue([{ key: 'unknown', clicks: 1 }, { key: 'sale_lt25k', clicks: 2 }, { key: 'rent_lt300', clicks: 3 }]);
  const { priceBand } = await getWhatsAppClickBreakdown({ sinceDays: 30 });
  assert.deepEqual(priceBand.map((b) => b.key), ['rent_lt300', 'sale_lt25k', 'unknown'], 'display order');
  const sql = normalizeSql(calls[6].sql);
  assert.match(sql, /UPPER\(COALESCE\(p\.currency, 'USD'\)\) <> 'USD' THEN 'unknown'/);
  assert.match(sql, /WHEN p\.price_period = 'an' THEN c\.price \/ 12/);
  assert.match(sql, /p\.price_period IN \('jour', 'semaine'\) THEN 'rent_short'/);
  assert.equal(PRICE_BANDS.at(-1), 'unknown');
});

test('the conversion rate divides people by people', async () => {
  reset();
  enqueue([{ views: 200, clicks: 10 }]);
  assert.equal(await getWhatsAppConversionRate({ sinceDays: 30 }), 0.05);
  const sql = normalizeSql(calls[0].sql);
  assert.ok(sql.includes(normalizeSql(peopleSql('v'))));
  assert.ok(sql.includes(normalizeSql(peopleSql('w'))));
  reset();
  enqueue([{ views: 0, clicks: 3 }]);
  assert.equal(await getWhatsAppConversionRate(), null, 'no views → no rate, not 0 %');
});

test('a tap records which button it came from, and falls back before the migration', async () => {
  assert.deepEqual(LEAD_CLICK_PLACEMENTS, ['card', 'listing_page', 'listing_mobile_bar']);
  const migration = readFileSync(new URL('../../../migrations/20261026_whatsapp_click_placement.sql', import.meta.url), 'utf8');
  for (const placement of LEAD_CLICK_PLACEMENTS) assert.ok(migration.includes(`'${placement}'`), placement);

  reset();
  await recordLeadClick(getPool(), { listingId: 7, routingType: 'DIRECT_WA', placement: 'listing_mobile_bar' });
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(RECORD_LEAD_CLICK_PLACEMENT_SQL));
  assert.equal(calls[0].values.at(-1), 'listing_mobile_bar');

  reset();
  await recordLeadClick(getPool(), { listingId: 7, routingType: 'DIRECT_WA', placement: 'somewhere' });
  assert.equal(normalizeSql(calls[0].sql), normalizeSql(RECORD_LEAD_CLICK_SQL), 'an unknown placement is stored as none');

  for (const [file, placement] of [
    ['components/WhatsAppCTA.js', 'card'],
    ['components/EnquiryCard.js', 'listing_page'],
    ['components/MobileListingBar.js', 'listing_mobile_bar'],
  ]) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`trackLeadClick\\(listing, routingType, '${placement}'\\)`), file);
  }
});
