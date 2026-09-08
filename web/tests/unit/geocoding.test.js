import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLandmarkReference,
  buildGeocodeQueries,
  buildGeocodeQuery,
  resolveListingBase,
  placeResolvedListings,
  KINSHASA_COMMUNE_CENTROIDS,
} from '@/lib/geocoding';

/**
 * Where a pin lands is the whole content of this map — a listing plotted on
 * the wrong street, or plotted invisibly underneath another listing, is
 * indistinguishable from a listing that was never published.
 *
 * None of this can be exercised in a browser here: the Maps browser key is
 * HTTP-referrer-restricted and `localhost` is not on its allow-list (see
 * web/CLAUDE.md), so the real Geocoder cannot be called from local dev at
 * all. Every decision that matters is therefore a pure function taking a
 * geocoder rather than constructing one, and this file drives it with a fake
 * that answers exactly the queries a real one would.
 */

const EARTH_METERS_PER_DEGREE_LAT = 111320;

/** Metres between two nearby points — flat-earth is fine at these distances. */
function metresBetween(a, b) {
  const dLat = (a.lat - b.lat) * EARTH_METERS_PER_DEGREE_LAT;
  const dLng = (a.lng - b.lng) * EARTH_METERS_PER_DEGREE_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Stands in for `google.maps.Geocoder`. `answers` maps a query string to the
 * point it resolves to; anything absent comes back ZERO_RESULTS, and a point
 * carrying `vague: true` comes back as the bare locality outline Google
 * returns when it recognised the commune but not the address.
 */
function fakeGeocoder(answers) {
  const asked = [];
  return {
    asked,
    geocode(request, callback) {
      asked.push(request.address);
      const hit = answers[request.address];
      if (!hit) {
        callback([], 'ZERO_RESULTS');
        return;
      }
      callback(
        [
          {
            geometry: {
              location: { lat: () => hit.lat, lng: () => hit.lng },
              location_type: hit.vague ? 'APPROXIMATE' : 'ROOFTOP',
            },
            types: hit.vague ? ['locality', 'political'] : ['street_address'],
          },
        ],
        'OK',
      );
    },
  };
}

test('a landmark reference is usable as location text; a listing code never is', () => {
  // Every one of these is a real reference on the live site today — agents
  // fill that field with a repère, which is the most useful token a geocoder
  // can get in a city where most streets are unnamed.
  for (const landmark of [
    'Demiap',
    'Mimosas, Camp Docteur',
    'Birmanie Sur Macadam',
    'école mont des oliviers',
    // Carries a digit and must still qualify: it is a street, not a code.
    'Petit Boulevard, 2ᵉ Rue Industrielle',
    'Sainte-Thérèse',
  ]) {
    assert.equal(isLandmarkReference(landmark), true, `${landmark} should count as a landmark`);
  }

  // And the thing CLAUDE.md is explicit about: `reference` is the listing's
  // OWN identifier. A code must never be handed to a geocoder as a place.
  for (const code of ['LKP-2026-0091', '91', 'A1', 'REF2026', '2026-0091', '', null, undefined, '  ', 'ab']) {
    assert.equal(isLandmarkReference(code), false, `${code} should not count as a landmark`);
  }
});

test('the query cascade runs most specific first and collapses duplicates', () => {
  const queries = buildGeocodeQueries({
    address: '12 Avenue Kasa-Vubu',
    quartier: 'Kintambo Magasin',
    commune: 'Kintambo',
    reference: 'Demiap',
  });

  assert.deepEqual(queries, [
    '12 Avenue Kasa-Vubu, Demiap, Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
    '12 Avenue Kasa-Vubu, Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
    'Demiap, Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
    'Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
  ]);
  assert.equal(buildGeocodeQuery({ address: '12 Avenue Kasa-Vubu', quartier: 'Kintambo Magasin', commune: 'Kintambo', reference: 'Demiap' }), queries[0]);

  // A listing code is not location text, so it changes nothing about the
  // queries — the cascade is the plain address one it always was.
  assert.deepEqual(
    buildGeocodeQueries({ address: '12 Avenue Kasa-Vubu', quartier: 'Kintambo Magasin', commune: 'Kintambo', reference: 'LKP-2026-0091' }),
    [
      '12 Avenue Kasa-Vubu, Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
      'Kintambo Magasin, Kintambo, Kinshasa, RD Congo',
    ],
  );

  // Nothing but a commune: one query, not four identical ones.
  assert.deepEqual(buildGeocodeQueries({ commune: 'Gombe' }), ['Gombe, Kinshasa, RD Congo']);

  // The commune is read out of free-text address when the row carries no
  // structured tag — listing #226 in production has exactly this shape.
  assert.ok(
    buildGeocodeQueries({ address: 'Avenue Kasai, Ngiri-Ngiri', commune: null })[0].endsWith(
      'Ngiri-Ngiri, Kinshasa, RD Congo',
    ),
  );
});

test('resolution stops at the first query that finds a real place', async () => {
  const geocoder = fakeGeocoder({
    'Rue Bongolo, Socimat, Joli Parc, Ngaliema, Kinshasa, RD Congo': { lat: -4.3701, lng: 15.2501 },
  });

  const base = await resolveListingBase({
    listing: { id: 'a1', address: 'Rue Bongolo', quartier: 'Joli Parc', commune: 'Ngaliema', reference: 'Socimat' },
    geocoder,
  });

  assert.equal(base.source, 'geocoded');
  assert.equal(base.precise, true);
  assert.deepEqual({ lat: base.lat, lng: base.lng }, { lat: -4.3701, lng: 15.2501 });
  assert.equal(geocoder.asked.length, 1, 'a hit on the most specific query must not trigger the rest');
});

test('a landmark that leads nowhere costs one call and never moves the pin', async () => {
  // The failure this guards: a reference that looked like a landmark but is
  // not a real place must not be allowed to drag a listing somewhere else. It
  // simply fails, and the address-only query decides.
  const geocoder = fakeGeocoder({
    'Avenue Tombalbaye, Gombe, Kinshasa, RD Congo': { lat: -4.3055, lng: 15.3062 },
  });

  const base = await resolveListingBase({
    listing: { id: 'a2', address: 'Avenue Tombalbaye', commune: 'Gombe', reference: 'Kabaya' },
    geocoder,
  });

  assert.deepEqual({ lat: base.lat, lng: base.lng }, { lat: -4.3055, lng: 15.3062 });
  assert.deepEqual(geocoder.asked, [
    'Avenue Tombalbaye, Kabaya, Gombe, Kinshasa, RD Congo',
    'Avenue Tombalbaye, Gombe, Kinshasa, RD Congo',
  ]);
});

test('a commune-only match is not accepted as an address match', async () => {
  // Google answers OK for "…, Lemba, Kinshasa" with the commune outline. Taking
  // that would scatter pins onto slightly different "approximate" guesses; the
  // verified centroid is both more honest and what makes co-location work.
  const geocoder = fakeGeocoder({
    'Quelque part, Righini, Lemba, Kinshasa, RD Congo': { lat: -4.39, lng: 15.33, vague: true },
    'Righini, Lemba, Kinshasa, RD Congo': { lat: -4.39, lng: 15.33, vague: true },
  });

  const base = await resolveListingBase({
    listing: { id: 'a3', address: 'Quelque part', quartier: 'Righini', commune: 'Lemba' },
    geocoder,
  });

  assert.equal(base.source, 'commune_fallback');
  assert.equal(base.precise, false);
  assert.deepEqual({ lat: base.lat, lng: base.lng }, KINSHASA_COMMUNE_CENTROIDS.Lemba);
});

test('real stored coordinates win outright, without a geocode call', async () => {
  const geocoder = fakeGeocoder({});
  const base = await resolveListingBase({
    listing: { id: 'a4', latitude: '-4.3251', longitude: '15.3128', address: 'ignored', commune: 'Gombe' },
    geocoder,
  });

  assert.equal(base.source, 'existing');
  assert.deepEqual({ lat: base.lat, lng: base.lng }, { lat: -4.3251, lng: 15.3128 });
  assert.equal(geocoder.asked.length, 0);
});

test('a listing with nothing to go on resolves to null rather than a made-up point', async () => {
  const base = await resolveListingBase({
    listing: { id: 'a5', address: 'Somewhere else entirely', commune: null },
    geocoder: fakeGeocoder({}),
  });
  assert.equal(base, null);
});

test('a lone listing keeps the 200-400m privacy blur it always had', () => {
  const base = { lat: -4.325, lng: 15.322, source: 'geocoded', precise: true };
  const placed = placeResolvedListings([{ id: 7, base }]);
  const pin = placed.get(7);

  assert.equal(pin.colocated, false);
  assert.equal(pin.groupSize, 1);
  assert.equal(pin.source, 'geocoded');

  const distance = metresBetween(pin, base);
  assert.ok(distance >= 200 && distance <= 400, `moved ${distance}m, expected 200-400m`);

  // Same listing, same point, every reload — not a fresh random spot.
  assert.deepEqual(placeResolvedListings([{ id: 7, base }]).get(7), pin);
});

test('listings at one address are fanned apart instead of stacking invisibly', () => {
  // Three listings in the same building: identical address text, identical
  // building reference, so they resolve to one identical point.
  const base = { lat: -4.3380, lng: 15.2664, source: 'geocoded', precise: true };
  const placed = placeResolvedListings([1, 2, 3].map((id) => ({ id, base: { ...base } })));

  assert.equal(placed.size, 3);
  for (const id of [1, 2, 3]) {
    assert.equal(placed.get(id).colocated, true);
    assert.equal(placed.get(id).groupSize, 3);
  }

  // The point of the exercise: every pair is far enough apart to be two
  // separate, clickable price tags rather than one covering the others.
  for (const [a, b] of [[1, 2], [1, 3], [2, 3]]) {
    const gap = metresBetween(placed.get(a), placed.get(b));
    assert.ok(gap > 200, `pins ${a} and ${b} are only ${Math.round(gap)}m apart`);
  }

  // And each is still within the privacy blur of its own real location — a
  // nudge onto a ring, not a relocation into another quartier.
  for (const id of [1, 2, 3]) {
    assert.ok(metresBetween(placed.get(id), base) <= 400);
  }
});

test('a whole commune falling back to one centroid still produces distinct pins', () => {
  // The common case, not the exotic one: 23 of 31 approved listings carry no
  // coordinates, and every one of them that fails to geocode lands on its
  // commune's single centroid.
  const base = { lat: KINSHASA_COMMUNE_CENTROIDS.Kalamu.lat, lng: KINSHASA_COMMUNE_CENTROIDS.Kalamu.lng, source: 'commune_fallback', precise: false };
  const ids = Array.from({ length: 12 }, (unused, i) => 100 + i);
  const placed = placeResolvedListings(ids.map((id) => ({ id, base: { ...base } })));

  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      assert.ok(metresBetween(placed.get(a), placed.get(b)) > 100, `pins ${a} and ${b} are on top of each other`);
    }
    // The ring widens to fit the group, but never past the commune it belongs to.
    assert.ok(metresBetween(placed.get(a), base) <= 900);
  }
});

