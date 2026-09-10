import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupListingsByBuilding,
  buildingPinLabel,
  buildingBedroomsLabel,
  orderedUnits,
} from '@/lib/buildingGroups';

/**
 * A multi-unit building publishes as several listing rows sharing one
 * `parent_building_id`. In search results that is correct — each layout is its
 * own card. On the map it is not: they share an address, so they resolve to one
 * coordinate and stack into a single visible marker with the rest hidden
 * underneath.
 *
 * None of this is verifiable in a browser here — the Maps browser key is
 * HTTP-referrer-restricted and localhost is not allow-listed (web/CLAUDE.md) —
 * so the decisions that matter are pure functions, tested directly.
 */

const building = (id, price, beds, extra = {}) => ({
  id,
  price,
  beds,
  parent_building_id: 'b1e7c0de-0000-4000-8000-000000000001',
  building_name: 'Résidence Kin Marché',
  ...extra,
});

test('listings with no building id are untouched — one group each', () => {
  const groups = groupListingsByBuilding([
    { id: 1, price: 1200, beds: 3 },
    { id: 2, price: 800, beds: 2 },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].isBuilding, false);
  assert.equal(groups[0].unitCount, 1);
  assert.equal(groups[0].buildingId, null);
  // This is the overwhelming majority of listings, and also every listing
  // before properties.parent_building_id is selected — it must stay exactly
  // as it was.
  assert.deepEqual(groups.map((g) => g.representative.id), [1, 2]);
});

test('units of one building collapse into a single group', () => {
  const groups = groupListingsByBuilding([
    building(10, 1500, 3),
    building(11, 900, 3),
    building(12, 700, 2),
    building(13, 600, 2),
  ]);

  assert.equal(groups.length, 1, 'four rows, one pin');
  const [group] = groups;
  assert.equal(group.isBuilding, true);
  assert.equal(group.unitCount, 4);
  assert.equal(group.priceMin, 600);
  assert.equal(group.priceMax, 1500);
  assert.equal(group.bedsMin, 2);
  assert.equal(group.bedsMax, 3);
  assert.equal(group.buildingName, 'Résidence Kin Marché');
});

test('the cheapest unit represents the building, so pin and target agree', () => {
  const groups = groupListingsByBuilding([
    building(10, 1500, 3),
    building(13, 600, 2),
    building(11, 900, 3),
  ]);
  // The pin says "De 600$" — clicking through must not land on the 1500$ one.
  assert.equal(groups[0].representative.id, 13);
});

test('a group keeps the position of its FIRST member, preserving caller order', () => {
  const groups = groupListingsByBuilding([
    { id: 1, price: 2000, beds: 4 },
    building(10, 1500, 3),
    { id: 2, price: 300, beds: 1 },
    building(13, 600, 2),
  ]);

  assert.deepEqual(groups.map((g) => g.key), [
    'listing:1',
    'building:b1e7c0de-0000-4000-8000-000000000001',
    'listing:2',
  ]);
  assert.equal(groups[1].unitCount, 2, 'the later unit joined its building, not a new group');
});

test('two different buildings never merge', () => {
  const groups = groupListingsByBuilding([
    building(10, 1500, 3),
    building(20, 800, 2, { parent_building_id: 'other-building-id' }),
    building(11, 900, 3),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].unitCount, 2);
  assert.equal(groups[1].unitCount, 1);
});

test('a building id with only ONE unit renders as an ordinary pin, not "1 unité"', () => {
  // Can happen after a moderator unpublishes the siblings. A building pin
  // advertising a single unit is a worse pin than the price it replaced.
  const [group] = groupListingsByBuilding([building(10, 1500, 3)]);
  assert.equal(group.isBuilding, false);
  assert.equal(group.buildingId, 'b1e7c0de-0000-4000-8000-000000000001');
});

test('pin label carries the count and the real price range', () => {
  const [group] = groupListingsByBuilding([
    building(10, 1500, 3),
    building(13, 600, 2),
  ]);
  assert.equal(buildingPinLabel(group, (n) => `${n}$`), '🏢 2 unités · 600$–1500$');
});

test('a building whose units are all the same price shows one price, not a range', () => {
  const [group] = groupListingsByBuilding([
    building(10, 700, 2),
    building(11, 700, 2),
    building(12, 700, 2),
  ]);
  assert.equal(buildingPinLabel(group, (n) => `${n}$`), '🏢 3 unités · 700$');
});

test('a building with no stated prices still gets a usable pin', () => {
  const [group] = groupListingsByBuilding([
    building(10, null, 2),
    building(11, null, 3),
  ]);
  assert.equal(buildingPinLabel(group, (n) => `${n}$`), '🏢 2 unités');
  assert.equal(buildingBedroomsLabel(group), '2 à 3 ch.');
});

test('bedroom label collapses to one value, and disappears when unknown', () => {
  const [same] = groupListingsByBuilding([building(10, 700, 2), building(11, 900, 2)]);
  assert.equal(buildingBedroomsLabel(same), '2 ch.');

  const [unknown] = groupListingsByBuilding([
    building(10, 700, null),
    building(11, 900, null),
  ]);
  assert.equal(buildingBedroomsLabel(unknown), null);
});

test('drawer lists units cheapest first, with unpriced units last', () => {
  const [group] = groupListingsByBuilding([
    building(10, 1500, 3),
    building(14, null, 1),
    building(13, 600, 2),
    building(11, 900, 3),
  ]);
  assert.deepEqual(orderedUnits(group).map((u) => u.id), [13, 11, 10, 14]);
});

test('a price arriving as a numeric string is still compared as a number', () => {
  // Postgres numeric comes back as a string through some drivers; "1500" must
  // not sort below "600" as text.
  const [group] = groupListingsByBuilding([
    building(10, '1500', 3),
    building(13, '600', 2),
  ]);
  assert.equal(group.priceMin, 600);
  assert.equal(group.priceMax, 1500);
  assert.equal(group.representative.id, 13);
});

test('bedrooms are read from either the web `beds` or the engine `bedrooms` field', () => {
  const [group] = groupListingsByBuilding([
    { id: 10, price: 900, bedrooms: 3, parent_building_id: 'x' },
    { id: 11, price: 600, bedrooms: 2, parent_building_id: 'x' },
  ]);
  assert.equal(group.bedsMin, 2);
  assert.equal(group.bedsMax, 3);
});

test('empty and malformed input never throws', () => {
  assert.deepEqual(groupListingsByBuilding([]), []);
  assert.deepEqual(groupListingsByBuilding(null), []);
  assert.equal(groupListingsByBuilding([null, undefined]).length, 0);
});
