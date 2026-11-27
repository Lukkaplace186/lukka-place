import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 2026-11-14, reported on an iPhone: tapping "Kintambo" in the search
 * suggestions did nothing. A tap on iOS sends the hover events first; when a
 * hover handler changes the page, Safari treats the tap as a hover and never
 * sends the click. The suggestion rows must not change state on a touch hover.
 */
const src = readFileSync(new URL('../../components/LocationAutocomplete.js', import.meta.url), 'utf8');

test('suggestion rows never change state on a mouseenter/mouseover (iOS swallows the tap)', () => {
  assert.doesNotMatch(src, /onMouseEnter=|onMouseOver=/);
});

test('the hover highlight is for a real mouse only', () => {
  assert.match(src, /onPointerEnter=\{\(e\) => \{\s*if \(e\.pointerType === 'mouse'\) setActiveIndex\(i\);/);
});

test('a suggestion is still chosen on click, with the keyboard kept open by mousedown', () => {
  assert.match(src, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}[\s\S]{0,700}onClick=\{\(\) => navigateTo\(result\)\}/);
});

test('picking a place drops the letters typed to find it, and keeps real words', async () => {
  const { withoutPlacePrefixes } = await import('@/lib/searchKeywords');
  assert.equal(withoutPlacePrefixes('ki', 'Kintambo', 'Kintambo'), '');
  assert.equal(withoutPlacePrefixes('Ma Camp', 'Ma Campagne', 'Ngaliema'), '');
  assert.equal(withoutPlacePrefixes('kintambo piscine', 'Kintambo', 'Kintambo'), 'piscine');
  assert.equal(withoutPlacePrefixes('cité', 'Cité-Verte', 'Selembao'), '');
  assert.equal(withoutPlacePrefixes('', 'Gombe'), '');
  assert.equal(withoutPlacePrefixes(undefined, 'Gombe'), '');
  assert.match(src, /withoutPlacePrefixes\(parsed\.keywords, result\.label, result\.commune\)/);
});
