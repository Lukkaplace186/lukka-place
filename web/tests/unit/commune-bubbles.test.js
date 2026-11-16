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

test('preview: zoomed out, every listing with a commune is one bubble per commune, at its listings\' median', async () => {
  const { groupByArea, AREA_ZOOM_BELOW } = await import('@/lib/communeBubbles');
  const markers = [
    marker(1, { commune: 'Gombe', lat: -4.30, lng: 15.30 }),
    marker(2, { commune: 'Gombe', lat: -4.31, lng: 15.31 }),
    marker(3, { commune: 'Gombe', lat: -4.32, lng: 15.29, approximate: true }),
    marker(4, { commune: 'Limete', lat: -4.36, lng: 15.34 }),
    marker(5, { commune: null, address: '', quartier: '', lat: -4.4, lng: 15.4 }),
  ];
  const { areas, rest } = groupByArea(markers);
  assert.equal(AREA_ZOOM_BELOW, 14, 'a searched commune opens at 14, on prices');
  assert.deepEqual(areas.map((a) => [a.communeName, a.unitCount]), [['Gombe', 3], ['Limete', 1]]);
  assert.deepEqual([areas[0].representative.lat, areas[0].representative.lng], [-4.31, 15.30]);
  assert.equal(areas[0].isArea, true);
  assert.deepEqual(rest.map((m) => m.id), [5], 'no commune → keeps its own price pin');
});

test('preview is opt-in (?apercu=carte): the live map is unchanged without it', () => {
  const map = read('components/ListingsMap.js');
  assert.match(map, /get\('apercu'\) === 'carte'/);
  assert.match(map, /const areaMode = preview && \(map\.getZoom\(\) \?\? 13\) < AREA_ZOOM_BELOW;/);
  assert.match(map, /if \(pin\.group\?\.isArea\) \{/, 'a commune bubble zooms in to its prices');
  assert.match(map, /addListener\('zoom_changed'/);
});
