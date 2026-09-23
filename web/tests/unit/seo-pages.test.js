import { test } from 'node:test';
import assert from 'node:assert/strict';
import fr from '../../lib/i18n/fr.json' with { type: 'json' };
import { createTranslator } from '../../lib/i18n/translate.js';
import {
  SEO_COMMUNES,
  communeSlug,
  communeFromSlug,
  jsonLdString,
  landingPathsFromFacets,
  parseSeoSegments,
  seoPath,
  seoPathForParams,
  listingsHrefFor,
} from '../../lib/seoPages.js';
import { listingMetaTitle, listingMetaDescription, listingJsonLd, communeHref } from '../../lib/listingSeo.js';
import { GUIDES } from '../../lib/guides.js';

const t = createTranslator({ locale: 'fr', messages: fr, fallbackMessages: fr });

test('every commune has a unique slug that round-trips', () => {
  const slugs = SEO_COMMUNES.map(communeSlug);
  assert.equal(new Set(slugs).size, SEO_COMMUNES.length);
  for (const commune of SEO_COMMUNES) assert.equal(communeFromSlug(communeSlug(commune)), commune);
  assert.equal(communeSlug('Kasa-Vubu'), 'kasa-vubu');
  assert.equal(communeSlug('Mont-Ngafula'), 'mont-ngafula');
  // The commune named Kinshasa must not read as the whole city.
  assert.equal(communeSlug('Kinshasa'), 'commune-de-kinshasa');
});

test('route segments parse into exactly the four accepted shapes', () => {
  assert.deepEqual(
    { ...parseSeoSegments('location', []) },
    { transaction: 'location', transactionType: 'location', purpose: 'rent', typeSlug: null, propertyType: null, commune: null },
  );
  assert.equal(parseSeoSegments('location', ['gombe']).commune, 'Gombe');
  assert.equal(parseSeoSegments('vente', ['terrains']).propertyType, 'terrain');
  const both = parseSeoSegments('location', ['appartements', 'ngiri-ngiri']);
  assert.equal(both.propertyType, 'appartement');
  assert.equal(both.commune, 'Ngiri-Ngiri');
  assert.equal(parseSeoSegments('vente', ['batiments']).propertyType, 'bâtiment');

  assert.equal(parseSeoSegments('location', ['nowhere']), null);
  assert.equal(parseSeoSegments('location', ['gombe', 'appartements']), null, 'type comes first');
  assert.equal(parseSeoSegments('location', ['appartements', 'gombe', 'x']), null);
  assert.equal(parseSeoSegments('achat', []), null);
});

test('seoPath is the inverse of parseSeoSegments', () => {
  assert.equal(seoPath({ transaction: 'location' }), '/location');
  assert.equal(seoPath({ transaction: 'location', commune: 'Gombe' }), '/location/gombe');
  assert.equal(seoPath({ transaction: 'vente', propertyType: 'Terrain', commune: 'Lemba' }), '/vente/terrains/lemba');
  assert.equal(seoPath({ transaction: 'vente', propertyType: 'bâtiment' }), '/vente/batiments');
  assert.equal(seoPath({ transaction: 'location', propertyType: 'castle' }), null);
  assert.equal(seoPath({ transaction: 'location', commune: 'Atlantis' }), null);
  for (const commune of SEO_COMMUNES) {
    const path = seoPath({ transaction: 'location', propertyType: 'appartement', commune });
    const [, tx, ...segments] = path.split('/');
    const page = parseSeoSegments(tx, segments);
    assert.equal(page.commune, commune);
    assert.equal(page.propertyType, 'appartement');
  }
});

test('a /listings URL canonicalises onto its landing page only when nothing narrower is set', () => {
  assert.equal(seoPathForParams({ transaction_type: 'location', commune: 'Gombe' }), '/location/gombe');
  assert.equal(
    seoPathForParams({ transaction_type: 'location', commune: 'Gombe', property_type: 'appartement', sort: 'newest', utm_source: 'wa' }),
    '/location/appartements/gombe',
  );
  assert.equal(seoPathForParams({ transaction_type: 'vente' }), '/vente');
  assert.equal(seoPathForParams({ commune: 'Gombe' }), null, 'no transaction → both purposes, no landing page');
  assert.equal(seoPathForParams({ transaction_type: 'location', commune: 'Gombe', price_max: '500' }), null);
  assert.equal(seoPathForParams({ transaction_type: 'location', page: '2' }), null);
  assert.equal(seoPathForParams({ transaction_type: 'location', commune: 'Nowhere' }), null);
  assert.equal(seoPathForParams({}), null);
});

test('the refine link carries exactly the landing page filters', () => {
  assert.equal(
    listingsHrefFor({ transactionType: 'location', propertyType: 'appartement', commune: 'Gombe' }),
    '/listings?transaction_type=location&commune=Gombe&property_type=appartement',
  );
  assert.equal(listingsHrefFor({}), '/listings');
});

