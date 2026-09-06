import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPrice, priceZIndex, pricePinGeometry } from '@/lib/mapIcons';
import {
  spreadColocatedPins,
  COLOCATION_EPSILON_DEG,
  PIN_SPREAD_RADIUS_DEG,
} from '@/lib/mapPinSpread';

/**
 * The map renders every listing as a bare price tag, so the price string and
 * the tag's geometry are the entire content of a marker — there is no icon
 * or colour left to carry meaning if either is wrong.
 *
 * These tests deliberately avoid buildPricePinIcon itself, which constructs
 * `google.maps.Size`/`Point` and so needs the Maps JS API loaded in a
 * browser. Everything carrying a real decision — the label, the stacking
 * order, the layout, the co-location spread — is a pure function precisely
 * so it can be pinned here.
 *
 * (This file previously covered category pin kinds and cluster ring
 * geometry. Both features were removed on a direction change to the dense
 * price-tag pattern, and their tests went with them rather than being left
 * asserting against deleted modules.)
 */

test('the pin price label never rounds a rent into a different price band', () => {
  // Whole-thousand rounding printed 1 200 $ as "1k", understating it by
  // 200 $ and flattening every rent from 1 000 to 1 499 onto one label.
  assert.equal(compactPrice(1200, 'rent'), '1,2k $/m');
  assert.equal(compactPrice(1450, 'rent'), '1,5k $/m');
  assert.equal(compactPrice(2000, 'rent'), '2k $/m');
  assert.equal(compactPrice(400, 'rent'), '400 $/m');
  assert.equal(compactPrice(185000, 'sale'), '185k $');
  assert.equal(compactPrice(45000, 'sale'), '45k $');

  // An unknown price renders nothing at all rather than "0 $/m" or
  // "NaN $" — the same contract lib/format.js's formatPrice holds.
  for (const bad of [null, undefined, '', 'abc', NaN, 0]) {
    assert.equal(compactPrice(bad, 'rent'), '');
  }
});

test('stacking order puts higher prices in front, and never above the hover slot', () => {
  assert.ok(priceZIndex(185000) > priceZIndex(1200));
  assert.ok(priceZIndex(1200) > priceZIndex(400));
  assert.equal(priceZIndex(null), 0);

  // PropertyMap gives a hovered marker google.maps.Marker.MAX_ZINDEX + 1
  // (1000001). A resting tag must never reach it, or an expensive listing
  // would sit on top of the one the visitor is actually pointing at.
  assert.ok(priceZIndex(50_000_000) < 1_000_000);
});

test('the price tag fits its own canvas and anchors on the tail tip', () => {
  for (const hovered of [false, true]) {
    const g = pricePinGeometry({ label: '1,2k $/m', hovered });

    assert.equal(g.tipY, g.y + g.h + g.tailH);
    assert.ok(g.tipY <= g.height, 'tail tip falls outside the icon canvas');
    assert.ok(g.w <= g.width - g.pad * 2, 'body is wider than its canvas allows');
    assert.ok(g.x >= g.pad - 0.001, 'body starts inside the shadow padding');
  }

  // Hover scales the same tag up; it must not reflow into a different shape.
  const rest = pricePinGeometry({ label: '450k $' });
  const hover = pricePinGeometry({ label: '450k $', hovered: true });
  assert.ok(hover.width > rest.width && hover.height > rest.height);
});

test('a long label widens the tag instead of overflowing it', () => {
  const short = pricePinGeometry({ label: '9 $' });
  const long = pricePinGeometry({ label: '12500k $/m' });
  assert.ok(long.width > short.width);
  assert.ok(long.w <= long.width - long.pad * 2);
});

