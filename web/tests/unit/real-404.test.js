import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/*
 * A missing listing or landing page must answer a real 404, not 200 +
 * noindex. That only happens when its existence check runs above every
 * loading.js (Suspense) boundary — see app/(site)/_shared/SiteLoading.js.
 */
const WEB = path.resolve(import.meta.dirname, '../..');
const SITE = path.join(WEB, 'app/(site)');
const read = (p) => fs.readFileSync(path.join(WEB, p), 'utf8');

test('no loading.js sits over the whole public site', () => {
  assert.ok(!fs.existsSync(path.join(SITE, 'loading.js')), 'app/(site)/loading.js would stream a 200 before any notFound()');
  assert.ok(!fs.existsSync(path.join(SITE, 'listings/loading.js')), 'it would sit over /listings/[id]');
});

test('listing and landing pages check existence in a layout above their own skeleton', () => {
  for (const dir of ['listings/[id]', 'location/[[...slug]]', 'vente/[[...slug]]']) {
    const layout = read(`app/(site)/${dir}/layout.js`);
    assert.match(layout, /notFound\(\)/, `${dir}/layout.js must call notFound()`);
    assert.ok(fs.existsSync(path.join(SITE, dir, 'loading.js')), `${dir} keeps its skeleton below the check`);
  }
  assert.match(read('app/(site)/listings/[id]/layout.js'), /publicListingExists/);
});

test('publicListingExists applies the public gate and getListingById’s joins', () => {
  const src = read('lib/listings.js');
  const fn = src.slice(src.indexOf('export async function publicListingExists'), src.indexOf('export async function getListingById'));
  assert.match(fn, /APPROVED_FILTER/);
  for (const table of ['property_contents', 'property_categories', 'property_category_contents']) assert.match(fn, new RegExp(`JOIN ${table}`));
});

test('every other public section still has a skeleton', () => {
  for (const dir of ['(home)', 'listings/(search)', 'a-propos', 'compte', 'contact', 'favoris', 'guides', 'messages', 'mises-a-jour', 'mot-de-passe-oublie', 'plan', 'projets', 'promoteurs', 'rapport']) {
    assert.ok(fs.existsSync(path.join(SITE, dir, 'loading.js')), `${dir}/loading.js is missing`);
  }
  // The /listings results sit one group below their boundary, so a filter
  // change (new search params on the page segment) never flashes it.
  assert.ok(fs.existsSync(path.join(SITE, 'listings/(search)/(results)/page.js')));
});
