import { KINSHASA_COMMUNE_CENTROIDS } from './geocoding';

/**
 * The search-engine landing pages: /location, /vente and below them one page
 * per commune, per property type, and per type × commune —
 * "/location/appartements/gombe" is "Appartements à louer à Gombe".
 *
 * They exist because /listings?commune=Gombe cannot rank: a query-string
 * filter shared the homepage's title and had no canonical, so to Google it was
 * a copy of the homepage. Each page here has its own title, heading and
 * canonical, and /listings points its matching filter URLs at them
 * (`seoPathForParams`).
 *
 * Pure and client-safe (no DB, no server-only), so the slug rules are unit
 * tested directly — tests/unit/seo-pages.test.js.
 */

export const SEO_TRANSACTIONS = {
  location: { transactionType: 'location', purpose: 'rent', labelKey: 'seo.forRent' },
  vente: { transactionType: 'vente', purpose: 'sale', labelKey: 'seo.forSale' },
};

/**
 * URL slug → the `property_type` value getListings filters on (the category
 * name lowercased — "Bâtiment" keeps its accent there) and the plural label
 * key. Plural slugs, because that is what people type: "appartements à louer".
 */
export const SEO_PROPERTY_TYPES = {
  appartements: { propertyType: 'appartement', pluralKey: 'listings.typePlurals.appartement' },
  maisons: { propertyType: 'maison', pluralKey: 'listings.typePlurals.maison' },
  terrains: { propertyType: 'terrain', pluralKey: 'listings.typePlurals.terrain' },
  parcelles: { propertyType: 'parcelle', pluralKey: 'listings.typePlurals.parcelle' },
  duplex: { propertyType: 'duplex', pluralKey: 'listings.typePlurals.duplex' },
  penthouses: { propertyType: 'penthouse', pluralKey: 'seo.penthouses' },
  boutiques: { propertyType: 'boutique', pluralKey: 'listings.typePlurals.boutique' },
  batiments: { propertyType: 'bâtiment', pluralKey: 'listings.typePlurals.batiment' },
  entrepots: { propertyType: 'entrepôt', pluralKey: 'listings.typePlurals.entrepot' },
};

const TYPE_SLUG_BY_VALUE = Object.fromEntries(
  Object.entries(SEO_PROPERTY_TYPES).map(([slug, { propertyType }]) => [propertyType, slug]),
);

/** The 24 communes, same list the map's centroids and the commune tags use. */
export const SEO_COMMUNES = Object.keys(KINSHASA_COMMUNE_CENTROIDS);

/**
 * "Kasa-Vubu" → "kasa-vubu". The commune literally named Kinshasa gets its own
 * slug: "/location/kinshasa" would read as the whole city, and the city is
 * what "/location" already is.
 */
