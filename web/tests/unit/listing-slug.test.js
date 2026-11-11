import test from 'node:test';
import assert from 'node:assert/strict';

import { listingPath, listingSlug, slugify, LISTING_SEGMENT } from '@/lib/listingSlug';
import { toEnglishPath, toFrenchPath } from '@/lib/localePaths';
import { listingIdFromPath, sitePageViewPath } from '@/lib/analyticsClient';
import { getListingById, getSitemapListings } from '@/lib/listings';
import { enqueue, lastCall, reset } from '../support/fakePool.js';

// Keyword listing URLs (2026-11-10 SEO pass): /listings/509-appartement-1-chambre-a-louer-limete.

test('the slug is built from the structured facts, in French, without accents', () => {
  assert.equal(
    listingSlug({ id: 509, category_name: 'Appartement', beds: 1, purpose: 'rent', commune: 'Limete' }),
    'appartement-1-chambre-a-louer-limete',
  );
  assert.equal(
    listingSlug({ id: 7, category_name: 'Maison', beds: '3', purpose: 'sale', commune: 'Kasa-Vubu' }),
    'maison-3-chambres-a-vendre-kasa-vubu',
  );
  assert.equal(listingSlug({ category_name: 'Bâtiment / Entrepôt', purpose: 'rent', commune: 'Ngaliema' }), 'batiment-entrepot-a-louer-ngaliema');
  assert.equal(slugify('  Mont-Ngafula, Kimbondo  '), 'mont-ngafula-kimbondo');
});

test('a parcelle sub-type names the kind; the quartier or city stands in for a missing commune', () => {
  assert.equal(listingSlug({ category_name: 'Maison', parcelle_subtype: 'villa', purpose: 'rent', commune: 'Gombe' }), 'villa-a-louer-gombe');
  assert.equal(listingSlug({ category_name: 'Terrain', parcelle_subtype: 'terrain_nu', purpose: 'sale', quartier: 'Kimbanseke' }), 'terrain-a-vendre-kimbanseke');
  assert.equal(listingSlug({ category_name: 'Maison', purpose: 'rent', city_name: 'Lubumbashi' }), 'maison-a-louer-lubumbashi');
});

test('a missing fact is left out, never guessed; nothing known gives the bare id', () => {
  assert.equal(listingSlug({ category_name: 'Studio', beds: 0, purpose: null }), 'studio');
  assert.equal(listingSlug({ beds: null }), '');
  assert.equal(listingPath({ id: 12 }), '/listings/12');
  assert.equal(listingPath({ id: '509', category_name: 'Appartement', beds: 2, purpose: 'rent', commune: 'Limete' }), '/listings/509-appartement-2-chambres-a-louer-limete');
  assert.equal(listingPath(null), '/listings');
});

test('a long slug is cut on a word boundary', () => {
  const slug = listingSlug({ category_name: 'Ferme / terrain agricole '.repeat(6), purpose: 'sale', commune: 'Maluku' });
  assert.ok(slug.length <= 80, slug);
  assert.ok(!slug.endsWith('-'));
});

test('the id is still what the page reads: the lookup parses the leading integer, behind the public gate', async () => {
  reset();
  enqueue([]);
  await getListingById('509-appartement-1-chambre-a-louer-limete');
  assert.deepEqual(lastCall().values, [509]);
  assert.match(lastCall().sql, /p\.status = 1 AND p\.approve_status = 1/);
});

test('the sitemap reads the slug facts under the public gate', async () => {
  reset();
  enqueue([{ id: '509', updated_at: '2026-11-01T00:00:00Z', category_name: 'Appartement', beds: 1, purpose: 'rent', commune: 'Limete' }]);
  const [row] = await getSitemapListings();
  assert.match(lastCall().sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.equal(listingPath(row), '/listings/509-appartement-1-chambre-a-louer-limete');
  assert.equal(row.updatedAt.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('every listing segment the site can build is accepted, a path with more segments is not', () => {
  assert.ok(LISTING_SEGMENT.test('509'));
  assert.ok(LISTING_SEGMENT.test('509-appartement-1-chambre-a-louer-limete'));
  assert.ok(!LISTING_SEGMENT.test('appartement-509'));
  assert.ok(!LISTING_SEGMENT.test('509/edit'));
});

test('a slugged listing URL has an English twin and maps back', () => {
  const fr = '/listings/509-appartement-1-chambre-a-louer-limete';
  assert.equal(toEnglishPath(`${fr}?utm_source=x`), `/en${fr}?utm_source=x`);
  assert.equal(toFrenchPath(`/en${fr}`), fr);
  assert.equal(toEnglishPath('/listings/509'), '/en/listings/509');
});

test('analytics read the id from either address, so a slug page is never double-counted as a site page', () => {
  assert.equal(listingIdFromPath('/listings/509-appartement-1-chambre-a-louer-limete'), 509);
  assert.equal(listingIdFromPath('https://lukkaplace.com/listings/509?utm_source=wa'), 509);
  assert.equal(sitePageViewPath('/listings/509-appartement-1-chambre-a-louer-limete'), null);
  assert.equal(listingIdFromPath('/listings/abc'), null);
});
