// 2026-10-22: the listing editors carry the three entry costs as separate
// fields, and the /listings map treats a city change as a new place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('admin editor posts caution, avance and commission separately and saves each column', () => {
  const editor = read('app/admin/listings/[id]/AdminListingEditor.js');
  for (const name of ['deposit_months', 'advance_months', 'commission_months']) {
    assert.match(editor, new RegExp(`name="${name}"`));
  }
  const action = read('app/admin/listings/[id]/actions.js');
  assert.match(action, /advanceMonths: int\(formData, 'advance_months'\)/);
  assert.match(action, /commissionMonths: int\(formData, 'commission_months'\)/);
  const lib = read('lib/adminListings.js');
  assert.match(lib, /advanceMonths: 'advance_months'/);
  assert.match(lib, /commissionMonths: 'commission_months'/);
  assert.match(lib, /p\.advance_months, p\.commission_months/);
});

test('agent editor posts the three entry costs and the update writes all three', () => {
  const editor = read('components/AgentListingEditor.js');
  for (const name of ['deposit_months', 'advance_months', 'commission_months']) {
    assert.match(editor, new RegExp(`name="${name}"`));
  }
  const lib = read('lib/agentListings.js');
  assert.match(lib, /advance_months = CASE WHEN \$14::boolean/);
  assert.match(lib, /commission_months = CASE WHEN \$16::boolean/);
});

test('the map place key includes the city, so switching city re-centres the map', () => {
  const map = read('components/ListingsMap.js');
  assert.match(map, /get\('ville'\)/);
  assert.match(map, /`\$\{ville\}\|`/);
});

// Lubumbashi's live extent on 2026-10-22: 11 listings, ~10 km across.
const LUBUMBASHI_EXTENT = { south: -11.714997, north: -11.6293128, west: 27.407011, east: 27.502617 };

test('a city switch frames every matching listing, not a fixed zoom on the centre', async () => {
  const { cityResultsView, viewForBounds } = await import('../../lib/mapViewport.js');
  const size = { width: 486, height: 550 };
  const view = cityResultsView('Lubumbashi', LUBUMBASHI_EXTENT, size);
  assert.equal(view.zoom, 12);
  // Every corner of the extent is inside the view at that zoom (256px tiles).
  const span = (360 / (256 * 2 ** view.zoom)) * (size.width - 96);
  assert.ok(view.center.lng - span / 2 <= LUBUMBASHI_EXTENT.west);
  assert.ok(view.center.lng + span / 2 >= LUBUMBASHI_EXTENT.east);
  // Kinshasa keeps its fixed core view; no extent → the default view.
  assert.equal(cityResultsView('Kinshasa', LUBUMBASHI_EXTENT, size), null);
  assert.equal(cityResultsView(null, LUBUMBASHI_EXTENT, size), null);
  assert.equal(cityResultsView('Lubumbashi', null, size), null);
  // A coordinate far outside the city cannot drag the view out of it.
  const stray = { ...LUBUMBASHI_EXTENT, north: -4.3 };
  assert.ok(cityResultsView('Lubumbashi', stray, size).zoom >= 11);
  // One point: capped, never a street-level zoom.
  assert.equal(viewForBounds({ south: 1, north: 1, west: 2, east: 2 }, size, { maxZoom: 14 }).zoom, 14);
});

test('the map counts pins only once the view has settled', () => {
  const map = read('components/ListingsMap.js');
  assert.match(map, /function settled\(map/);
  assert.match(map, /await settled\(map\);[\s\S]*fetchMarkers\(\{ force: true \}\)/);
});
