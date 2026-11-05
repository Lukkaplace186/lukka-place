import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EN_TYPE_SLUGS, frenchPathOf, isEnglishPath, localeAlternates, localizeHref, toEnglishPath, toFrenchPath,
} from '@/lib/localePaths';
import { SEO_COMMUNES, SEO_CITIES, SEO_PROPERTY_TYPES, communeSlug, landingPathsFromFacets } from '@/lib/seoPages';
import { CITIES } from '@/lib/cities';

/** English URLs (/en/…) — lib/localePaths.js, docs/seo-english-pages-plan.md. */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the page table maps both ways', () => {
  const pairs = [
    ['/', '/en'],
    ['/a-propos', '/en/about'],
    ['/contact', '/en/contact'],
    ['/agents', '/en/agents'],
    ['/agents/37', '/en/agents/37'],
    ['/location', '/en/rent'],
    ['/vente', '/en/buy'],
    ['/location/appartements', '/en/rent/apartments'],
    ['/location/gombe', '/en/rent/gombe'],
    ['/location/appartements/gombe', '/en/rent/apartments/gombe'],
    ['/vente/terrains/lubumbashi', '/en/buy/land/lubumbashi'],
    ['/location/locaux-commerciaux/commune-de-kinshasa', '/en/rent/commercial-property/commune-de-kinshasa'],
    ['/listings/428', '/en/listings/428'],
    ['/combien-coute', '/en/rent-prices'],
    ['/combien-coute/loyer-2-chambres-gombe', '/en/rent-prices/loyer-2-chambres-gombe'],
  ];
  for (const [fr, en] of pairs) {
    assert.equal(toEnglishPath(fr), en, fr);
    assert.equal(toFrenchPath(en), fr, en);
  }
  assert.equal(toEnglishPath('/listings/428?utm_source=wa#photos'), '/en/listings/428?utm_source=wa#photos');
  assert.equal(toFrenchPath('/en/rent/apartments?sort=price'), '/location/appartements?sort=price');
  assert.equal(toEnglishPath('/location/appartements/'), '/en/rent/apartments');
});

test('pages with no English twin stay French, and /en accepts only English slugs', () => {
  for (const path of ['/listings', '/listings?commune=Gombe', '/compte/client', '/guides/garantie-3-1-1-kinshasa', '/admin', '/favoris', '/location/a/b/c', '/listings/abc']) {
    assert.equal(toEnglishPath(path), null, path);
  }
  for (const path of ['/en/rent/appartements', '/en/buy/maisons/gombe', '/en/location', '/en/xyz', '/en/listings/abc', '/fr/rent']) {
    assert.equal(toFrenchPath(path), null, path);
  }
  assert.ok(isEnglishPath('/en') && isEnglishPath('/en/rent') && !isEnglishPath('/entrepots') && !isEnglishPath('/'));
});

test('every French type slug has an English one, and none collides with a place', () => {
  assert.deepEqual(Object.keys(EN_TYPE_SLUGS).sort(), Object.keys(SEO_PROPERTY_TYPES).sort());
  const english = Object.values(EN_TYPE_SLUGS);
  assert.equal(new Set(english).size, english.length);
  const places = new Set([...SEO_COMMUNES.map(communeSlug), ...CITIES.map((c) => c.slug)]);
  for (const slug of english) assert.ok(!places.has(slug), slug);
  assert.ok(SEO_CITIES.length > 0);
});

test('every landing page in the sitemap round-trips', () => {
  const facets = [];
  for (const purpose of ['rent', 'sale']) {
    for (const propertyType of Object.values(SEO_PROPERTY_TYPES).map((t) => t.propertyType)) {
      for (const commune of [...SEO_COMMUNES, 'Kampemba']) facets.push({ purpose, propertyType, commune, count: 1 });
    }
  }
  const paths = landingPathsFromFacets(facets);
  assert.ok(paths.length > 500);
  for (const path of paths) {
    const en = toEnglishPath(path);
    assert.ok(en && en.startsWith('/en/'), path);
    assert.equal(toFrenchPath(en), path);
  }
});

