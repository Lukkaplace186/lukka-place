import test from 'node:test';
import assert from 'node:assert/strict';
import { storedPosition, PRIVACY_RADIUS_M } from '@/lib/listingPin';
import { placeResolvedListings } from '@/lib/geocoding';
import { kmBetween } from '@/lib/landmarks';

/** The detail page's approximate-zone map (lib/listingPin.js). */

test('storedPosition uses stored coordinates only', () => {
  assert.deepEqual(storedPosition({ latitude: '-4.33', longitude: '15.28' }), { lat: -4.33, lng: 15.28, approximate: false });
  assert.equal(storedPosition({ latitude: '', longitude: '' }), null);
  assert.equal(storedPosition({ latitude: null, longitude: '15.28' }), null);
  assert.equal(storedPosition({ latitude: '0', longitude: '0' }), null);
  assert.equal(storedPosition({ latitude: 'abc', longitude: '15.28' }), null);
});

test('the approximate-zone circle always contains the real spot', () => {
  const real = { lat: -4.33, lng: 15.28 };
  for (let id = 1; id <= 400; id += 1) {
    const placed = placeResolvedListings([{ id, base: { ...real, source: 'existing', precise: true } }]).get(id);
    const metres = kmBetween(real, placed) * 1000;
    assert.ok(metres > 0 && metres < PRIVACY_RADIUS_M, `listing ${id}: ${metres.toFixed(0)} m`);
  }
});
