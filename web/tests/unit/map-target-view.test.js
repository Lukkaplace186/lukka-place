import test from 'node:test';
import assert from 'node:assert/strict';
import {
  targetView,
  distanceKm,
  locationTarget,
  locationGeocodeQueries,
  mapFilterQuery,
  COMMUNE_VIEW_ZOOM,
  QUARTIER_VIEW_ZOOM,
  KINSHASA_DEFAULT_VIEW,
} from '@/lib/mapViewport';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';

/**
 * Where the map opens for a searched place. The bug this pins: a search for
 * Limete toggled to "Carte" kept `commune=Limete` in the URL, but the map fit
 * Google's viewport for the commune — which reaches into the river — and a
 * phone opened zoomed out on Brazzaville, looking exactly like the search had
 * been dropped. The opening view is now a centre at a fixed zoom.
 */

const LIMETE = { lat: -4.3547, lng: 15.3476 };

test('the list → map toggle keeps the place, and the place becomes the map target', () => {
  // What FloatingControlBar / FilterBar produce: the same query plus view=map.
  const toggled = new URLSearchParams('commune=Limete&quartier=Industriel&beds_min=2&price_max=1500&view=map');
  assert.deepEqual(locationTarget(toggled), { commune: 'Limete', quartier: 'Industriel', near: null });
  assert.equal(mapFilterQuery(toggled), 'beds_min=2&commune=Limete&price_max=1500&quartier=Industriel');
});

test('a commune opens on its geocoded point at commune zoom, never on a viewport fit', () => {
  const view = targetView({ commune: 'Limete', quartier: null }, { commune: LIMETE });
  assert.deepEqual(view, { center: LIMETE, zoom: COMMUNE_VIEW_ZOOM });
  assert.ok(view.zoom > KINSHASA_DEFAULT_VIEW.zoom, 'a searched commune must open closer than the whole city');
});

test('a quartier opens a step closer, but only when it really lies in its commune', () => {
  const industriel = { lat: -4.3489, lng: 15.3318 }; // ~1.8 km from Limete's point
  assert.deepEqual(
    targetView({ commune: 'Limete', quartier: 'Industriel' }, { commune: LIMETE, quartier: industriel }),
    { center: industriel, zoom: QUARTIER_VIEW_ZOOM },
  );

  // A same-named place across the city is not this quartier.
  const elsewhere = { lat: -4.44, lng: 15.25 };
  assert.ok(distanceKm(elsewhere, LIMETE) > 5);
  assert.deepEqual(
    targetView({ commune: 'Limete', quartier: 'Industriel' }, { commune: LIMETE, quartier: elsewhere }),
    { center: LIMETE, zoom: COMMUNE_VIEW_ZOOM },
  );
});

test('a picked landmark opens on the landmark, and is a place — never a text filter', () => {
  // "St Luc" (Ngaliema): once `q`, which hid every pin because no listing's
  // text says "St Luc". As `near` it moves the map and filters nothing.
  const params = new URLSearchParams('commune=Ngaliema&near=St%20Luc&view=map');
  assert.deepEqual(locationTarget(params), { commune: 'Ngaliema', quartier: null, near: 'St Luc' });
  assert.equal(locationGeocodeQueries(locationTarget(params)).near, 'St Luc, Ngaliema, Kinshasa, RD Congo');

  const ngaliema = { lat: -4.37, lng: 15.25 };
  const stLuc = { lat: -4.345, lng: 15.26 };
  assert.deepEqual(targetView(locationTarget(params), { commune: ngaliema, near: stLuc }), { center: stLuc, zoom: QUARTIER_VIEW_ZOOM });
  // A geocode that lands across the city is not trusted: the commune instead.
  const far = { lat: -4.45, lng: 15.4 };
  assert.deepEqual(targetView(locationTarget(params), { commune: ngaliema, near: far }), { center: ngaliema, zoom: COMMUNE_VIEW_ZOOM });
});

test('no usable geocode: the verified commune centroid; nothing at all: null (extent fallback)', () => {
  assert.deepEqual(
    targetView({ commune: 'Gombe', quartier: null }, { commune: null }),
    { center: KINSHASA_COMMUNE_CENTROIDS.Gombe, zoom: COMMUNE_VIEW_ZOOM },
  );
  // A point outside Kinshasa province is not the Kinshasa commune searched.
  assert.deepEqual(
    targetView({ commune: 'Gombe', quartier: null }, { commune: { lat: 0.5, lng: 25.2 } }),
    { center: KINSHASA_COMMUNE_CENTROIDS.Gombe, zoom: COMMUNE_VIEW_ZOOM },
  );
  assert.equal(targetView({ commune: 'Nowhere', quartier: null }, {}), null);
  assert.equal(targetView(null, { commune: LIMETE }), null);
});

test('the default view is the Kinshasa core at 13', () => {
  assert.deepEqual(KINSHASA_DEFAULT_VIEW, { center: { lat: -4.325, lng: 15.312 }, zoom: 13 });
});
