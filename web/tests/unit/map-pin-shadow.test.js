import test from 'node:test';
import assert from 'node:assert/strict';
import { pricePinGeometry, buildPricePinIcon, buildBuildingPinIcon } from '@/lib/mapIcons';

/**
 * The grounded pin (Booking.com style): a ground shadow centred on the tail
 * tip, the tip anchored on the coordinate, white at rest and royal blue when
 * active (the detail page's map; /listings draws HTML pills instead). The icon builders need `google.maps.Size`/`Point`, so those two are
 * stubbed with plain value objects — the SVG they wrap is the real output.
 */

globalThis.google = {
  maps: {
    Size: class { constructor(width, height) { this.width = width; this.height = height; } },
    Point: class { constructor(x, y) { this.x = x; this.y = y; } },
  },
};

function svgOf(icon) {
  return decodeURIComponent(icon.url.replace('data:image/svg+xml;charset=UTF-8,', ''));
}

test('the ground shadow sits on the tail tip and fits inside the canvas', () => {
  for (const hovered of [false, true]) {
    for (const label of ['9$', '1,2k$/m', '12500k$/m']) {
      const g = pricePinGeometry({ label, hovered });
      assert.ok(g.tipY + g.groundRy + 2 <= g.height, `ground shadow clipped at the bottom (${label})`);
      assert.ok(g.cx - g.groundRx >= 0 && g.cx + g.groundRx <= g.width, `ground shadow clipped at the side (${label})`);
      assert.ok(g.x >= g.pad - 0.001 && g.x + g.w <= g.width - g.pad + 0.001, `tag clipped (${label})`);
    }
  }
});

test('the icon anchors on the tail tip, where the ground shadow is drawn', () => {
  const icon = buildPricePinIcon({ listing: { price: 1200, purpose: 'rent' } });
  const g = pricePinGeometry({ label: '1,2k $/m' });
  assert.deepEqual([icon.anchor.x, icon.anchor.y], [g.cx, g.tipY]);
  assert.deepEqual([icon.scaledSize.width, icon.scaledSize.height], [g.width, g.height]);
  assert.match(svgOf(icon), new RegExp(`<ellipse cx="${g.cx.toFixed(2)}" cy="${g.tipY.toFixed(2)}"`));
});

test('resting is white with dark text; active is royal blue with white text and a white ring', () => {
  const resting = svgOf(buildPricePinIcon({ listing: { price: 500, purpose: 'rent' } }));
  assert.match(resting, /<path [^>]*fill="#FFFFFF"/);
  assert.match(resting, /<text [^>]*fill="#0B1120"/);

  const active = svgOf(buildPricePinIcon({ listing: { price: 500, purpose: 'rent' }, hovered: true }));
  assert.match(active, /<path [^>]*fill="#1E3AA8" stroke="#FFFFFF" stroke-width="1.5"/);
  assert.match(active, /<text [^>]*fill="#FFFFFF"/);
  assert.match(active, />500 \$\/m</);
});

test('a yearly rent keeps "/an" on the detail-page pin', () => {
  const svg = svgOf(buildPricePinIcon({ listing: { price: 9000, purpose: 'rent', price_period: 'an' } }));
  assert.match(svg, />9k \$\/an</);
});

test('a building pin gets the same grounding and the same active state', () => {
  const resting = svgOf(buildBuildingPinIcon({ label: '4 unités · 600$–1500$' }));
  assert.match(resting, /<ellipse /);
  assert.match(resting, /<text [^>]*fill="#0C1D50"/);
  const active = svgOf(buildBuildingPinIcon({ label: 'A & B', hovered: true }));
  assert.match(active, /<path [^>]*fill="#1E3AA8" stroke="#FFFFFF"/);
  assert.match(active, />A &amp; B</, 'label must stay escaped');
});