test('links follow the reader’s language; alternates follow the URL', () => {
  assert.equal(localizeHref('/location/maisons', 'en'), '/en/rent/houses');
  assert.equal(localizeHref('/location/maisons', 'fr'), '/location/maisons');
  assert.equal(localizeHref('/listings?commune=Gombe', 'en'), '/listings?commune=Gombe');
  assert.equal(localizeHref('/en/rent', 'en'), '/en/rent');
  assert.equal(localizeHref('https://wa.me/243', 'en'), 'https://wa.me/243');
  assert.equal(localizeHref('//cdn.example/x', 'en'), '//cdn.example/x');
  assert.deepEqual(localizeHref({ pathname: '/x' }, 'en'), { pathname: '/x' });
  assert.equal(frenchPathOf('/en/about'), '/a-propos');
  assert.equal(frenchPathOf('/a-propos'), '/a-propos');

  assert.deepEqual(localeAlternates('/listings/9', 'fr'), {
    canonical: '/listings/9',
    languages: { fr: '/listings/9', en: '/en/listings/9', 'x-default': '/listings/9' },
  });
  assert.equal(localeAlternates('/listings/9', 'en').canonical, '/en/listings/9');
  assert.deepEqual(localeAlternates('/guides/x', 'en'), { canonical: '/guides/x' });
});

test('middleware rewrites /en and the server reads the URL locale before the cookie', () => {
  const middleware = read('middleware.js');
  assert.match(middleware, /'\/en',\s*\n\s*'\/en\/:path\*'/);
  assert.match(middleware, /NextResponse\.rewrite\(target, \{ request: \{ headers: requestHeaders \} \}\)/);
  assert.match(middleware, /requestHeaders\.set\(URL_LOCALE_HEADER, 'en'\)/);
  const server = read('lib/i18n/server.js');
  assert.ok(server.indexOf("(await getUrlLocale()) === 'en'") < server.indexOf('store.get(LOCALE_COOKIE)'));
});

test('pages with an English twin declare hreflang; the sitemap lists both', () => {
  for (const file of [
    'app/(site)/(home)/page.js', 'app/(site)/a-propos/page.js', 'app/(site)/contact/page.js',
    'app/(site)/listings/[id]/page.js', 'app/(site)/combien-coute/page.js', 'app/(site)/combien-coute/[slug]/page.js',
    'app/(portfolio)/agents/page.js', 'app/(portfolio)/agents/[id]/page.js', 'components/seo/SeoLandingPage.js',
  ]) {
    assert.match(read(file), /localizedAlternates\(/, file);
  }
  assert.match(read('app/sitemap.js'), /withEnglishTwins\(base, \[/);
  // The public chrome keeps English readers in English.
  for (const file of ['components/Header.js', 'components/Footer.js', 'components/Brand.js', 'components/Breadcrumb.js', 'components/PropertyCard.js']) {
    assert.match(read(file), /import Link from '@\/components\/LocaleLink';/, file);
  }
});

test('an English listing title is in English: type, purpose and price', async () => {
  const { createTranslator } = await import('@/lib/i18n/translate');
  const { listingMetaTitle, listingMetaDescription } = await import('@/lib/listingSeo');
  const en = (await import('@/lib/i18n/en.json', { with: { type: 'json' } })).default;
  const fr = (await import('@/lib/i18n/fr.json', { with: { type: 'json' } })).default;
  const listing = { id: 725, category_name: 'Appartement', beds: 2, purpose: 'rent', price: 450, price_period: 'mois', commune: 'Limete' };
  const tEn = createTranslator({ locale: 'en', messages: en, fallbackMessages: fr });
  const tFr = createTranslator({ locale: 'fr', messages: fr, fallbackMessages: fr });
  assert.equal(listingMetaTitle(listing, tEn), '2-bedroom apartment for rent in Limete — $450 / month');
  assert.match(listingMetaTitle(listing, tFr), /^Appartement 2 chambres à louer à Limete — 450 \$ \/ mois$/);
  assert.match(listingMetaDescription({ ...listing, price: 1200, price_period: 'an' }, tEn), /^Apartment for rent in Limete — \$1,200 \/ year/);
  assert.equal(listingMetaTitle({ ...listing, purpose: 'sale', price: 85000, beds: 0, category_name: 'Terrain' }, tEn), 'Land for sale in Limete — $85,000');
});