export function communeSlug(commune) {
  if (commune === 'Kinshasa') return 'commune-de-kinshasa';
  return String(commune)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const COMMUNE_BY_SLUG = Object.fromEntries(SEO_COMMUNES.map((c) => [communeSlug(c), c]));

/** Canonical commune name for a slug, or null. */
export function communeFromSlug(slug) {
  return COMMUNE_BY_SLUG[String(slug || '').toLowerCase()] || null;
}

/** Plural type slug for a `property_type` value ("appartement" → "appartements"), or null. */
export function typeSlugFor(propertyType) {
  return TYPE_SLUG_BY_VALUE[String(propertyType || '').toLowerCase()] || null;
}

/**
 * Route segments under /location or /vente → the page they name, or null for
 * a URL that is not one (the caller 404s). Accepted shapes:
 *   []                → the whole city
 *   [commune]         → one commune
 *   [type]            → one type, city-wide
 *   [type, commune]   → one type in one commune
 * Type and commune slugs cannot collide: no commune is named like a type.
 */
export function parseSeoSegments(transaction, segments = []) {
  const tx = SEO_TRANSACTIONS[transaction];
  if (!tx) return null;
  const parts = (segments || []).map((s) => decodeURIComponent(String(s)).toLowerCase());
  if (parts.length > 2) return null;

  const base = { transaction, transactionType: tx.transactionType, purpose: tx.purpose, typeSlug: null, propertyType: null, commune: null };
  if (parts.length === 0) return base;

  if (parts.length === 1) {
    const [only] = parts;
    if (SEO_PROPERTY_TYPES[only]) return { ...base, typeSlug: only, propertyType: SEO_PROPERTY_TYPES[only].propertyType };
    const commune = communeFromSlug(only);
    return commune ? { ...base, commune } : null;
  }

  const [typeSlug, communePart] = parts;
  const type = SEO_PROPERTY_TYPES[typeSlug];
  const commune = communeFromSlug(communePart);
  if (!type || !commune) return null;
  return { ...base, typeSlug, propertyType: type.propertyType, commune };
}

/**
 * The path for a transaction + optional type + optional commune, or null when
 * the transaction or type has no landing page.
 */
export function seoPath({ transaction, propertyType = null, commune = null }) {
  if (!SEO_TRANSACTIONS[transaction]) return null;
  const parts = [`/${transaction}`];
  if (propertyType) {
    const slug = typeSlugFor(propertyType);
    if (!slug) return null;
    parts.push(slug);
  }
  if (commune) {
    if (!COMMUNE_BY_SLUG[communeSlug(commune)]) return null;
    parts.push(communeSlug(commune));
  }
  return parts.join('/');
}

/** /listings params that may be present and still map onto a landing page. */
const LANDING_KEYS = new Set(['transaction_type', 'commune', 'property_type']);
/** Params that never change which listings a page shows. */
const NEUTRAL_KEYS = new Set(['sort', 'view', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'fbclid', 'gclid']);

/**
 * The landing page a /listings URL is equivalent to, or null.
 *
 * `?transaction_type=location&commune=Gombe&property_type=appartement` shows
 * exactly what /location/appartements/gombe shows, so that is its canonical.
 * Anything narrower (a budget, a quartier, a map box, page 2…) has no landing
 * page and returns null; the caller decides what that means (noindex).
 */
export function seoPathForParams(params = {}) {
  const keys = Object.keys(params).filter((k) => {
    const v = params[k];
    return v != null && v !== '' && !NEUTRAL_KEYS.has(k);
  });
  if (keys.some((k) => !LANDING_KEYS.has(k))) return null;
  const pick = (k) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const transaction = pick('transaction_type');
  if (!SEO_TRANSACTIONS[transaction]) return null;
  const commune = pick('commune') ? SEO_COMMUNES.find((c) => c === pick('commune')) : null;
  if (pick('commune') && !commune) return null;
  return seoPath({ transaction, propertyType: pick('property_type') || null, commune });
}

/**
 * Landing paths with at least one approved listing, from getSeoFacets rows —
 * the sitemap lists these and nothing else, so Google is never sent to an
 * empty page. The two city-wide roots are always included.
 */
export function landingPathsFromFacets(facets) {
  const paths = new Set();
  for (const [transaction, { purpose }] of Object.entries(SEO_TRANSACTIONS)) {
    paths.add(seoPath({ transaction }));
    for (const f of facets) {
      if (f.purpose !== purpose || f.count <= 0) continue;
      const typed = typeSlugFor(f.propertyType) ? f.propertyType : null;
      if (typed) paths.add(seoPath({ transaction, propertyType: typed }));
      if (f.commune) {
        paths.add(seoPath({ transaction, commune: f.commune }));
        if (typed) paths.add(seoPath({ transaction, propertyType: typed, commune: f.commune }));
      }
    }
  }
  paths.delete(null);
  return [...paths];
}

/** The /listings URL with the same filters — "affiner / voir sur la carte". */
export function listingsHrefFor({ transactionType, propertyType, commune }) {
  const qs = new URLSearchParams();
  if (transactionType) qs.set('transaction_type', transactionType);
  if (commune) qs.set('commune', commune);
  if (propertyType) qs.set('property_type', propertyType);
  const s = qs.toString();
  return s ? `/listings?${s}` : '/listings';
}

/**
 * Serialise structured data for a <script type="application/ld+json">.
 * `<` is escaped so an agent-written "</script>" in a title cannot close the
 * tag early and inject markup.
 */
export function jsonLdString(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
