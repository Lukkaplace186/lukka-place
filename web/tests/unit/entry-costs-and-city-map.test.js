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
