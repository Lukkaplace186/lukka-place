import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBounds,
  padBounds,
  boundsWithin,
  boundsContain,
  mapFilterQuery,
  locationTarget,
  locationGeocodeQueries,
  resolveMarkerPosition,
} from '@/lib/mapViewport';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { clusterBubbleGeometry } from '@/lib/mapIcons';
import { LAT_EXPR, LNG_EXPR } from '@/lib/listings';

/**
 * The viewport map decides three things before Google is ever involved: what
 * area to ask for, which filters go with it, and where each returned listing
 * sits. None of it is exercisable in a local browser (the Maps key is
 * referrer-restricted), so it is all pure and pinned here.
 */

test('parseBounds: absent, complete, partial and inverted boxes', () => {
  assert.deepEqual(parseBounds(new URLSearchParams('')), { bounds: null });
  assert.deepEqual(parseBounds(new URLSearchParams('sw_lat=-4.4&sw_lng=15.2&ne_lat=-4.3&ne_lng=15.4')), {
    bounds: { south: -4.4, west: 15.2, north: -4.3, east: 15.4 },
  });
  // Half a box is a client bug; widening it to the whole city would hide that.
  assert.ok(parseBounds(new URLSearchParams('sw_lat=-4.4&sw_lng=15.2')).error);
  assert.ok(parseBounds(new URLSearchParams('sw_lat=abc&sw_lng=15.2&ne_lat=-4.3&ne_lng=15.4')).error);
  assert.ok(parseBounds(new URLSearchParams('sw_lat=-4.3&sw_lng=15.2&ne_lat=-4.4&ne_lng=15.4')).error);
  assert.ok(parseBounds({ sw_lat: '-95', sw_lng: '15', ne_lat: '-4', ne_lng: '16' }).error);
});

test('padBounds grows every side; a pan inside the padded box needs no request', () => {
  const viewport = { south: -4.4, west: 15.2, north: -4.3, east: 15.4 };
  const padded = padBounds(viewport, 0.25);
  assert.ok(Math.abs(padded.south - -4.425) < 1e-9);
  assert.ok(Math.abs(padded.east - 15.45) < 1e-9);
  assert.equal(boundsWithin({ south: -4.41, west: 15.21, north: -4.31, east: 15.41 }, padded), true);
  assert.equal(boundsWithin({ south: -4.5, west: 15.2, north: -4.3, east: 15.4 }, padded), false);
  assert.equal(boundsContain(viewport, { lat: -4.35, lng: 15.3 }), true);
  assert.equal(boundsContain(viewport, { lat: -4.35, lng: 15.5 }), false);
});

test('mapFilterQuery keeps filters, drops paging/sort/view/bounds, and is order-independent', () => {
  const a = mapFilterQuery({ page: '3', sort: 'price_asc', view: 'map', beds_min: '2', commune: 'Bandalungwa', q: '' });
  const b = mapFilterQuery(new URLSearchParams('commune=Bandalungwa&beds_min=2&sw_lat=-4.4&view=map'));
  assert.equal(a, 'beds_min=2&commune=Bandalungwa');
  assert.equal(a, b, 'the same filters must produce the same key, or the map refetches for nothing');
});

test('locationTarget: a commune opens the map there; citywide or no commune names no place', () => {
  assert.deepEqual(locationTarget({ commune: 'Bandalungwa', quartier: 'Lingwala' }), { commune: 'Bandalungwa', quartier: 'Lingwala' });
  assert.equal(locationTarget({ commune: 'Bandalungwa', radius: 'citywide' }), null);
  assert.equal(locationTarget({ beds_min: '2' }), null);
  assert.deepEqual(locationGeocodeQueries({ commune: 'Gombe', quartier: 'Golf' }), [
    'Golf, Gombe, Kinshasa, RD Congo',
    'Commune de Gombe, Kinshasa, RD Congo',
  ]);
});

test('resolveMarkerPosition: stored point, commune centroid, address-text commune, or nothing', () => {
  assert.deepEqual(resolveMarkerPosition({ lat: -4.33, lng: 15.31, commune: 'Gombe' }), { lat: -4.33, lng: 15.31, approximate: false });

  const gombe = KINSHASA_COMMUNE_CENTROIDS.Gombe;
  assert.deepEqual(resolveMarkerPosition({ lat: null, lng: null, commune: 'Gombe' }), { ...gombe, approximate: true });

  // Listing #226's real shape: no commune tag, the commune named in its address.
  const ngiri = KINSHASA_COMMUNE_CENTROIDS['Ngiri-Ngiri'];
  assert.deepEqual(resolveMarkerPosition({ lat: null, lng: null, commune: null, address: 'Ngiri-Ngiri, Kinshasa' }), { ...ngiri, approximate: true });

  // A garbage stored value is not a position.
  assert.deepEqual(resolveMarkerPosition({ lat: 123, lng: 15.3, commune: 'Gombe' }), { ...gombe, approximate: true });

  assert.equal(resolveMarkerPosition({ lat: null, lng: null, commune: null, address: 'Kin' }), null);
});

test('cluster bubbles grow logarithmically and always fit their label', () => {
  const small = clusterBubbleGeometry(2);
  const medium = clusterBubbleGeometry(40);
  const huge = clusterBubbleGeometry(30000);
  assert.ok(small.diameter < medium.diameter && medium.diameter <= huge.diameter);
  assert.ok(huge.diameter <= 56);
  assert.equal(huge.label, '30k+');
  assert.equal(clusterBubbleGeometry(999).label, '999');
  for (const g of [small, medium, huge]) assert.equal(g.size, g.diameter + g.pad * 2);
});

test('the coordinate expressions are exactly the ones the geo index is built on', () => {
  // The planner only uses an expression index for an IDENTICAL expression.
  // If these drift, bounding-box reads silently fall back to a full scan.
  const migration = readFileSync(
    new URL('../../../migrations/20260916_properties_geo_index.sql', import.meta.url),
    'utf8',
  );
  assert.ok(migration.includes(LAT_EXPR.replaceAll('p.latitude', 'latitude')), 'latitude expression drifted from the index');
  assert.ok(migration.includes(LNG_EXPR.replaceAll('p.longitude', 'longitude')), 'longitude expression drifted from the index');
  assert.match(migration, /WHERE status = 1 AND approve_status = 1;/);
});
