import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { viewingGroups } from '@/lib/viewingGroups';

// 2026-11-11: visits #21 and #22 were one request said twice; /admin/viewings
// showed two unrelated rows.

const root = path.resolve(import.meta.dirname, '..', '..');

test('a copy the engine closed names the request that stands, and that one lists it', () => {
  const groups = viewingGroups([
    { id: 22, lead_wa_id: '243977621789', property_id: 805, status: 'DECLINED', first_response_at: 'x' },
    { id: 21, lead_wa_id: '243977621789', property_id: 805, status: 'CANCELLED', duplicate_of: 22 },
  ]);
  assert.equal(groups.get(21).duplicateOf, 22);
  assert.deepEqual(groups.get(22).copies, [21]);
});

test('an older copy never closed is marked against the answered one', () => {
  const groups = viewingGroups([
    { id: 22, lead_wa_id: '243977621789', property_id: 805, status: 'DECLINED', first_response_at: 'x' },
    { id: 21, lead_wa_id: '+243 977 621 789', property_id: 805, status: 'PENDING' },
  ]);
  assert.equal(groups.get(21).possibleDuplicateOf, 22);
  assert.deepEqual(groups.get(22).copies, [21]);
  assert.equal(groups.get(22).possibleDuplicateOf, null);
});

test('nothing answered: the newest stands; another customer or listing is never a copy', () => {
  const groups = viewingGroups([
    { id: 31, lead_wa_id: '243900000001', property_id: 9, status: 'PENDING' },
    { id: 30, lead_wa_id: '243900000001', property_id: 9, status: 'PENDING' },
    { id: 29, lead_wa_id: '243900000002', property_id: 9, status: 'PENDING' },
    { id: 28, lead_wa_id: '243900000001', property_id: 10, status: 'PENDING' },
  ]);
  assert.equal(groups.get(30).possibleDuplicateOf, 31);
  assert.deepEqual(groups.get(31).copies, [30]);
  for (const id of [29, 28]) {
    assert.equal(groups.get(id).possibleDuplicateOf, null);
    assert.deepEqual(groups.get(id).copies, []);
  }
});

test('two answered requests (two real visits) are not copies of each other', () => {
  const groups = viewingGroups([
    { id: 41, lead_wa_id: '243900000003', property_id: 5, status: 'COMPLETED', first_response_at: 'x' },
    { id: 40, lead_wa_id: '243900000003', property_id: 5, status: 'DECLINED', first_response_at: 'y' },
  ]);
  assert.equal(groups.get(40).possibleDuplicateOf, null);
  assert.deepEqual(groups.get(41).copies, []);
});

test('the viewings page shows copies and the automatic take-down', () => {
  const src = readFileSync(path.join(root, 'app', 'admin', 'viewings', 'page.js'), 'utf8');
  assert.match(src, /viewingGroups\(rows\)/);
  assert.match(src, /admin\.viewings\.duplicateOf/);
  assert.match(src, /admin\.viewings\.sameRequestAs/);
  assert.match(src, /row\.listing_closed_at/);
});
