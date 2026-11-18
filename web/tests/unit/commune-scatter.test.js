import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scatterCommuneListings, scatterRadiusMeters, SCATTER_MAX_METERS, SCATTER_MIN_METERS } from '@/lib/communeScatter';
import { COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { locationTextChanged } from '@/lib/agentListings';

// 2026-11-14: 307 of 592 public listings had no stored point and were drawn on
// their commune's centre, fanned into a ~1 km ring (89 in Limete); web-created
// listings are now located by the engine like WhatsApp ones. The 2026-11-14
// "89 biens · Limete" bubble was replaced on 2026-11-18 (owner: it "takes
// away from the immersion"): each such listing is scattered over its commune
// with its own price.

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const marker = (id, extra) => ({ id, lat: -4.36, lng: 15.34, price: 500, purpose: 'rent', ...extra });
const METERS_PER_DEG = 111_320;
const metersFrom = (c, p) => Math.hypot((p.lat - c.lat) * METERS_PER_DEG, (p.lng - c.lng) * METERS_PER_DEG * Math.cos((c.lat * Math.PI) / 180));

test('commune-centre listings are scattered over their commune, each its own pin; located ones untouched', () => {
  const markers = [
    marker(1, { approximate: true, commune: 'Limete' }),
    marker(2, { approximate: true, commune: 'Limete', price: 900 }),
    marker(4, { approximate: false, commune: 'Limete' }),
    marker(5, { approximate: true, commune: 'Atlantis' }),
  ];
  const out = scatterCommuneListings(markers);
  assert.equal(out.length, 4, 'no listing is grouped away');
  assert.deepEqual(out.map((m) => m.id), [1, 2, 4, 5]);
  assert.equal(out[2], markers[2], 'a located listing keeps its point');
  assert.equal(out[3], markers[3], 'no centre known: left as it was');
  const centre = COMMUNE_CENTROIDS.Limete;
  for (const m of out.slice(0, 2)) {
    assert.equal(m.scattered, true);
    assert.ok(metersFrom(centre, m) <= scatterRadiusMeters('Limete') + 1);
  }
  assert.notDeepEqual([out[0].lat, out[0].lng], [out[1].lat, out[1].lng]);
});

test('a scattered spot is stable per listing and does not depend on what else is loaded', () => {
  const alone = scatterCommuneListings([marker(42, { approximate: true, commune: 'Gombe' })])[0];
  const crowd = scatterCommuneListings([
    ...Array.from({ length: 50 }, (_, i) => marker(1000 + i, { approximate: true, commune: 'Gombe' })),
    marker(42, { approximate: true, commune: 'Gombe' }),
  ]).at(-1);
  assert.deepEqual([alone.lat, alone.lng], [crowd.lat, crowd.lng]);
});

test('spread over the disc, not a ring: many listings fill the middle too', () => {
  const out = scatterCommuneListings(Array.from({ length: 200 }, (_, i) => marker(i + 1, { approximate: true, commune: 'Limete' })));
  const r = scatterRadiusMeters('Limete');
  const inner = out.filter((m) => metersFrom(COMMUNE_CENTROIDS.Limete, m) < r / 2).length;
  // A uniform disc puts a quarter of its points inside half the radius.
  assert.ok(inner > 30 && inner < 80, `inner half holds ${inner} of 200`);
  for (const c of Object.keys(COMMUNE_CENTROIDS)) {
    const radius = scatterRadiusMeters(c);
    assert.ok(radius >= SCATTER_MIN_METERS && radius <= SCATTER_MAX_METERS, c);
  }
});

test('the map scatters instead of bubbling: no commune pill, no ring on top of the scatter', () => {
  const map = read('components/ListingsMap.js');
  assert.ok(map.includes('groupListingsByBuilding(scatterCommuneListings(markers))'));
  assert.ok(map.includes('exact: group.listings.every((l) => l.exact || l.scattered),'));
  assert.doesNotMatch(map, /isCommune|communeBubble/);
  assert.doesNotMatch(read('components/BuildingUnitsDrawer.js'), /isCommune|emplacement précis non indiqué/);
  assert.doesNotMatch(read('lib/mapPinLayer.js'), /dataset\.commune/);
  assert.doesNotMatch(read('app/globals.css'), /data-commune/);
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

test('phone map: search and chips on a liquid-glass panel the map shows through', () => {
  const split = read('components/ListingsSplitView.js');
  assert.match(split, /<div className="u-liquid-glass pointer-events-auto rounded-\[22px\] px-2\.5 pb-2 pt-2\.5">/);
  assert.ok(split.indexOf('<ResponsiveMapPane') < split.indexOf('<MobileMapChrome'), 'the panel floats over the full-height map');
  const css = read('app/globals.css');
  assert.match(css, /\.u-liquid-glass \{[^}]*backdrop-filter: blur\(18px\) saturate\(180%\);/);
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/, 'opaque fallback');
  assert.match(read('components/MobileMapChrome.js'), /u-liquid-glass-field pointer-events-auto min-w-0 flex-1 rounded-full/);
  assert.match(read('components/MapQuickFilters.js'), /'u-liquid-glass-field text-ink'/);
  assert.match(read('components/ListingsMap.js'), /top-\[8rem\] z-20 flex flex-col items-center gap-2 px-3 lg:top-3/, 'the loading pill clears the panel');
});

test('the glass panel steps aside while the map moves and comes back when it settles', () => {
  const map = read('components/ListingsMap.js');
  assert.match(map, /addListener\('dragstart', \(\) => announceMapMoving\(true\)\)/);
  assert.match(map, /if \(!requestRef\.current\.positioning\) announceMapMoving\(true\);/, 'our own positioning does not hide it');
  assert.match(map, /announceMapMoving\(false\);/, 'idle brings it back');
  assert.doesNotMatch(read('components/ListingsSplitView.js'), /from '\.\/ListingsMap'|from '@\/components\/ListingsMap'/, 'the page does not import the map module');
  const split = read('components/ListingsSplitView.js');
  assert.match(split, /data-away=\{glassAway \? 'true' : 'false'\}/);
  assert.match(split, /document\.activeElement\?\.closest\?\.\('\[data-map-glass\]'\)/, 'stays while typing');
  const css = read('app/globals.css');
  assert.match(css, /\.lkp-glass-wrap\[data-away='true'\] \{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.lkp-glass-wrap,/);
});

test('phone map has one glass header: the logo bar steps aside, ☰ opens the same drawer', () => {
  const css = read('app/globals.css');
  assert.match(css, /@media \(max-width: 1023\.98px\) \{\s*body:has\(\[data-map-glass\]\) \[data-site-header\] \{ display: none; \}/);
  const header = read('components/Header.js');
  assert.match(header, /<header data-site-header className=/);
  assert.match(header, /window\.addEventListener\(OPEN_SITE_MENU_EVENT, open\)/);
  const chrome = read('components/MobileMapChrome.js');
  assert.match(chrome, /onClick=\{\(\) => openSiteMenu\(\)\}/);
  assert.ok(chrome.indexOf('openSiteMenu()') < chrome.indexOf('<LocationAutocomplete'), '☰ first, then the search');
  const split = read('components/ListingsSplitView.js');
  assert.match(split, /\? 'fixed inset-x-0 top-0 bottom-0 z-30 bg-canvas'/, 'the phone map reaches the top of the screen');
  assert.match(split, /pt-\[max\(0\.5rem,env\(safe-area-inset-top\)\)\]/);
});

test('inside the store app the phone map keeps its place under the app bar, without the site ☰', () => {
  const css = read('app/globals.css');
  assert.match(css, /body:has\(\[data-app-top-bar\]\) \[data-map-layer\] \{ top: 4rem; \}/);
  assert.match(css, /body:has\(\[data-app-top-bar\]\) \[data-site-menu-button\] \{ display: none; \}/);
  assert.match(read('components/ListingsSplitView.js'), /data-map-layer\s/);
  assert.match(read('components/MobileMapChrome.js'), /data-site-menu-button\s/);
});
