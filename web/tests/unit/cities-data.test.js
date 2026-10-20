import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as listings from '@/lib/listings';
import { calls, reset } from '../support/fakePool.js';
import {
  CITIES, DEFAULT_CITY, cityOfCommune, communeLabel, communeOptionText, groupCommunesByCity, searchCityOf, findCity,
} from '@/lib/cities';
import { COMMUNE_CENTROIDS, KINSHASA_COMMUNE_CENTROIDS, buildGeocodeQueries } from '@/lib/geocoding';
import {
  KINSHASA_DEFAULT_VIEW, defaultViewForCity, inCoveredArea, locationGeocodeQueries, resolveMarkerPosition, targetView,
} from '@/lib/mapViewport';
import { placeLabel } from '@/lib/placeLabel';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../..');
const read = (rel) => readFileSync(path.join(webRoot, rel), 'utf8');

test.beforeEach(() => reset());

test('lib/data/cities.json lists exactly the engine\'s cities and commune keys', () => {
  const drc = JSON.parse(read('../drc_locations.json'));
  const kinshasa = JSON.parse(read('../kinshasa_locations.json'));
  const aliases = { "N'Djili": 'Ndjili', "N'Sele": 'Nsele' };
  assert.deepEqual(CITIES.map((c) => c.name), ['Kinshasa', ...Object.keys(drc.cities)]);
  assert.deepEqual(CITIES[0].communes.map((c) => c.key), Object.keys(kinshasa).map((k) => aliases[k] || k));
  for (const [name, city] of Object.entries(drc.cities)) {
    const mine = findCity(name);
    assert.deepEqual(mine.communes.map((c) => c.key), Object.keys(city.communes), name);
    assert.equal(mine.utcOffset, city.utc_offset, name);
  }
});

test('commune keys are unique; a shared name carries its city and shows as its plain name', () => {
  const keys = CITIES.flatMap((c) => c.communes.map((x) => x.key));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(cityOfCommune('Kalamu'), 'Kinshasa');
  assert.equal(cityOfCommune('Kalamu (Boma)'), 'Boma');
  assert.equal(communeLabel('Kabondo (Kisangani)'), 'Kabondo');
  assert.equal(communeOptionText('Gombe'), 'Gombe');
  assert.equal(communeOptionText('Kampemba'), 'Kampemba · Lubumbashi');
  assert.equal(communeOptionText('Lubumbashi'), 'Lubumbashi');
});

test('a commune list groups by city only when it spans more than one', () => {
  assert.equal(groupCommunesByCity(['Gombe', 'Limete']).length, 1);
  const groups = groupCommunesByCity(['Kampemba', 'Gombe', 'Kalamu (Boma)']);
  assert.deepEqual(groups.map((g) => g.city), ['Kinshasa', 'Lubumbashi', 'Boma']);
  assert.deepEqual(groups[2].options, [{ value: 'Kalamu (Boma)', label: 'Kalamu' }]);
});

test('every commune has a point: its own geocoded one, or its city\'s centre — never invented', () => {
  for (const [key, point] of Object.entries(KINSHASA_COMMUNE_CENTROIDS)) assert.deepEqual(COMMUNE_CENTROIDS[key], point);
  for (const city of CITIES.filter((c) => c.name !== DEFAULT_CITY)) {
    for (const commune of city.communes) {
      const expected = commune.point || city.center;
      assert.deepEqual(COMMUNE_CENTROIDS[commune.key], expected, commune.key);
    }
  }
  const pos = resolveMarkerPosition({ lat: null, lng: null, commune: 'Kalamu (Boma)' });
  assert.equal(pos.approximate, true);
});

test('the place label closes with the city outside Kinshasa, and only there', () => {
  assert.equal(placeLabel({ quartier: 'Industriel', commune: 'Limete' }), 'Industriel, Limete');
  assert.equal(placeLabel({ quartier: 'Mense', commune: 'Kalamu (Boma)' }), 'Mense, Kalamu, Boma');
  assert.equal(placeLabel({ quartier: 'Gambela', commune: 'Lubumbashi' }), 'Gambela, Lubumbashi');
});

test('the search city: ville, else the commune\'s, else Kinshasa', () => {
  assert.equal(searchCityOf({}), 'Kinshasa');
  assert.equal(searchCityOf({ ville: 'lubumbashi' }), 'Lubumbashi');
  assert.equal(searchCityOf({ commune: 'Kampemba' }), 'Lubumbashi');
  assert.equal(searchCityOf({ ville: 'Atlantis', commune: 'Gombe' }), 'Kinshasa');
});

