import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { quartierKey, quartierPoint, resolveListingBase } from '@/lib/geocoding';

// #387 (2026-10-24): "GB / Hôtel Diplomate", Ngaliema was placed by Joli Parc
// because the Geocoding API answered with a hotel NAMED "GB". The engine now
// checks names (services/geocoding.js) and builds kinshasa_quartier_points.json;
// lib/data/quartier-points.json is its non-null half, used here when a listing
// has no stored coordinates. Reads engine-repo files, so it cannot run on the
// VPS web dir — same by-construction category as places-sync.test.js.

const engineFile = JSON.parse(readFileSync(new URL('../../../kinshasa_quartier_points.json', import.meta.url), 'utf8'));
const webFile = JSON.parse(readFileSync(new URL('../../lib/data/quartier-points.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

test('the web copy holds exactly the engine table\'s non-null points', () => {
  const expected = {};
  for (const [key, point] of Object.entries(engineFile.points)) {
    if (point) expected[key] = { lat: point.lat, lng: point.lng };
  }
  assert.deepEqual(webFile.points, expected);
});

test('quartierKey is the engine\'s placeKey, so the table is read with the key it was written with', () => {
  const { placeKey } = require('../../../services/locations.js');
  for (const name of ['GB', 'Ma Campagne', 'Cité-Verte', 'Yolo Sud 2', "Kingabwa / Pakadjuma", 'Saïo-UPAC', 'Binza Météo']) {
    assert.equal(quartierKey(name), placeKey(name), name);
  }
});

test('a quartier term inside "quartier / landmark" text finds its point', () => {
  const point = quartierPoint({ quartier: 'GB / Hôtel Diplomate', commune: 'Ngaliema' });
  assert.ok(point, 'GB has a checked point');
  assert.deepEqual(point, webFile.points['Ngaliema|gb']);
  assert.equal(quartierPoint({ quartier: 'GB', commune: 'Lemba' }), null);
});

test('a business answer from the browser Geocoder is refused; the quartier point is used before the commune centre', async () => {
  const geocoder = {
    geocode(request, callback) {
      callback([{
        geometry: { location: { lat: () => -4.34885, lng: () => 15.25276 }, location_type: 'ROOFTOP' },
        types: ['establishment', 'lodging', 'point_of_interest'],
      }], 'OK');
    },
  };
  const base = await resolveListingBase({ listing: { id: 387, quartier: 'GB / Hôtel Diplomate', commune: 'Ngaliema' }, geocoder });
  assert.equal(base.source, 'quartier');
  assert.deepEqual({ lat: base.lat, lng: base.lng }, webFile.points['Ngaliema|gb']);
});
