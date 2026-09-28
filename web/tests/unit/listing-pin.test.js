import test from 'node:test';
import assert from 'node:assert/strict';
import { storedPosition, pinKind, PIN_ICONS, pointLabel, PRIVACY_RADIUS_M } from '@/lib/listingPin';
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

test('pointLabel: commune, else quartier, else nothing', () => {
  assert.equal(pointLabel({ commune: 'Kintambo', quartier: 'Jamaïque' }), 'Kintambo');
  assert.equal(pointLabel({ commune: null, quartier: 'Jamaïque' }), 'Jamaïque');
  assert.equal(pointLabel({ commune: ' ', quartier: '' }), null);
});

test('the approximate-zone disc always contains the real spot', () => {
  const real = { lat: -4.33, lng: 15.28 };
  for (let id = 1; id <= 400; id += 1) {
    const placed = placeResolvedListings([{ id, base: { ...real, source: 'existing', precise: true } }]).get(id);
    const metres = kmBetween(real, placed) * 1000;
    assert.ok(metres > 0 && metres < PRIVACY_RADIUS_M, `listing ${id}: ${metres.toFixed(0)} m`);
  }
});
