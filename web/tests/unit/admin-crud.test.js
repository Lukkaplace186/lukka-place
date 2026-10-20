// Console create / delete for listings and agents (2026-10-20). Source-level
// checks, the same way the other admin tests pin permissions: what each new
// surface is gated on, and that delete stays the soft delete with undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('creating a listing needs listings.edit, and publishing it needs listings.moderate', () => {
  const actions = read('app/admin/listings/createActions.js');
  assert.match(actions, /export async function adminCreateListingAction[\s\S]*?requireAdmin\('listings\.edit'\)/);
  assert.match(actions, /publishNow && can\(session\.role, 'listings\.moderate'\)[\s\S]*?approveListingAction\(propertyId\)/);
  // The lists the form was built from are re-read on the server, never trusted.
  assert.match(actions, /getLocationHierarchyWithFallback\(\{ city: 'all' \}\)[\s\S]*?getCategoriesForAdmin\(\)/);
  assert.match(actions, /communes\.includes\(commune\)/);
  const page = read('app/admin/listings/nouveau/page.js');
  assert.match(page, /if \(!can\(session\?\.role, 'listings\.edit'\)\) notFound\(\)/);
  assert.match(read('app/admin/listings/page.js'), /can\(session\?\.role, 'listings\.edit'\)[\s\S]*?\/admin\/listings\/nouveau/);
});

test('adding photos appends after the gallery already there and needs listings.edit', () => {
  const actions = read('app/admin/listings/createActions.js');
  assert.match(actions, /export async function adminAddListingPhotosAction[\s\S]*?requireAdmin\('listings\.edit'\)/);
  assert.match(actions, /\[\.\.\.new Set\(\[\.\.\.existing, \.\.\.urls\]\)\]/);
});

test('deleting one listing is the soft delete with undo, owner-only, on the row and the page', () => {
  const button = read('app/admin/listings/DeleteListingButton.js');
  assert.match(button, /useBulkDelete\('listing'/);
  assert.match(read('app/admin/listings/[id]/page.js'), /can\(session\?\.role, 'listings\.delete'\) \?[\s\S]*?<DeleteListingButton/);
  assert.match(read('app/admin/listings/ModerationTable.js'), /canDelete \?[\s\S]*?bulkDelete\.request\(\[row\.id\]\)/);
});

test("deleting an agent from their own page reuses the impact dialog, owner-only, and leaves the page", () => {
  assert.match(read('app/admin/agents/[id]/page.js'), /can\(session\?\.role, 'agents\.delete'\) \? <AgentDeleteButton/);
  const button = read('app/admin/agents/[id]/AgentDeleteButton.js');
  assert.match(button, /DeleteAgentDialog/);
  assert.match(button, /onDeleted=\{\(\) => router\.push\('\/admin\/agents'\)\}/);
});
