import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  INDEX_COMPARABLE_FROM,
  LUKKA_INDEX_SQL,
  LUKKA_RENTS_AS_OF_SQL,
  MARKET_RENTS_AS_OF_SQL,
  firstChangeDay,
  getLukkaIndex,
  indexChange,
  isComparableDay,
  kinshasaDate,
  oneMonthBefore,
} from '@/lib/lukkaIndex';
import { MARKET_RENTS_SQL, marketRentsSql } from '@/lib/marketGuide';
import { RESIDENTIAL_KINDS } from '@/lib/marketObservationRules';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const squash = (sql) => sql.replace(/\s+/g, ' ');
const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');

test('the index reads observations with the price guide’s own text, only the instant changes', () => {
  assert.equal(MARKET_RENTS_SQL, marketRentsSql('NOW()'));
  assert.equal(MARKET_RENTS_AS_OF_SQL, marketRentsSql('$1::timestamptz'));
  const market = squash(MARKET_RENTS_AS_OF_SQL);
  assert.doesNotMatch(market, /NOW\(\)/, 'every date rule is read at the as-of instant');
  assert.match(market, /o\.excluded_reason IS NULL/);
  assert.match(market, /o\.furnished IS NOT TRUE/);
  assert.match(market, /COALESCE\(o\.posted_at, o\.first_seen_at\) <= \$1::timestamptz/, 'not yet posted at D: not counted at D');
  assert.match(market, /o\.last_seen_at >= \$1::timestamptz - INTERVAL '60 days'/);
  assert.match(market, />= \$1::timestamptz - INTERVAL '92 days'\) AS recent/);
});

test('a Lukka listing counts at D only if it was approved, moderated and public at D, at its price that day', () => {
  const lukka = squash(LUKKA_RENTS_AS_OF_SQL);
  assert.match(lukka, /p\.approve_status = 1/);
  assert.doesNotMatch(lukka, /NOW\(\)/);
  assert.match(lukka, /p\.created_at <= \$1::timestamptz/);
  assert.match(lukka, /'moderated_at'\)::timestamptz, p\.created_at\) <= \$1::timestamptz/, 'approved after D was pending at D');
  // Public today, or taken off (archived / closed) only after D.
  assert.match(lukka, /\(p\.status = 1 OR \(to_jsonb\(p\) ->> 'archived_at'\)::timestamptz > \$1::timestamptz OR \(to_jsonb\(p\) ->> 'sold_at'\)::timestamptz > \$1::timestamptz\)/);
  assert.match(lukka, /FROM property_price_history h WHERE h\.property_id = p\.id AND h\.changed_at <= \$1::timestamptz/);
  assert.match(lukka, /NOT IN \('jour', 'semaine'\)/, 'short stays never enter a monthly median');
  assert.match(lukka, /p\.price_period = 'an' THEN px\.price \/ 12\.0/);
  assert.match(lukka, /test_agent/, 'test agencies are left out');
  assert.match(lukka, /p\.beds BETWEEN 1 AND 5/);
});

test('one advert counts once, recent ones weigh double in the figure, never in the count', () => {
  const sql = squash(LUKKA_INDEX_SQL);
  // De-duplication keeps the bedrooms in its key, even though the index pools them.
  assert.match(sql, /GROUP BY commune, beds, ROUND\(amount\), src/);
  assert.match(sql, /SELECT commune, beds, amt, MAX\(n\)::int AS n, LEAST\(MAX\(r\), MAX\(n\)\)::int AS r/);
  assert.match(sql, /SELECT commune, SUM\(n\)::int AS listings, SUM\(lukka_n\)::int AS lukka_listings FROM points GROUP BY commune HAVING SUM\(n\) >= \$3/);
  assert.match(sql, /generate_series\(1, \(points\.n - points\.r\) \+ points\.r \* 2\)/);
  assert.match(sql, /PERCENTILE_CONT\(0\.5\) WITHIN GROUP \(ORDER BY w\.amt\)/);
});

test('dates: one calendar month back, Kinshasa days, first comparable day', () => {
  assert.equal(oneMonthBefore(new Date('2026-12-10T12:00:00Z')).toISOString(), '2026-11-10T12:00:00.000Z');
  assert.equal(oneMonthBefore(new Date('2027-03-31T08:00:00Z')).toISOString(), '2027-02-28T08:00:00.000Z');
  assert.equal(oneMonthBefore(new Date('2027-01-15T08:00:00Z')).toISOString(), '2026-12-15T08:00:00.000Z');
  assert.equal(kinshasaDate(new Date('2026-11-10T23:30:00Z')), '2026-11-11');
  assert.equal(INDEX_COMPARABLE_FROM, '2026-11-04');
  assert.equal(firstChangeDay(), '2026-12-04');
  assert.equal(firstChangeDay('2027-01-31'), '2027-02-28');
  assert.equal(isComparableDay(new Date('2026-11-03T22:59:00Z')), false);
  assert.equal(isComparableDay(new Date('2026-11-03T23:00:00Z')), true);
});