test('a feed is narrowed to its city in SQL; an id list or a portfolio is not', async () => {
  await listings.getListings({});
  const feed = calls.map((c) => c.sql).join('\n');
  assert.match(feed, /p\.city_id IN \(SELECT city_id FROM property_city_contents WHERE LOWER\(name\) = LOWER\(\$\d+\)\) OR p\.city_id IS NULL/);
  assert.ok(calls.some((c) => (c.values || []).includes('Kinshasa')));
  reset();
  await listings.getListings({ ville: 'Goma' });
  assert.ok(calls.some((c) => (c.values || []).includes('Goma')));
  assert.doesNotMatch(calls.map((c) => c.sql).join('\n'), /OR p\.city_id IS NULL/);
  reset();
  await listings.getListings({ ids: [1, 2] });
  assert.doesNotMatch(calls.map((c) => c.sql).join('\n'), /p\.city_id IN \(SELECT city_id/);
});

test('the map opens on the city, geocodes inside it, and refuses a point from elsewhere', () => {
  assert.deepEqual(defaultViewForCity(null), KINSHASA_DEFAULT_VIEW);
  assert.deepEqual(defaultViewForCity({ ville: 'Goma' }).center, findCity('Goma').center);
  assert.equal(locationGeocodeQueries({ commune: 'Kalamu (Boma)' }).commune, 'Commune de Kalamu, Boma, RD Congo');
  assert.equal(locationGeocodeQueries({ commune: 'Gombe' }).commune, 'Commune de Gombe, Kinshasa, RD Congo');
  // A "Kalamu" geocoded in Kinshasa is not Boma's Kalamu.
  const view = targetView({ commune: 'Kalamu (Boma)' }, { commune: KINSHASA_COMMUNE_CENTROIDS.Kalamu });
  assert.deepEqual(view.center, COMMUNE_CENTROIDS['Kalamu (Boma)']);
  assert.ok(inCoveredArea(findCity('Bukavu').center));
  assert.ok(!inCoveredArea({ lat: 48.85, lng: 2.35 }));
  assert.deepEqual(buildGeocodeQueries({ quartier: 'Himbi', commune: 'Goma' }).at(-1), 'Himbi, Goma, RD Congo');
});

test('nothing in the web app identifies a commune by the old amenity id range', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name) && /BETWEEN 21 AND 44/.test(readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  for (const dir of ['lib', 'app', 'components']) walk(path.join(webRoot, dir));
  assert.deepEqual(offenders, []);
});

test('a visit slot is built and checked on the listing\'s own clock', async () => {
  const { slotIso, validatePickedSlot, slotsForDay } = await import('@/lib/visitSlots');
  const { utcOffsetForListing } = await import('@/lib/cities');
  assert.equal(utcOffsetForListing({ commune: 'Gombe' }), 1);
  assert.equal(utcOffsetForListing({ commune: 'Kampemba' }), 2);
  assert.equal(utcOffsetForListing({ commune: null, city_name: 'Goma' }), 2);
  assert.equal(utcOffsetForListing({ commune: null, city_name: 'Muanda' }), 1);
  assert.equal(slotIso('2026-10-22', '14:00'), '2026-10-22T14:00:00+01:00');
  assert.equal(slotIso('2026-10-22', '14:00', 2), '2026-10-22T14:00:00+02:00');
  const now = new Date('2026-10-20T08:00:00Z');
  const ok = validatePickedSlot('2026-10-22T14:00:00+02:00', now, { utcOffset: 2 });
  assert.equal(ok.iso, '2026-10-22T14:00:00+02:00');
  assert.match(ok.phrase, /à 14h00$/);
  assert.equal(validatePickedSlot('2026-10-22T14:00:00+01:00', now, { utcOffset: 2 }).error, 'invalid');
  assert.equal(validatePickedSlot('2026-10-22T14:00:00+02:00', now).error, 'invalid');
  assert.ok(slotsForDay('2026-10-22', { now, utcOffset: 2 }).every((s) => s.iso.endsWith('+02:00')));
});

test('every city is offered by the picker, empty ones included (MIN_PUBLIC_CITY_LISTINGS = 0)', async () => {
  const { getPublicCities, publicVille } = await import('@/lib/publicCities');
  const { MIN_PUBLIC_CITY_LISTINGS } = await import('@/lib/cities');
  assert.equal(MIN_PUBLIC_CITY_LISTINGS, 0);
  const cities = await getPublicCities();
  assert.deepEqual(cities.map((c) => c.name), CITIES.map((c) => c.name));
  assert.equal(await publicVille('goma'), 'Goma');
  assert.equal(await publicVille('Kinshasa'), null, 'Kinshasa is the default, carried by no param');
  assert.equal(await publicVille('Atlantis'), null);
});

test('the picker\'s label is in both dictionaries', async () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  assert.equal(fr.listings.city.label, 'Ville');
  assert.equal(en.listings.city.label, 'City');
});

test('the site speaks for the whole DRC, and a city search is titled for its city', () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  for (const dict of [fr, en]) {
    for (const key of ['metaTitle', 'metaDescription']) assert.match(dict.site[key], /RDC|DRC/, key);
    assert.doesNotMatch(dict.site.metaTitle, /Kinshasa/);
    assert.doesNotMatch(dict.home.hero.subtitle, /d'abord|first/i);
    assert.match(dict.site.cityMetaTitle, /\{city\}/);
  }
  assert.match(read('app/manifest.js'), /partout en RDC/);
  const page = read('app/(site)/listings/page.js');
  assert.match(page, /t\('site\.cityMetaTitle', \{ city \}\)/);
});