test('the sitemap lists only landing pages that have listings, plus the two roots', () => {
  const paths = landingPathsFromFacets([
    { commune: 'Gombe', purpose: 'rent', propertyType: 'appartement', count: 2 },
    { commune: null, purpose: 'rent', propertyType: 'maison', count: 1 },
    { commune: 'Lemba', purpose: 'sale', propertyType: 'terrain', count: 1 },
    { commune: 'Limete', purpose: 'rent', propertyType: 'penthouse', count: 0 },
    { commune: 'Kintambo', purpose: 'rent', propertyType: 'mystery', count: 3 },
  ]).sort();
  assert.deepEqual(paths, [
    '/location',
    '/location/appartements',
    '/location/appartements/gombe',
    '/location/gombe',
    '/location/kintambo',
    '/location/maisons',
    '/vente',
    '/vente/lemba',
    '/vente/terrains',
    '/vente/terrains/lemba',
  ]);
});

test('JSON-LD cannot close its own script tag', () => {
  const out = jsonLdString({ name: '</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>'));
  assert.deepEqual(JSON.parse(out), { name: '</script><script>alert(1)</script>' });
});

const LISTING = {
  id: 293,
  title: 'Bel appartement',
  purpose: 'rent',
  price: 1100,
  price_period: null,
  beds: 2,
  bath: 2,
  area: null,
  deposit_months: 3,
  category_name: 'Appartement',
  parcelle_subtype: null,
  commune: 'Limete',
  quartier: 'Industriel',
  description: 'Appartement neuf au 2e étage, eau et électricité 24h/24, parking.',
  featured_image: '/uploads/a.jpg',
  gallery: [],
  created_at: '2026-09-20T10:00:00Z',
  latitude: '-4.35',
  longitude: '15.34',
};

// fr-FR groups thousands with a narrow no-break space; compare as plain spaces.
const plain = (s) => s.replace(/\s/g, ' ');

test('listing title and description come from the structured facts', () => {
  assert.equal(plain(listingMetaTitle(LISTING, t)), 'Appartement 2 chambres à louer à Limete — 1 100 $ / mois');
  const description = plain(listingMetaDescription(LISTING, t));
  assert.ok(description.startsWith('Appartement à louer à Industriel, Limete — 1 100 $ / mois. 2 chambres, 2 salles de bain, garantie 3 mois.'), description);
  assert.ok(description.length <= 160);
  // A sale has no period and no garantie.
  const sale = { ...LISTING, purpose: 'sale', price: 85000, beds: null, deposit_months: 3, category_name: 'Terrain', commune: 'Lemba' };
  assert.equal(plain(listingMetaTitle(sale, t)), 'Terrain à vendre à Lemba — 85 000 $');
  assert.ok(!listingMetaDescription(sale, t).includes('garantie'));
});

test('listing structured data: price, place, absolute images — and no coordinates', () => {
  const data = listingJsonLd(LISTING, t);
  const [listing, crumbs] = data['@graph'];
  assert.equal(listing['@type'], 'RealEstateListing');
  assert.equal(listing.offers.price, 1100);
  assert.equal(listing.offers.priceCurrency, 'USD');
  assert.equal(listing.offers.priceSpecification.unitCode, 'MON');
  assert.equal(listing.about['@type'], 'Apartment');
  assert.equal(listing.about.numberOfBedrooms, 2);
  assert.equal(listing.about.address.addressLocality, 'Limete');
  assert.ok(listing.image[0].startsWith('https://'));
  const serialized = JSON.stringify(data);
  assert.ok(!serialized.includes('-4.35') && !serialized.includes('geo'), 'the exact position must not leak');
  assert.equal(crumbs.itemListElement[2].item.endsWith('/location/limete'), true);
  // No price → no offer rather than a zero.
  assert.equal(listingJsonLd({ ...LISTING, price: 0 }, t)['@graph'][0].offers, undefined);
});

test('the commune crumb goes to the landing page for the listing’s own transaction', () => {
  assert.equal(communeHref(LISTING), '/location/limete');
  assert.equal(communeHref({ ...LISTING, purpose: 'sale' }), '/vente/limete');
  assert.equal(communeHref({ ...LISTING, commune: null }), null);
});

test('guides have unique slugs, a description and a call to action on a real landing page', () => {
  assert.equal(new Set(GUIDES.map((g) => g.slug)).size, GUIDES.length);
  for (const g of GUIDES) {
    assert.ok(g.description.length > 50 && g.description.length <= 170, g.slug);
    const [, tx, ...segments] = g.cta.href.split('/');
    assert.ok(parseSeoSegments(tx, segments), `${g.slug} → ${g.cta.href}`);
    for (const block of g.body) assert.equal(Object.keys(block).length, 1);
  }
});

test('every seo.* key exists in both languages', async () => {
  const en = (await import('../../lib/i18n/en.json', { with: { type: 'json' } })).default;
  assert.deepEqual(Object.keys(en.seo).sort(), Object.keys(fr.seo).sort());
  assert.deepEqual(Object.keys(en.guides).sort(), Object.keys(fr.guides).sort());
});
