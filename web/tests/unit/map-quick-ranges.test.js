import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as listings from '@/lib/listings';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { bedsRangeLabel, bedsRangeParams, priceRangeLabel, transactionHref } from '@/lib/mapQuickFilters';
import { calls, enqueue, reset } from '../support/fakePool.js';

// 2026-11-17 (owner): the phone map's Prix and Chambres are ranges ("350 $ à
// 650 $", "2 à 3 chambres") and Louer / Acheter replaced the Type chip.

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const money = (n) => String(n);
test.beforeEach(() => reset());

test('bedrooms range: from–to, a "to" below the "from" is dropped', () => {
  assert.deepEqual(bedsRangeParams('2', '3'), { beds_min: '2', beds_max: '3' });
  assert.deepEqual(bedsRangeParams('3', '2'), { beds_min: '3', beds_max: '' });
  assert.deepEqual(bedsRangeParams('', '2'), { beds_min: '', beds_max: '2' });
  assert.deepEqual(bedsRangeParams('', ''), { beds_min: '', beds_max: '' });
});

test('chip texts say the range in a few characters', () => {
  assert.equal(priceRangeLabel('350', '650', money), '350 – 650 $');
  assert.equal(priceRangeLabel('350', '', money), '≥ 350 $');
  assert.equal(priceRangeLabel('', '650', money), '≤ 650 $');
  assert.equal(priceRangeLabel('', 'over', money), '');
  assert.equal(bedsRangeLabel('2', '3'), '2 – 3 ch.');
  assert.equal(bedsRangeLabel('2', '2'), '2 ch.');
  assert.equal(bedsRangeLabel('2', ''), '2+ ch.');
  assert.equal(bedsRangeLabel('', '3'), '≤ 3 ch.');
  assert.equal(bedsRangeLabel('2', '3', 'bed'), '2 – 3 bed', 'the unit follows the language');
});

test('Louer / Acheter: picks one, tapping it again clears it, and the price range goes (different scales)', () => {
  const qs = (href) => new URLSearchParams(href.split('?')[1]);
  const picked = qs(transactionHref('?view=map&price_min=350&price_max=650&beds_min=2&page=3', '', 'vente'));
  assert.equal(picked.get('transaction_type'), 'vente');
  assert.equal(picked.get('price_min'), null);
  assert.equal(picked.get('price_max'), null);
  assert.equal(picked.get('beds_min'), '2', 'other filters stay');
  assert.equal(picked.get('page'), null);
  assert.equal(qs(transactionHref('?transaction_type=location', 'location', 'location')).get('transaction_type'), null);
});

test('beds_max reaches the query as p.beds <= $n, and is ignored below beds_min', async () => {
  assert.equal(parseListingsSearchParams(new URLSearchParams('beds_min=2&beds_max=3')).bedsMax, '3');

  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({ bedsMin: '2', bedsMax: '3' });
  const sql = calls.map((c) => c.sql).join('\n');
  assert.match(sql, /p\.beds >= \$\d+/);
  assert.match(sql, /p\.beds <= \$\d+/);
  assert.ok(calls[0].values.includes(3));

  reset();
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({ bedsMin: '3', bedsMax: '2' });
  assert.doesNotMatch(calls.map((c) => c.sql).join('\n'), /p\.beds <= /);
});

test('the map chips are Louer/Acheter, Prix, Chambres; the full filter sheet keeps beds_max', () => {
  const chips = read('components/MapQuickFilters.js');
  assert.match(chips, /<TransactionToggle/);
  assert.doesNotMatch(chips, /Building2|setOpen\('type'\)|property_type/, 'type lives in the filter sheet');
  assert.match(chips, /budgetParams\(draft\.min, draft\.max\)/);
  assert.match(chips, /bedsRangeParams\(draft\.min, draft\.max\)/);
  assert.match(chips, /bedsRangeLabel\(params\.beds_min, params\.beds_max, bedUnit\)/);
  assert.doesNotMatch(chips, / ch\.`/, 'no French unit hardcoded in the chips');
  const bar = read('components/FilterBar.js');
  assert.match(bar, /\['beds_max', keptBedsMax\]/);
  assert.match(bar, /if \(keptBedsMax\) qs\.set\('beds_max', keptBedsMax\);/);
  assert.match(read('app/(site)/listings/(search)/(results)/page.js'), /bedsMax: params\.beds_max,/);
});
