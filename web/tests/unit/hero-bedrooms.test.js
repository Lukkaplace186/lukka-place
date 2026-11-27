import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as listings from '@/lib/listings';
import { bedroomBounds, bedroomRangeLabel } from '@/lib/bedroomRange';
import { HERO_BED_STEPS, bedsOptions, heroBedsParams, studioOffered, typeHasBedrooms } from '@/lib/heroBedrooms';
import { searchCriteriaTags } from '@/lib/searchLabel';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * 2026-11-25: the hero search's Chambres Min | Max pair (Rightmove-style),
 * with Studio as bound 0 = the Studio type. lib/bedroomRange.js and
 * lib/heroBedrooms.js say why each rule is what it is.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('bounds: 0 is Studio, a max below the min is dropped', () => {
  assert.deepEqual(bedroomBounds('2', '4'), { min: 2, max: 4, studio: null });
  assert.deepEqual(bedroomBounds('4', '2'), { min: 4, max: null, studio: null });
  assert.deepEqual(bedroomBounds('0', '2'), { min: 1, max: 2, studio: 'include' });
  assert.deepEqual(bedroomBounds('0', ''), { min: 1, max: null, studio: 'include' });
  assert.deepEqual(bedroomBounds('0', '0'), { min: null, max: null, studio: 'only' });
  assert.deepEqual(bedroomBounds('', '0'), { min: null, max: null, studio: 'only' });
  assert.deepEqual(bedroomBounds('', ''), { min: null, max: null, studio: null });
  assert.deepEqual(bedroomBounds('-1', 'x'), { min: null, max: null, studio: null });
});

test('labels read a range as one', () => {
  assert.equal(bedroomRangeLabel('2', '4', 'ch'), '2 – 4 ch');
  assert.equal(bedroomRangeLabel('2', '2', 'ch'), '2 ch');
  assert.equal(bedroomRangeLabel('0', '2', 'ch'), 'Studio – 2 ch');
  assert.equal(bedroomRangeLabel('0', '0', 'ch'), 'Studio');
  assert.equal(bedroomRangeLabel('0', '', 'ch'), 'Studio+');
  assert.equal(bedroomRangeLabel('3', '', 'ch'), '3+ ch');
  assert.equal(bedroomRangeLabel('', '', 'ch'), '');
  const t = (key, vars) => ({ 'search.tags.bedsUnit': 'ch.', 'search.tags.studio': 'Studio' })[key] ?? `${key}:${vars?.count ?? ''}`;
  assert.ok(searchCriteriaTags(new URLSearchParams('beds_min=0&beds_max=2'), t).includes('Studio – 2 ch.'));
  assert.ok(searchCriteriaTags(new URLSearchParams('beds_min=2'), t).includes('search.tags.bedsMin:2'));
});

test('the hero sends Studio → N as 0 → N, Studio alone as 0 → 0, and drops a max below the min', () => {
  assert.deepEqual(HERO_BED_STEPS, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(heroBedsParams('2', '4'), { beds_min: '2', beds_max: '4' });
  assert.deepEqual(heroBedsParams('0', '2'), { beds_min: '0', beds_max: '2' });
  assert.deepEqual(heroBedsParams('', '0'), { beds_min: '0', beds_max: '0' });
  assert.deepEqual(heroBedsParams('3', '1'), { beds_min: '3', beds_max: '' });
  assert.deepEqual(heroBedsParams('', ''), { beds_min: '', beds_max: '' });
});

test('each select disables what contradicts the other; Studio only when there are studios', () => {
  const labels = { minAny: 'Min', maxAny: 'Max', studio: 'Studio', count: (n) => `${n} ch` };
  const { minOptions, maxOptions } = bedsOptions({ min: '2', max: '4' }, labels);
  assert.deepEqual(minOptions.map((o) => o.label), ['Min', 'Studio', '1 ch', '2 ch', '3 ch', '4 ch', '5 ch']);
  assert.deepEqual(minOptions.filter((o) => o.disabled).map((o) => o.value), ['5']);
  assert.deepEqual(maxOptions.filter((o) => o.disabled).map((o) => o.value), ['0', '1']);
  const noStudio = bedsOptions({}, labels, { studio: false });
  assert.ok(!noStudio.minOptions.some((o) => o.value === '0'));
  assert.equal(studioOffered([{ value: 'studio', count: 24 }]), true);
  assert.equal(studioOffered([{ value: 'studio', count: 0 }]), false);
});

test('the pair hides for land, commercial space, studios and single rooms', () => {
  const facets = [{ value: 'appartement', group: 'residential' }, { value: 'bureau', group: 'commercial' }];
  for (const type of ['', 'appartement', 'maison', 'parcelle', 'villa', 'duplex']) assert.equal(typeHasBedrooms(type, facets), true, type);
  for (const type of ['terrain', 'ferme / terrain agricole', 'commercial', 'bureau', 'studio', 'chambre / annexe']) {
    assert.equal(typeHasBedrooms(type, facets), false, type);
  }
});

test('SQL: Studio → 2 is (studio type OR 1..2 beds); Studio alone is the studio type; 2 → 4 unchanged', async () => {
  const sqlFor = async (bedsMin, bedsMax) => {
    reset();
    enqueue([{ total: '0' }]);
    enqueue([]);
    await listings.getListings({ bedsMin, bedsMax });
    return { sql: calls.map((c) => c.sql).join('\n'), values: calls[0].values };
  };

  let { sql, values } = await sqlFor('0', '2');
  assert.match(sql, /\(\(LOWER\(catc\.name\) = ANY\(\$\d+\).*\) OR \(p\.beds >= \$\d+ AND p\.beds <= \$\d+\)\)/s);
  assert.ok(values.includes(1) && values.includes(2));

  ({ sql } = await sqlFor('0', '0'));
  assert.match(sql, /LOWER\(catc\.name\) = ANY/);
  assert.doesNotMatch(sql, /p\.beds [<>]=/);

  ({ sql, values } = await sqlFor('2', '4'));
  assert.match(sql, /p\.beds >= \$\d+/);
  assert.match(sql, /p\.beds <= \$\d+/);
  assert.doesNotMatch(sql, /OR \(p\.beds/);
});

test('the hero sends the beds params to the count and to /listings, and FR/EN carry the labels', () => {
  const src = read('../../components/SearchBar.js');
  assert.match(src, /beds_min: stagedBeds\.beds_min/);
  assert.match(src, /qs\.set\('beds_min', stagedBeds\.beds_min\)/);
  assert.match(src, /qs\.set\('beds_max', stagedBeds\.beds_max\)/);
  for (const locale of ['fr', 'en']) {
    const dict = JSON.parse(read(`../../lib/i18n/${locale}.json`));
    for (const key of ['bedrooms', 'studio', 'bedsCount', 'bedsMinAria', 'bedsMaxAria']) assert.ok(dict.home.search[key], `${locale} ${key}`);
    for (const key of ['studio', 'bedsUnit']) assert.ok(dict.search.tags[key], `${locale} tags ${key}`);
  }
});
