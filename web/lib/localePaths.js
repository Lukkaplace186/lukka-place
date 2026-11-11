/**
 * English URLs for search engines (`/en/…`) — docs/seo-english-pages-plan.md.
 *
 * The site's language is a cookie, and Googlebot sends none, so until
 * 2026-11-05 Google had only ever seen French: nobody searching "apartment
 * for rent Kinshasa" could land on us. French stays at the root, unchanged;
 * each page people search for gets an English twin under /en, served by the
 * SAME route (middleware.js rewrites /en/rent/apartments/gombe to
 * /location/appartements/gombe and marks the request English — no copied
 * route files that could drift).
 *
 * Pure, client-safe and import-free (middleware, server and client components
 * all import it). tests/unit/locale-paths.test.js round-trips every landing path.
 */

export const EN_PREFIX = '/en';

/** French first segment → English, for the whole-page routes. */
const STATIC_PAGES = {
  '/': '/en',
  '/a-propos': '/en/about',
  '/contact': '/en/contact',
  '/agents': '/en/agents',
  '/combien-coute': '/en/rent-prices',
};

/** Transaction roots of the landing pages (lib/seoPages.js). */
const EN_TRANSACTION = { location: 'rent', vente: 'buy' };
const FR_TRANSACTION = Object.fromEntries(Object.entries(EN_TRANSACTION).map(([fr, en]) => [en, fr]));

/**
 * Plural type slugs. Commune and city slugs are place names and stay the
 * same in both languages. Every French type slug needs an English one — a
 * test fails when a new type is added to SEO_PROPERTY_TYPES without it.
 */
export const EN_TYPE_SLUGS = {
  appartements: 'apartments',
  maisons: 'houses',
  terrains: 'land',
  parcelles: 'plots',
  villas: 'villas',
  concessions: 'compounds',
  studios: 'studios',
  chambres: 'rooms',
  fermes: 'farms',
  duplex: 'duplexes',
  penthouses: 'penthouses',
  boutiques: 'shops',
  immeubles: 'buildings',
  entrepots: 'warehouses',
  bureaux: 'offices',
  'locaux-commerciaux': 'commercial-property',
};
const FR_TYPE_SLUGS = Object.fromEntries(Object.entries(EN_TYPE_SLUGS).map(([fr, en]) => [en, fr]));

const FR_STATIC = Object.fromEntries(Object.entries(STATIC_PAGES).map(([fr, en]) => [en, fr]));

/** "/a/b?x=1#y" → ["/a/b", "?x=1#y"]; a trailing slash is dropped (but "/" stays). */
function splitHref(href) {
  const match = /^([^?#]*)(.*)$/.exec(String(href));
  let path = match[1] || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
  return [path, match[2] || ''];
}

/**
 * The English twin of a French path, or null when the page has none
 * (accounts, search, guides, legal pages…). Query and hash are kept.
 *   /location/appartements/gombe → /en/rent/apartments/gombe
 *   /listings/428?utm_source=x   → /en/listings/428?utm_source=x
 */
// A listing segment: "509" or "509-appartement-1-chambre-a-louer-limete"
// (lib/listingSlug.js holds the same pattern; this module stays import-free).
const LISTING_SEGMENT = /^\d{1,18}(?:-[a-z0-9-]*)?$/;

export function toEnglishPath(href) {
  const [path, rest] = splitHref(href);
  if (STATIC_PAGES[path]) return `${STATIC_PAGES[path]}${rest}`;
  const parts = path.split('/').filter(Boolean);
  const [head, ...tail] = parts;

  if (EN_TRANSACTION[head] && tail.length <= 2) {
    const out = [EN_PREFIX, EN_TRANSACTION[head]];
    tail.forEach((segment, i) => {
      // A type slug can only be the first segment after the transaction.
      out.push(i === 0 && EN_TYPE_SLUGS[segment] ? EN_TYPE_SLUGS[segment] : segment);
    });
    return `${out.join('/')}${rest}`;
  }
  if (head === 'listings' && tail.length === 1 && LISTING_SEGMENT.test(tail[0])) return `${EN_PREFIX}/listings/${tail[0]}${rest}`;
  if (head === 'agents' && tail.length === 1 && /^\d+$/.test(tail[0])) return `${EN_PREFIX}/agents/${tail[0]}${rest}`;
  if (head === 'combien-coute' && tail.length === 1) return `${EN_PREFIX}/rent-prices/${tail[0]}${rest}`;
  return null;
}

/**
 * The French route an English path is served by, or null for an /en URL that
 * names no page (it then 404s). Strict: a French type slug under /en
 * ("/en/rent/appartements") is not accepted, so each page has one English URL.
 */
export function toFrenchPath(href) {
  const [path, rest] = splitHref(href);
  if (FR_STATIC[path]) return `${FR_STATIC[path]}${rest}`;
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== EN_PREFIX.slice(1)) return null;
  const [head, ...tail] = parts.slice(1);

  if (FR_TRANSACTION[head] && tail.length <= 2) {
    const out = [`/${FR_TRANSACTION[head]}`];
    for (const [i, segment] of tail.entries()) {
      if (i === 0 && FR_TYPE_SLUGS[segment]) out.push(FR_TYPE_SLUGS[segment]);
      // A French-only type slug ("appartements") has an English spelling — refuse it.
      else if (EN_TYPE_SLUGS[segment] && EN_TYPE_SLUGS[segment] !== segment) return null;
      else out.push(segment);
    }
    return `${out.join('/')}${rest}`;
  }
  if (head === 'listings' && tail.length === 1 && LISTING_SEGMENT.test(tail[0])) return `/listings/${tail[0]}${rest}`;
  if (head === 'agents' && tail.length === 1 && /^\d+$/.test(tail[0])) return `/agents/${tail[0]}${rest}`;
  if (head === 'rent-prices' && tail.length === 1) return `/combien-coute/${tail[0]}${rest}`;
  return null;
}

/** True for "/en" and anything under it. */
export function isEnglishPath(pathname) {
  return pathname === EN_PREFIX || String(pathname || '').startsWith(`${EN_PREFIX}/`);
}

/**
 * A link written as a French path, in the reader's language: an English
 * reader goes to the English twin when there is one, everyone else (and
 * every page without a twin) keeps the French path. External links, mailto:,
 * anchors and objects are returned unchanged.
 */
export function localizeHref(href, locale) {
  if (locale !== 'en' || typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
  if (isEnglishPath(splitHref(href)[0])) return href;
  return toEnglishPath(href) || href;
}

/**
 * The French path of whatever URL the reader is on — "/en/about" → "/a-propos",
 * a French path unchanged. For the language switch and for alternates.
 */
export function frenchPathOf(href) {
  return isEnglishPath(splitHref(href)[0]) ? toFrenchPath(href) : href;
}

/**
 * Next metadata `alternates` for a page whose French path is `frPath`:
 * canonical in the URL's own language, plus hreflang fr / en / x-default.
 * A page with no English twin gets its plain French canonical only.
 *
 * @param {string} frPath
 * @param {'fr'|'en'} urlLocale the language of the URL being served (not the cookie)
 */
export function localeAlternates(frPath, urlLocale = 'fr') {
  const enPath = toEnglishPath(frPath);
  if (!enPath) return { canonical: frPath };
  return {
    canonical: urlLocale === 'en' ? enPath : frPath,
    languages: { fr: frPath, en: enPath, 'x-default': frPath },
  };
}
