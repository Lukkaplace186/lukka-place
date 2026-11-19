import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { popularSearchLinks } from '@/lib/seoPages';

/**
 * The homepage's "Recherches populaires" links (owner, 2026-11-19): landing
 * pages that have listings, most first, never Goma.
 */
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const FACETS = [
  { commune: 'Gombe', purpose: 'rent', propertyType: 'appartement', count: 40 },
  { commune: 'Ngaliema', purpose: 'rent', propertyType: 'appartement', count: 25 },
  { commune: 'Ngaliema', purpose: 'sale', propertyType: 'maison', count: 9 },
  { commune: 'Limete', purpose: 'rent', propertyType: 'maison', count: 0 },
  { commune: null, purpose: 'rent', propertyType: 'appartement', count: 3 },
  { commune: 'Gombe', purpose: 'rent', propertyType: 'parcelle', count: 5 },
  { commune: 'Kampemba', purpose: 'rent', propertyType: 'appartement', count: 4 },
  { commune: 'Karisimbi', purpose: 'sale', propertyType: 'terrain', count: 7 },
];

test('every link is a landing page with listings, most listings first', () => {
  const links = popularSearchLinks(FACETS);
  const hrefs = links.map((l) => l.href);
  assert.equal(hrefs[0], '/location/appartements/gombe');
  assert.ok(hrefs.includes('/location/appartements/ngaliema'));
  assert.ok(!hrefs.some((h) => h.includes('limete')), 'a page with no listing is never linked');
  assert.equal(new Set(hrefs).size, hrefs.length, 'no link twice');
  const kintype = links.find((l) => l.href === '/location/appartements');
  assert.equal(kintype.count, 68, 'a type across Kinshasa counts every Kinshasa commune and the untagged');
  const gombe = links.find((l) => l.href === '/location/gombe');
  assert.equal(gombe.count, 40, 'a parcelle overlay is not added to the commune total');
});

test('other cities are linked, Goma is left out', () => {
  const all = popularSearchLinks(FACETS).map((l) => l.href);
  assert.ok(all.some((h) => h.includes('lubumbashi')), 'Lubumbashi (Kampemba) is linked');
  assert.ok(all.some((h) => h.includes('goma')), 'without the exclusion Goma (Karisimbi) would be linked');
  const noGoma = popularSearchLinks(FACETS, { excludeCities: ['Goma'] }).map((l) => l.href);
  assert.ok(!noGoma.some((h) => h.includes('goma')));
});

test('the homepage renders the block, without Goma, and the hero keeps its search words in the h1', () => {
  assert.match(read('app/(site)/(home)/page.js'), /<PopularSearches \/>/);
  assert.match(read('components/PopularSearches.js'), /POPULAR_SEARCHES_EXCLUDED_CITIES = \['Goma'\]/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    assert.match(dict.home.hero.kicker, lang === 'fr' ? /à louer et à vendre à Kinshasa/ : /for Rent and Sale in Kinshasa/);
    assert.ok(dict.home.popularSearches.title);
    assert.doesNotMatch(JSON.stringify(dict), /Goma/, `${lang}: no Goma in the copy`);
  }
  assert.doesNotMatch(read('app/manifest.js'), /Goma/);
});
