import test from 'node:test';
import assert from 'node:assert/strict';
import { storedPosition, pinKind, PIN_ICONS, zoneOutline, ZONE_MIN_FACTOR, PRIVACY_RADIUS_M } from '@/lib/listingPin';
import { placeResolvedListings } from '@/lib/geocoding';
import { kmBetween } from '@/lib/landmarks';

/** The detail page's single listing pin (lib/listingPin.js). */

test('storedPosition uses stored coordinates only', () => {
  assert.deepEqual(storedPosition({ latitude: '-4.33', longitude: '15.28' }), { lat: -4.33, lng: 15.28, approximate: false });
  assert.equal(storedPosition({ latitude: '', longitude: '' }), null);
  assert.equal(storedPosition({ latitude: null, longitude: '15.28' }), null);
  assert.equal(storedPosition({ latitude: '0', longitude: '0' }), null);
  assert.equal(storedPosition({ latitude: 'abc', longitude: '15.28' }), null);
});

test('pinKind: sub-type first, then the category name', () => {
  assert.equal(pinKind({ category_name: 'Appartement' }), 'apartment');
  assert.equal(pinKind({ category_name: 'Maison' }), 'house');
  assert.equal(pinKind({ parcelle_subtype: 'villa', category_name: 'Appartement' }), 'house');
  assert.equal(pinKind({ parcelle_subtype: 'maison_type_locataire' }), 'house');
  assert.equal(pinKind({ parcelle_subtype: 'terrain_nu' }), 'land');
  assert.equal(pinKind({ category_name: 'Terrain' }), 'land');
  assert.equal(pinKind({}), 'house');
});

test('every kind has static SVG markup', () => {
  for (const kind of ['apartment', 'house', 'land']) {
    assert.match(PIN_ICONS[kind], /^<svg [^>]*aria-hidden="true">[\s\S]*<\/svg>$/);
  }
});

test('the zone outline never comes closer than the jitter can reach', () => {
  const real = { lat: -4.33, lng: 15.28 };
  let maxJitter = 0;
  for (let id = 1; id <= 400; id += 1) {
    const placed = placeResolvedListings([{ id, base: { ...real, source: 'existing', precise: true } }]).get(id);
    const jitter = kmBetween(real, placed) * 1000;
    maxJitter = Math.max(maxJitter, jitter);
    const ring = zoneOutline(placed, id);
    const nearest = Math.min(...ring.map((p) => kmBetween(placed, p) * 1000));
    assert.ok(nearest > jitter + 10, `listing ${id}: outline ${nearest.toFixed(0)} m, jitter ${jitter.toFixed(0)} m`);
  }
  assert.ok(ZONE_MIN_FACTOR * PRIVACY_RADIUS_M > maxJitter);
});

test('the zone is irregular, stable per listing, and differs between listings', () => {
  const center = { lat: -4.33, lng: 15.28 };
  const radii = (id) => zoneOutline(center, id).map((p) => Math.round(kmBetween(center, p) * 1000));
  assert.deepEqual(radii(42), radii(42));
  assert.notDeepEqual(radii(42), radii(43));
  const r = radii(42);
  assert.ok(Math.max(...r) - Math.min(...r) > 30, 'not a plain circle');
  assert.ok(Math.max(...r) <= PRIVACY_RADIUS_M * 1.03);
});
