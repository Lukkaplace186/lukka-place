import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CLOSES_SQL, SEARCH_DEMAND_SQL, SUPPLY_SQL } from '@/lib/communeReport';
import { REPORT_COPY, bedsBucket, demandLine, summariseSupplyRow, suppressed, usd } from '@/lib/communeReportRules';
import { AREA_M2_SQL } from '@/lib/marketExclusions';
import { MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { COMPARABLES_SQL } from '@/lib/priceCheck';

const squash = (sql) => String(sql).replace(/\s+/g, ' ');

test('supply is live public listings only, test accounts excluded, one commune and purpose', () => {
  const sql = squash(SUPPLY_SQL);
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /COALESCE\(p\.listing_status, 'active'\) = 'active'/);
  assert.match(sql, /test_agent/);
  assert.match(sql, /GROUPING SETS \(\(type, beds_bucket\), \(type\), \(\)\)/);
  // Yearly rents are compared per month, never mixed in raw.
  assert.match(sql, /p\.price_period = 'an' THEN p\.price \/ 12\.0/);
});

test('closes use recorded sold prices only, never the asking price as a stand-in', () => {
  const sql = squash(CLOSES_SQL);
  assert.match(sql, /p\.listing_status = 'closed' AND p\.sold_price > 0 AND p\.sold_at IS NOT NULL/);
  assert.ok(!/p\.status = 1/.test(sql), 'a sold listing is status 0 — the public gate would drop every close');
  assert.match(sql, /test_agent/);
});

test('search demand counts people once and says how many found nothing', () => {
  const sql = squash(SEARCH_DEMAND_SQL);
  assert.match(sql, /count\(DISTINCT COALESCE\(s\.visitor_id, s\.id::text\)\)/);
  assert.match(sql, /FILTER \(WHERE s\.result_count = 0\)/);
  assert.match(sql, /\$2 = ANY\(s\.communes\)/);
});

test('an area is read only when it is a plain number — "12x20" is not 1220 m²', () => {
  assert.match(AREA_M2_SQL, /\^\[\[:space:\]\]\*\[0-9\]\+/);
  assert.ok(AREA_M2_SQL.includes('(m|m2|m²)?'));
  // The regex Postgres will run, checked here with the same POSIX semantics.
  const re = /^[\s]*[0-9]+([.,][0-9]+)?[\s]*(m|m2|m²)?[\s]*$/;
  for (const ok of ['600', '600 m²', '85,5 m2', ' 120m ']) assert.ok(re.test(ok), ok);
  for (const no of ['12x20', '20 x 30', '600m² environ', 'deux cents']) assert.ok(!re.test(no), no);
  // The price check reads area the same way.
  assert.ok(COMPARABLES_SQL.includes(AREA_M2_SQL));
});

test('below the minimum sample a median is "—", its count kept', () => {
  assert.equal(suppressed(1234.4, MIN_SAMPLE), 1234);
  assert.equal(suppressed(1234.4, MIN_SAMPLE - 1), null);
  assert.equal(suppressed(null, 50), null);
  const row = summariseSupplyRow({ level: 0, type: 'Appartement', beds_bucket: '2', listings: 4, priced: 4, p25: 500, median: 700, p75: 900, median_per_sqm: 9, sqm_sample: 2, median_age_days: 30 });
  assert.equal(row.listings, 4);
  assert.equal(row.median, null);
  assert.equal(row.p25, null);
  assert.equal(row.medianPerSqm, null);
  assert.equal(usd(null), '—');
  assert.equal(usd(1200), '1 200 $');
});

test('bedroom buckets sort and read in French', () => {
  assert.deepEqual(['na', '4+', '1', '0', '2'].sort((a, b) => bedsBucket.order(a) - bedsBucket.order(b)), ['0', '1', '2', '4+', 'na']);
  assert.equal(bedsBucket.label('1'), '1 chambre');
  assert.equal(bedsBucket.label('3'), '3 chambres');
  assert.equal(bedsBucket.label('4+'), '4 chambres et plus');
  assert.equal(demandLine({ searches: 1, people: 1, unserved: 0 }), '1 recherche · 1 personne · 0 sans résultat');
  assert.match(REPORT_COPY.rule, new RegExp(`${MIN_SAMPLE} observations`));
});

test('the report page accepts only the 24 verified commune names', () => {
  const page = readFileSync(new URL('../../app/admin/market-data/rapport/[commune]/page.js', import.meta.url), 'utf8');
  assert.match(page, /Object\.hasOwn\(KINSHASA_COMMUNE_CENTROIDS, commune\)\) notFound\(\)/);
});

test('the public median line never shows the whole-commune mix or a verdict on the listing', () => {
  const line = readFileSync(new URL('../../components/listings/MarketMedianLine.js', import.meta.url), 'utf8');
  assert.match(line, /\['beds', 'type'\]\.includes\(position\.scope\)/);
  assert.ok(!/differencePct/.test(line.replace(/\/\*[\s\S]*?\*\//g, '')), 'no percentage against the listing');
});
