import test from 'node:test';
import assert from 'node:assert/strict';
import { cruiseZoom, pixelDistance, FLY_MIN_ZOOM } from '@/lib/mapFly';
import { landmarkPoint, listingDistanceKm, formatDistance, NEAR_DEFAULT_RADIUS } from '@/lib/landmarks';
import * as listings from '@/lib/listings';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * The camera flight between two searched places (lib/mapFly.js), and search
 * "près de <landmark>" with a distance on each card (lib/landmarks.js).
 */

const ST_LUC = { lat: -4.348954, lng: 15.251069 };
const BANDAL = { lat: -4.341671, lng: 15.28124 };
const LIMETE = { lat: -4.3547, lng: 15.3476 };

test('a flight pulls back just far enough for both places to fit, never past the city', () => {
  // St Luc → Bandal (~3 km): one short step back, not a trip to orbit.
  const short = cruiseZoom(ST_LUC, BANDAL, { fromZoom: 15, toZoom: 14, viewportPx: 375 });
  assert.ok(short >= 13 && short <= 14, `short hop cruised at ${short}`);
  assert.ok(pixelDistance(ST_LUC, BANDAL, short) <= 375 * 0.7);

  // Across the city: further back, but never below the whole-city floor.
  const long = cruiseZoom(ST_LUC, LIMETE, { fromZoom: 15, toZoom: 14, viewportPx: 375 });
  assert.ok(long < short);
  assert.ok(long >= FLY_MIN_ZOOM);
});

test('landmark points are real, stored data — and absent ones stay absent', () => {
  assert.ok(landmarkPoint('Ngaliema', 'St Luc'));
  assert.ok(landmarkPoint('Ngaliema', 'UPN'));
  // Refused at build time (geocoded 12 km from its commune): no point, no distance.
  assert.equal(landmarkPoint('Lingwala', 'Hôpital Chinois'), null);
  assert.equal(landmarkPoint(null, 'UPN'), null);
});

test('a distance is only ever measured from the listing’s own stored point', () => {
  const upn = landmarkPoint('Ngaliema', 'UPN');
  const km = listingDistanceKm({ latitude: '-4.3934', longitude: '15.2601' }, upn);
  assert.ok(km > 1 && km < 2, `got ${km}`);
  // Placed on a commune centroid, or no coordinates at all: no distance claim.
  assert.equal(listingDistanceKm({ lat: -4.39, lng: 15.26, approximate: true }, upn), null);
  assert.equal(listingDistanceKm({ latitude: '', longitude: '' }, upn), null);
  assert.equal(listingDistanceKm({ latitude: '0', longitude: '0' }, upn), null);
});

test('distances read the French way', () => {
  assert.equal(formatDistance(0.34), '350 m');
  assert.equal(formatDistance(0.01), '50 m');
  assert.equal(formatDistance(1.24), '1,2 km');
  assert.equal(formatDistance(14.6), '15 km');
});

test('"près de UPN" is a km radius around UPN, still behind the approved filter', async () => {
  reset();
  // One match, so the radius ladder (which widens an empty search) stays put.
  enqueue([{ total: '1' }]);
  enqueue([]);
  await listings.getListings({ commune: 'Ngaliema', near: 'UPN' });
  const count = calls[0];
  assert.match(count.sql, /p\.status = 1 AND p\.approve_status = 1/);
  const upn = landmarkPoint('Ngaliema', 'UPN');
  // Centred on the landmark, not on the commune, at the default radius.
  assert.ok(count.values.includes(upn.lat) && count.values.includes(upn.lng), 'radius not centred on UPN');
  assert.ok(count.values.includes(Number(NEAR_DEFAULT_RADIUS)), 'default radius missing');
});
