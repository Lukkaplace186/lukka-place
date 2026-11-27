import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  landingPageHref,
  landingPageNumber,
  landingTitleTypes,
  LANDING_PAGE_SIZE,
} from '../../lib/seoPages.js';
import { groupGuidesByCommune, priceExamples, relatedGuides } from '../../lib/priceGuideLinks.js';
import { searchedPlaceLabel, escapeRegExp } from '../../lib/searchParser.js';

/**
 * SEO plan 2026-11-26: Google had never seen 30 of 57 sampled pages. Landing
 * pages now page through every listing, titles name the kinds listed, price
 * pages link to each other, and the search parser leaves the first download.
 */

const facets = [
  { purpose: 'rent', commune: 'Limete', propertyType: 'appartement', count: 90 },
  { purpose: 'rent', commune: 'Limete', propertyType: 'maison', count: 60 },
  { purpose: 'rent', commune: 'Limete', propertyType: 'studio', count: 12 },
  { purpose: 'rent', commune: 'Limete', propertyType: 'parcelle', count: 500 }, // overlay, never named
  { purpose: 'rent', commune: 'Gombe', propertyType: 'bureau', count: 40 },
  { purpose: 'sale', commune: 'Limete', propertyType: 'terrain', count: 30 },
  { purpose: 'rent', commune: 'Ngaba', propertyType: 'maison', count: 1 },
];

test('an all-types commune page is named after its two biggest kinds', () => {
  assert.deepEqual(landingTitleTypes({ transaction: 'location', commune: 'Limete' }, facets), ['appartement', 'maison']);
});

test('the overlay rows (parcelle, commercial) are never named', () => {
  assert.ok(!landingTitleTypes({ transaction: 'location', commune: 'Limete' }, facets).includes('parcelle'));
});

test('the whole-city page counts every commune of that transaction only', () => {
  assert.deepEqual(landingTitleTypes({ transaction: 'location' }, facets), ['appartement', 'maison']);
  assert.deepEqual(landingTitleTypes({ transaction: 'vente' }, facets), ['terrain']);
});

test('a kind with a single listing is not put in a title; a typed page names none', () => {
  assert.deepEqual(landingTitleTypes({ transaction: 'location', commune: 'Ngaba' }, facets), []);
  assert.deepEqual(landingTitleTypes({ transaction: 'location', commune: 'Limete', propertyType: 'maison' }, facets), []);
});

test('?page= is 1 when absent, a number when whole, null otherwise', () => {
  assert.equal(landingPageNumber(undefined), 1);
  assert.equal(landingPageNumber(''), 1);
  assert.equal(landingPageNumber('3'), 3);
  assert.equal(landingPageNumber(['2', '5']), 2);
  for (const bad of ['0', '-1', '1.5', 'abc', '01', '99999']) assert.equal(landingPageNumber(bad), null, bad);
});

test('page 1 is the bare path, later pages carry ?page=', () => {
  assert.equal(landingPageHref('/location/limete', 1), '/location/limete');
  assert.equal(landingPageHref('/location/limete', 4), '/location/limete?page=4');
  assert.equal(LANDING_PAGE_SIZE, 24);
});

test('the landing page links every page of its results and is self-canonical per page', () => {
  const src = readFileSync(new URL('../../components/seo/SeoLandingPage.js', import.meta.url), 'utf8');
  assert.match(src, /function LandingPager/);
  assert.match(src, /paginateAlternates\(await localizedAlternates\(path\), pageNumber\)/);
  assert.match(src, /offset: \(pageNumber - 1\) \* LANDING_PAGE_SIZE/);
  assert.match(src, /if \(pageNumber > pages\) return null;/);
});

const guides = [
  { commune: 'Limete', beds: 2, listings: 216, median: 500, slug: '2-chambres-limete' },
  { commune: 'Limete', beds: 1, listings: 131, median: 280, slug: '1-chambre-limete' },
  { commune: 'Gombe', beds: 2, listings: 80, median: 1500, slug: '2-chambres-gombe' },
  { commune: 'Ngaliema', beds: 2, listings: 120, median: 900, slug: '2-chambres-ngaliema' },
  { commune: 'Ngaliema', beds: 3, listings: 60, median: 1300, slug: '3-chambres-ngaliema' },
];

test('price guides group by commune, biggest first, bedrooms in order', () => {
  const groups = groupGuidesByCommune(guides);
  assert.deepEqual(groups.map((g) => g.commune), ['Limete', 'Ngaliema', 'Gombe']);
  assert.deepEqual(groups[0].guides.map((g) => g.beds), [1, 2]);
});

test('the hub snippet quotes the 2-bedroom medians resting on the most listings', () => {
  assert.deepEqual(priceExamples(guides, 2, 2).map((g) => g.commune), ['Limete', 'Ngaliema']);
});

test('a price page links its commune and its bedroom count elsewhere, never itself', () => {
  const { sameCommune, sameBeds } = relatedGuides(guides, guides[0]);
  assert.deepEqual(sameCommune.map((g) => g.slug), ['1-chambre-limete']);
  assert.deepEqual(sameBeds.map((g) => g.slug), ['2-chambres-ngaliema', '2-chambres-gombe']);
});

test('listing pages carry the explore links', () => {
  const src = readFileSync(new URL('../../app/(site)/listings/[id]/page.js', import.meta.url), 'utf8');
  assert.match(src, /<ListingExploreLinks listing=\{listing\} \/>/);
});

test('searchedPlaceLabel and escapeRegExp still come out of the parser module', () => {
  assert.equal(searchedPlaceLabel({ communes: 'Gombe,Kinshasa' }), 'Gombe ou commune de Kinshasa');
  assert.equal(escapeRegExp('a.b'), 'a\\.b');
});

test('no first-paint search component imports the parser or the gazetteer statically', () => {
  for (const file of ['LocationAutocomplete', 'SearchBar', 'FilterBar', 'MobileMapChrome']) {
    const src = readFileSync(new URL(`../../components/${file}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '@\/lib\/(searchParser|gazetteer)'/, file);
  }
  const loader = readFileSync(new URL('../../lib/searchEngine.js', import.meta.url), 'utf8');
  assert.match(loader, /import\('\.\/searchParser'\)/);
  assert.match(loader, /import\('\.\/gazetteer'\)/);
});