test('the fan is stable no matter what order the results arrive in', () => {
  // `listings` order changes with the sort dropdown; a building must not
  // rearrange its pins every time the visitor re-sorts.
  const base = { lat: -4.4, lng: 15.28, source: 'geocoded', precise: true };
  const entries = [1, 2, 10].map((id) => ({ id, base: { ...base } }));

  const forwards = placeResolvedListings(entries);
  const backwards = placeResolvedListings([...entries].reverse());

  for (const id of [1, 2, 10]) assert.deepEqual(forwards.get(id), backwards.get(id));
});

test('listings a few hundred metres apart are left alone', () => {
  // Only pins genuinely on the same spot get fanned. Two real addresses in the
  // same quartier keep their own resolved positions.
  const placed = placeResolvedListings([
    { id: 1, base: { lat: -4.325, lng: 15.322, source: 'geocoded', precise: true } },
    { id: 2, base: { lat: -4.328, lng: 15.326, source: 'geocoded', precise: true } },
  ]);

  assert.equal(placed.get(1).colocated, false);
  assert.equal(placed.get(2).colocated, false);
});

test('an unresolved listing is dropped, never plotted at NaN', () => {
  const placed = placeResolvedListings([
    { id: 1, base: { lat: -4.3, lng: 15.3, source: 'geocoded', precise: true } },
    { id: 2, base: null },
    { id: 3, base: { lat: null, lng: 15.3 } },
  ]);

  assert.equal(placed.size, 1);
  assert.ok(placed.has(1));
  assert.deepEqual(placeResolvedListings(undefined), new Map());
});
