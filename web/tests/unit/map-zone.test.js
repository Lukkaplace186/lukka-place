// A zone drawn by hand on the listings map (2026-11-13): the shape's rules,
// its place in the URL, and where it narrows the search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MAX_ZONE_POINTS, ZONE_DRAW_PUBLIC, parseZone, pointInZone, simplifyScreenPath, zoneBounds, zoneToParam } from '@/lib/mapZone';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

// A rough square around Lingwala.
const SQUARE = [
  { lat: -4.31, lng: 15.29 },
  { lat: -4.31, lng: 15.31 },
  { lat: -4.33, lng: 15.31 },
  { lat: -4.33, lng: 15.29 },
];

test('the zone travels in the URL and comes back the same; anything malformed is no zone', () => {
  const param = zoneToParam(SQUARE);
  assert.equal(param, '-4.31000,15.29000;-4.31000,15.31000;-4.33000,15.31000;-4.33000,15.29000');
  assert.deepEqual(parseZone(param), SQUARE);
  for (const bad of ['', null, undefined, '-4.3,15.2', '-4.3,15.2;-4.4,15.3', 'a,b;c,d;e,f', '-4.3,15.2,9;-4.4,15.3;-4.5,15.4', '-94,15;-4,15;-5,16']) {
    assert.equal(parseZone(bad), null, String(bad));
  }
  const tooMany = Array.from({ length: MAX_ZONE_POINTS + 1 }, (_, i) => `-4.${300 + i},15.3`).join(';');
  assert.equal(parseZone(tooMany), null, 'more corners than a drawing can produce');
  assert.deepEqual(zoneBounds(SQUARE), { south: -4.33, west: 15.29, north: -4.31, east: 15.31 });
});

test('inside means inside the shape, not its box', () => {
  assert.equal(pointInZone(SQUARE, { lat: -4.32, lng: 15.3 }), true);
  assert.equal(pointInZone(SQUARE, { lat: -4.34, lng: 15.3 }), false);
  // An L-shaped zone: its box contains the notch, the zone does not.
  const ell = [
    { lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 1, lng: 2 }, { lat: 1, lng: 1 }, { lat: 2, lng: 1 }, { lat: 2, lng: 0 },
  ];
  assert.equal(pointInZone(ell, { lat: 0.5, lng: 1.5 }), true);
  assert.equal(pointInZone(ell, { lat: 1.5, lng: 1.5 }), false, 'in the box, outside the shape');
  assert.equal(pointInZone(ell, { lat: 1.5, lng: 0.5 }), true);
  assert.equal(pointInZone(SQUARE.slice(0, 2), { lat: -4.31, lng: 15.3 }), false, 'two corners are not a zone');
  assert.equal(pointInZone(SQUARE, { lat: NaN, lng: 15.3 }), false);
});

test('a finger path is thinned to a few corners; a tap or a slip is not a shape', () => {
  // A circle of 200 points, 120px across.
  const circle = Array.from({ length: 200 }, (_, i) => ({ x: 100 + 60 * Math.cos((i / 200) * 2 * Math.PI), y: 100 + 60 * Math.sin((i / 200) * 2 * Math.PI) }));
  const corners = simplifyScreenPath(circle);
  assert.ok(corners.length >= 6 && corners.length <= MAX_ZONE_POINTS, `corners: ${corners.length}`);
  for (const c of corners) assert.ok(Math.abs(Math.hypot(c.x - 100, c.y - 100) - 60) < 1, 'corners are points of the path itself');
  assert.equal(simplifyScreenPath([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 11, y: 13 }]), null, 'a tap');
  assert.equal(simplifyScreenPath([{ x: 0, y: 0 }, { x: 200, y: 4 }, { x: 400, y: 0 }]), null, 'a flat stroke has no inside');
  assert.equal(simplifyScreenPath([]), null);
  assert.equal(simplifyScreenPath(null), null);
});

