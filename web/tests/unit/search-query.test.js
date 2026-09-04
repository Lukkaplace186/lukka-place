import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingsSearchParams } from '@/lib/searchQuery';

test('ids are parsed to integers, so a hand-edited link cannot inject anything', () => {
  const parsed = parseListingsSearchParams(new URLSearchParams('ids=281,284'));
  assert.deepEqual(parsed.ids, [281, 284]);
});

test('non-numeric ids are dropped rather than passed through', () => {
  const parsed = parseListingsSearchParams(new URLSearchParams("ids=281,DROP TABLE,284"));
  assert.deepEqual(parsed.ids, [281, 284]);
});

test('an absent ids param is null, not an empty set', () => {
  // The distinction matters: null means "no id filter", [] means "this
  // specific empty set", which must return nothing.
  assert.equal(parseListingsSearchParams(new URLSearchParams('commune=Gombe')).ids, null);
});

test('the saved-search query round-trips alongside ids', () => {
  const parsed = parseListingsSearchParams(new URLSearchParams('commune=Gombe&beds_min=2&ids=281'));
  assert.equal(parsed.commune, 'Gombe');
  assert.equal(parsed.bedsMin, '2');
  assert.deepEqual(parsed.ids, [281]);
});