test('a change needs both days at the minimum sample', () => {
  assert.equal(indexChange({ listings: 6, median: 1100 }, { listings: 5, median: 1000 }, 5), 10);
  assert.equal(indexChange({ listings: 6, median: 900 }, { listings: 5, median: 1000 }, 5), -10);
  assert.equal(indexChange({ listings: 6, median: 1100 }, { listings: 4, median: 1000 }, 5), null);
  assert.equal(indexChange({ listings: 6, median: 1100 }, undefined, 5), null);
});

/** A pool that answers from a script and records what it was asked. */
function scriptedPool(script) {
  const seen = [];
  return {
    seen,
    async query(text, values) {
      seen.push({ text, values });
      const next = script.shift();
      if (next instanceof Error) throw next;
      return { rows: next || [] };
    },
  };
}

const row = (commune, median, listings, extra = {}) => ({
  commune, median, p25: median - 100, p75: median + 100, listings, lukka_listings: 2, sources: { smartimmo: listings }, ...extra,
});

test('before the first comparable day only today is queried and no change is printed', async () => {
  const pool = scriptedPool([[row('Gombe', 1500, 9), row('Limete', 600, 7)]]);
  const index = await getLukkaIndex({ minSample: 5, now: new Date('2026-11-11T07:00:00Z'), pool });
  assert.equal(pool.seen.length, 1);
  assert.deepEqual(pool.seen[0].values, ['2026-11-11T07:00:00.000Z', RESIDENTIAL_KINDS, 5]);
  assert.equal(index.comparable, false);
  assert.equal(index.asOf, '2026-11-11');
  assert.equal(index.firstChange, '2026-12-04');
  assert.deepEqual(index.communes.map((c) => [c.commune, c.changePct]), [['Gombe', null], ['Limete', null]]);
  assert.equal(index.listings, 16);
  assert.equal(index.lukkaListings, 4);
  assert.deepEqual(index.sources, { smartimmo: 16 });
});

test('afterwards the same SQL runs as of one month earlier and gives the change', async () => {
  const pool = scriptedPool([[row('Gombe', 1100, 9), row('Limete', 600, 7)], [row('Gombe', 1000, 8)]]);
  const index = await getLukkaIndex({ minSample: 5, now: new Date('2026-12-10T12:00:00Z'), pool });
  assert.equal(pool.seen.length, 2);
  assert.equal(pool.seen[1].text, LUKKA_INDEX_SQL);
  assert.equal(pool.seen[1].values[0], '2026-11-10T12:00:00.000Z');
  assert.equal(index.comparable, true);
  assert.equal(index.previousAsOf, '2026-11-10');
  const gombe = index.communes.find((c) => c.commune === 'Gombe');
  assert.equal(gombe.changePct, 10);
  assert.equal(gombe.previous, 1000);
  assert.equal(index.communes.find((c) => c.commune === 'Limete').changePct, null);
});

test('nothing to publish, or a missing table, is null and never throws', async () => {
  assert.equal(await getLukkaIndex({ minSample: 5, now: new Date('2026-11-11T07:00:00Z'), pool: scriptedPool([[]]) }), null);
  const missing = Object.assign(new Error('relation "market_observations" does not exist'), { code: '42P01' });
  assert.equal(await getLukkaIndex({ minSample: 5, now: new Date('2026-11-11T07:00:00Z'), pool: scriptedPool([missing]) }), null);
});

test('the method page exists, links back, and reads its numbers from the rules', () => {
  const page = read('app/(site)/indice-lukka/methodologie/page.js');
  for (const name of ['MARKET_WINDOW_DAYS', 'STILL_LISTED_DAYS', 'RECENT_DAYS', 'RECENT_WEIGHT', 'RENT_BOUNDS', 'MIN_PRICE_SAMPLE', 'INDEX_COMPARABLE_FROM']) {
    assert.match(page, new RegExp(name), name);
  }
  assert.match(read('app/(site)/indice-lukka/page.js'), /href="\/indice-lukka\/methodologie"/);
  assert.match(read('app/sitemap.js'), /'\/indice-lukka\/methodologie'/);
  // No number typed into the copy that the rules own.
  for (const dict of [fr, en]) {
    const text = JSON.stringify(dict.home.index.methodology);
    assert.doesNotMatch(text, /\b(92|365|60|20 ?000)\b/);
    assert.match(dict.home.index.methodology.weight, /\{recentDays\}/);
  }
});