test('with a zone, the list covers the whole zone and the listings read narrows it to the shape', () => {
  const param = zoneToParam(SQUARE);
  // On a phone the URL's box follows every pan; the zone's own box wins.
  const parsed = parseListingsSearchParams(new URLSearchParams({ zone: param, sw_lat: '-4.9', sw_lng: '15.0', ne_lat: '-4.8', ne_lng: '15.1', transaction_type: 'location' }));
  assert.deepEqual(parsed.zone, SQUARE);
  assert.deepEqual(parsed.bounds, { south: -4.33, west: 15.29, north: -4.31, east: 15.31 });
  assert.equal(parseListingsSearchParams(new URLSearchParams({ zone: 'nonsense' })).zone, null);
  assert.equal(parseListingsSearchParams(new URLSearchParams({ zone: 'nonsense' })).bounds, null, 'a bad zone widens nothing');
  const listings = read('lib/listings.js');
  assert.match(listings, /if \(zone && \(position\.approximate \|\| !pointInZone\(zone, position\)\)\) continue;/, 'a listing placed at its commune centre is not claimed to be inside');
  // The map writes the zone and its box into the URL, and clears both together.
  const map = read('components/ListingsMap.js');
  assert.match(map, /url\.searchParams\.set\(ZONE_PARAM, zoneToParam\(points\)\);/);
  assert.match(map, /<MapZoneDraw map=\{mapReady \? mapInstance : null\} zone=\{urlZone\} onZone=\{setZone\} enabled=\{zoneDraw\} \/>/);
  // The map can be rebuilt after a filter change: the drawing layer gets the current one.
  assert.match(map, /mapRef\.current = map;\s*setMapInstance\(map\);/);
  assert.match(read('components/ListingsSplitView.js'), /zoneDraw=\{appMode\}/, 'the pencil is the app’s');
});

test('the drawing layer takes the touch, never scrolls the page, and the pencil can be made private again', () => {
  const draw = read('components/MapZoneDraw.js');
  assert.match(draw, /touch-none/);
  assert.match(draw, /const corners = simplifyScreenPath\(pathRef\.current\);/);
  assert.match(draw, /if \(!enabled \|\| !allowed \|\| !map\) return null;/);
  assert.match(draw, /window\.localStorage\.getItem\('lp_zone'\) === '1'/);
  assert.equal(ZONE_DRAW_PUBLIC, true, 'checked on the live map 2026-11-13: shown to everyone in the app');
  for (const dict of [fr, en]) {
    for (const key of ['hint', 'cancel', 'clear', 'draw', 'redraw']) assert.ok(dict.listings.zone[key], key);
  }
});

test('map chips and result sheet: one-tap amenities, and a sheet that lists only what the map shows', async () => {
  const { mapFilterHref, toggleAmenityParam } = await import('@/lib/mapQuickFilters');
  assert.equal(toggleAmenityParam('', 'eau'), 'eau');
  assert.equal(toggleAmenityParam('eau', 'parking'), 'eau,parking');
  assert.equal(toggleAmenityParam('eau,parking', 'eau'), 'parking');
  assert.equal(toggleAmenityParam('eau', 'eau'), '', 'the last one off removes the filter');
  assert.equal(mapFilterHref('?view=map&amenities=eau', 'amenities', ''), '/listings?view=map');
  const chips = read('components/MapQuickFilters.js');
  for (const key of ['electricite', 'eau', 'parking']) assert.ok(chips.includes(`key: '${key}'`), key);
  assert.match(chips, /aria-pressed=\{active\}/);
  const sheet = read('components/app/AppMapSheet.js');
  assert.match(sheet, /if \(!open \|\| !key \|\| rows\.key === key\) return undefined;/, 'a closed sheet reads nothing');
  assert.match(sheet, /bottom-7/, 'above the map attribution line');
  const pane = read('components/ResponsiveMapPane.js');
  assert.match(pane, /resultSheet && shouldRender && isPhone && isMapView && !previewOpen \? \(\s*<AppMapSheet ids=\{visibleIds\} zone=\{Boolean\(filterParams\?\.zone\)\} \/>/);
  assert.match(read('components/ListingsSplitView.js'), /isMapView && !previewOpen && !appMode \? <MobileMapBar/, 'the website keeps its pills');
  for (const dict of [fr, en]) {
    assert.match(dict.appShell.map.inZone.other, /\{count\}/);
    assert.match(dict.appShell.map.onMap.other, /\{count\}/);
    assert.ok(dict.listings.map.quick.parking);
  }
});
