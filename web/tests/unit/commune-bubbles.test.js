import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitCommuneBubbles, communeBubbleLabel } from '@/lib/communeBubbles';
import { locationTextChanged } from '@/lib/agentListings';

// 2026-11-14: 307 of 592 public listings had no stored point and were drawn on
// their commune's centre, fanned into a ~1 km ring (89 in Limete). Two or
// more of them in one commune are now one bubble; web-created listings are
// now located by the engine like WhatsApp ones.

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const marker = (id, extra) => ({ id, lat: -4.36, lng: 15.34, price: 500, purpose: 'rent', ...extra });

test('listings on a commune centre become one bubble per commune; located ones are untouched', () => {
  const markers = [
    marker(1, { approximate: true, commune: 'Limete' }),
    marker(2, { approximate: true, commune: 'Limete', price: 900 }),
    marker(3, { approximate: true, commune: 'Limete', price: 300 }),
    marker(4, { approximate: false, commune: 'Limete' }),
    marker(5, { approximate: true, commune: 'Gombe' }),
  ];
  const { bubbles, rest } = splitCommuneBubbles(markers);
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].communeName, 'Limete');
  assert.deepEqual(bubbles[0].listings.map((l) => l.id), [1, 2, 3]);
  assert.equal(bubbles[0].isCommune, true);
  assert.equal(bubbles[0].isBuilding, true, 'takes the building click path and drawer');
  assert.deepEqual([bubbles[0].priceMin, bubbles[0].priceMax], [300, 900]);
  // A lone commune-centre listing keeps its own price pin.
  assert.deepEqual(rest.map((m) => m.id), [4, 5]);
  assert.equal(communeBubbleLabel(bubbles[0]), '3 biens · Limete');
});

test('a commune bubble is drawn at the centre, under located pins, and opens the list', () => {
  const map = read('components/ListingsMap.js');
  assert.match(map, /splitCommuneBubbles\(markers\)/);
  assert.match(map, /exact: Boolean\(group\.isCommune\)/, 'no jitter, no ring for a bubble');
  assert.match(map, /if \(group\.isCommune\) return 0;/);
  const drawer = read('components/BuildingUnitsDrawer.js');
  assert.match(drawer, /emplacement précis non indiqué/);
  assert.match(read('lib/mapPinLayer.js'), /dataset\.commune/);
  assert.match(read('app/globals.css'), /\.lkp-pin\[data-commune='true'\]/);
});

test('every web form that writes a listing asks the engine to place it', () => {
  const agent = read('app/compte/agent/actions.js');
  assert.match(agent, /void geocodeListing\(propertyId\);/, 'agent create');
  assert.match(agent, /void geocodeListing\(propertyId, \{\s*replace: locationTextChanged\(locationBefore/, 'agent edit');
  assert.match(read('app/admin/listings/createActions.js'), /void geocodeListing\(propertyId\);/, 'admin create');
  assert.match(read('app/admin/listings/[id]/actions.js'), /void geocodeListing\(propertyId\);/, 'admin edit (fill only)');
  assert.match(read('lib/adminApi.js'), /\/admin\/properties\/\$\{Number\(propertyId\)\}\/geocode/);
});

test('only a changed quartier, reference or commune asks for a new point', () => {
  const before = { quartier: 'Industriel', reference: null, commune: 'Limete' };
  assert.equal(locationTextChanged(before, { quartier: ' industriel ', reference: '', commune: 'Limete' }), false);
  assert.equal(locationTextChanged(before, { quartier: 'Industriel', reference: 'Clinique Raphaël', commune: 'Limete' }), true);
  assert.equal(locationTextChanged(before, { quartier: 'Industriel', reference: null, commune: 'Lemba' }), true);
  assert.equal(locationTextChanged(null, before), false);
});

test('the polished price tag is the live map: same pins, same label, finish in CSS only', () => {
  const map = read('components/ListingsMap.js');
  assert.doesNotMatch(map, /apercu|previewRef|mapPreviewOn|groupByArea|pillTone|purpose: group/);
  assert.match(map, /return `\$\{group\.unitCount\} unités\$\{from\}`;/, 'building tag: "3 unités · dès $650"');
  const layer = read('lib/mapPinLayer.js');
  assert.match(layer, /this\.container\.className = 'lkp-layer';/);
  assert.doesNotMatch(layer, /renderLabel|lkp-pin__cur|layerDepth/, 'the price label is plain text, "$" included');
  const css = read('app/globals.css');
  assert.doesNotMatch(css, /lkp-layer--preview/);
  const from = css.indexOf('/* Price tag finish (2026-11-17');
  const finish = css.slice(from, css.indexOf(".lkp-pin[data-visited='true'] {", from));
  assert.ok(from > 0 && finish.length > 200, 'finish block found');
  assert.doesNotMatch(finish, /border-radius|opacity|--lkp-bg/, 'same shape, colours and full-strength "$" as before');
  assert.match(finish, /\.lkp-layer \.lkp-pin:hover \{ z-index: 2999999 !important; \}/);
});