test('a listing with no usable price still gets a tag of its own', () => {
  // The position is real even when the price is missing, so the marker must
  // still plot. buildPricePinIcon substitutes "N.C." for the empty label so
  // the tag admits the gap rather than rendering as a blank white pill —
  // reachable today, 1 of 36 approved listings has no price.
  const g = pricePinGeometry({ label: 'N.C.' });
  assert.ok(g.width > 0 && g.height > 0);
  assert.equal(g.tipY, g.y + g.h + g.tailH);
  assert.ok(g.w <= g.width - g.pad * 2);
});

test('pins that are not co-located are left exactly where they were', () => {
  const pins = [
    { id: 1, lat: -4.3, lng: 15.3 },
    { id: 2, lat: -4.35, lng: 15.31 },
  ];
  const placed = spreadColocatedPins(pins);

  for (const pin of pins) {
    assert.deepEqual(placed.get(pin.id), { lat: pin.lat, lng: pin.lng, spread: false });
  }
});

test('co-located pins fan onto a ring instead of hiding behind each other', () => {
  const base = { lat: -4.325, lng: 15.322 };
  const pins = [
    { id: 3, ...base },
    { id: 1, ...base },
    { id: 2, ...base },
  ];
  const placed = spreadColocatedPins(pins);

  assert.equal(placed.size, 3);
  for (const { id } of pins) assert.equal(placed.get(id).spread, true);

  // No two pins share a position any more.
  const keys = pins.map(({ id }) => `${placed.get(id).lat.toFixed(8)},${placed.get(id).lng.toFixed(8)}`);
  assert.equal(new Set(keys).size, 3, 'two pins still occupy the same point');

  // Each sits about one spread-radius from where it started — a nudge, not
  // a relocation. Longitude is divided by cos(lat), so compare in metres-ish
  // terms on latitude alone plus the scaled longitude.
  for (const { id } of pins) {
    const p = placed.get(id);
    const dLat = p.lat - base.lat;
    const dLng = (p.lng - base.lng) * Math.cos((base.lat * Math.PI) / 180);
    const distance = Math.hypot(dLat, dLng);
    assert.ok(
      Math.abs(distance - PIN_SPREAD_RADIUS_DEG) < 1e-9,
      `pin ${id} moved ${distance}, expected ~${PIN_SPREAD_RADIUS_DEG}`,
    );
  }
});

test('the spread is deterministic and independent of input order', () => {
  // `listings` order changes with the sort dropdown; the same building must
  // not rearrange its tags every time the visitor re-sorts.
  const base = { lat: -4.4, lng: 15.28 };
  const a = spreadColocatedPins([{ id: 1, ...base }, { id: 2, ...base }, { id: 10, ...base }]);
  const b = spreadColocatedPins([{ id: 10, ...base }, { id: 2, ...base }, { id: 1, ...base }]);

  for (const id of [1, 2, 10]) {
    assert.deepEqual(a.get(id), b.get(id), `pin ${id} moved when the input order changed`);
  }

  // Numeric collation, so #10 sorts after #2 rather than after #1.
  assert.notDeepEqual(a.get(2), a.get(10));
});

test('pins just outside the co-location threshold are not dragged together', () => {
  // Two listings a few hundred metres apart — which is what lib/geocoding's
  // 200-400m privacy jitter normally produces — must be left alone.
  const placed = spreadColocatedPins([
    { id: 1, lat: -4.325, lng: 15.322 },
    { id: 2, lat: -4.325 + COLOCATION_EPSILON_DEG * 4, lng: 15.322 },
  ]);
  assert.equal(placed.get(1).spread, false);
  assert.equal(placed.get(2).spread, false);
});

test('unresolvable coordinates are dropped rather than plotted at NaN', () => {
  const placed = spreadColocatedPins([
    { id: 1, lat: -4.3, lng: 15.3 },
    { id: 2, lat: null, lng: 15.3 },
    { id: 3, lat: NaN, lng: NaN },
  ]);
  assert.equal(placed.size, 1);
  assert.ok(placed.has(1));
  assert.deepEqual(spreadColocatedPins(undefined), new Map());
});
