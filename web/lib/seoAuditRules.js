import { OVERLAY_PROPERTY_TYPES, SEO_COMMUNES, SEO_PROPERTY_TYPES, facetCity, seoPath } from './seoPages';
import { DEFAULT_CITY } from './cities';

/**
 * Pure rules behind /admin/seo (no DB, no network) — tests/unit/seo-audit.test.js.
 *
 * The page answers one question: what stands between lukkaplace.com and the
 * first page of Google for "appartement à louer Kinshasa" / "apartment for
 * rent Kinshasa"? It only reports what it can see — our own pages and data,
 * and Search Console's figures once it is connected. Nothing is estimated.
 */

/**
 * The searches we want to rank for, each with the page meant to answer it.
 * The facet's French landing page (lib/seoPages.js); /admin/seo shows an
 * English search against its /en twin (lib/localePaths.js, since 2026-11-05).
 * `facet` is what the page lists, to count its listings.
 */
export const TARGET_SEARCHES = [
  { query: 'appartement à louer kinshasa', lang: 'fr', facet: { purpose: 'rent', propertyType: 'appartement' } },
  { query: 'maison à louer kinshasa', lang: 'fr', facet: { purpose: 'rent', propertyType: 'maison' } },
  { query: 'maison à vendre kinshasa', lang: 'fr', facet: { purpose: 'sale', propertyType: 'maison' } },
  { query: 'terrain à vendre kinshasa', lang: 'fr', facet: { purpose: 'sale', propertyType: 'terrain' } },
  { query: 'parcelle à vendre kinshasa', lang: 'fr', facet: { purpose: 'sale', propertyType: 'parcelle' } },
  { query: 'appartement à louer gombe', lang: 'fr', facet: { purpose: 'rent', propertyType: 'appartement', commune: 'Gombe' } },
  { query: 'maison à louer ngaliema', lang: 'fr', facet: { purpose: 'rent', propertyType: 'maison', commune: 'Ngaliema' } },
  { query: 'bureau à louer kinshasa', lang: 'fr', facet: { purpose: 'rent', propertyType: 'bureau' } },
  { query: 'location immobilier kinshasa', lang: 'fr', facet: { purpose: 'rent' } },
  { query: 'apartment for rent kinshasa', lang: 'en', facet: { purpose: 'rent', propertyType: 'appartement' } },
  { query: 'house for rent kinshasa', lang: 'en', facet: { purpose: 'rent', propertyType: 'maison' } },
  { query: 'house for sale kinshasa', lang: 'en', facet: { purpose: 'sale', propertyType: 'maison' } },
  { query: 'land for sale kinshasa', lang: 'en', facet: { purpose: 'sale', propertyType: 'terrain' } },
  { query: 'apartment for rent gombe', lang: 'en', facet: { purpose: 'rent', propertyType: 'appartement', commune: 'Gombe' } },
  { query: 'real estate kinshasa', lang: 'en', facet: {} },
];

const PURPOSE_TO_TRANSACTION = { rent: 'location', sale: 'vente' };

/** The French landing page for a facet ("/location/appartements/gombe"), or "/" with no purpose. */
export function pathForFacet({ purpose, propertyType = null, commune = null } = {}) {
  const transaction = PURPOSE_TO_TRANSACTION[purpose];
  if (!transaction) return '/';
  return seoPath({ transaction, propertyType, commune });
}

/** Kinshasa facet rows only — the landing pages without a city segment. */
function kinshasaFacets(facets) {
  return (facets || []).filter((row) => facetCity(row) === DEFAULT_CITY);
}

/**
 * Listings a facet's page shows. A type-less page sums the real categories
 * only (parcelle and commercial re-count listings already under one).
 */
export function countForFacet(facets, { purpose = null, propertyType = null, commune = null } = {}) {
  let total = 0;
  for (const row of kinshasaFacets(facets)) {
    if (purpose && row.purpose !== purpose) continue;
    if (commune && row.commune !== commune) continue;
    if (propertyType ? row.propertyType !== propertyType : OVERLAY_PROPERTY_TYPES.has(row.propertyType)) continue;
    total += row.count;
  }
  return total;
}

/**
 * Under this many listings a landing page is thin: Google rarely puts a page
 * with two cards on page one against a portal with hundreds.
 */
export const THIN_PAGE_MAX = 5;

/**
 * One row per Kinshasa commune: listings for rent and for sale, and the two
 * landing pages. A commune with none is a page Google is told not to index.
 */
export function communeCoverage(facets) {
  return SEO_COMMUNES.map((commune) => {
    const rent = countForFacet(facets, { purpose: 'rent', commune });
    const sale = countForFacet(facets, { purpose: 'sale', commune });
    return {
      commune,
      rent,
      sale,
      rentPath: pathForFacet({ purpose: 'rent', commune }),
      salePath: pathForFacet({ purpose: 'sale', commune }),
    };
  }).sort((a, b) => (b.rent + b.sale) - (a.rent + a.sale) || a.commune.localeCompare(b.commune, 'fr'));
}

/** Summary of the landing pages: how many are indexable, thin, or empty. */
export function coverageSummary(rows) {
  let indexable = 0;
  let thin = 0;
  let empty = 0;
  for (const row of rows) {
    for (const n of [row.rent, row.sale]) {
      if (n === 0) empty += 1;
      else {
        indexable += 1;
        if (n <= THIN_PAGE_MAX) thin += 1;
      }
    }
  }
  return { indexable, thin, empty };
}

// ── Matching Search Console queries to a target ────────────────────────────

const STOP_WORDS = new Set(['a', 'à', 'au', 'en', 'de', 'du', 'des', 'la', 'le', 'les', 'for', 'in', 'the', 'of', 'to', 'rdc', 'drc', 'congo']);

/**
 * Words that mean the same thing to the searcher. Plurals fold to the
 * singular; "louer" / "location" and "rent" / "rental" are one intent.
 */
const SYNONYMS = {
  appartements: 'appartement', appart: 'appartement', apparts: 'appartement', apartment: 'appartement', apartments: 'appartement', flat: 'appartement', flats: 'appartement',
  maisons: 'maison', house: 'maison', houses: 'maison', home: 'maison', homes: 'maison',
  terrains: 'terrain', land: 'terrain', plot: 'terrain', plots: 'terrain',
  parcelles: 'parcelle',
  bureaux: 'bureau', office: 'bureau', offices: 'bureau',
  location: 'louer', loue: 'louer', rent: 'louer', rental: 'louer', rentals: 'louer', renting: 'louer',
  vente: 'vendre', sale: 'vendre', buy: 'vendre', acheter: 'vendre', achat: 'vendre',
  immobiliere: 'immobilier', estate: 'immobilier', property: 'immobilier', properties: 'immobilier',
  kin: 'kinshasa',
};

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The meaningful words of a search, folded: "Apartments for rent in Kinshasa" → {appartement, louer, kinshasa}. */
export function queryTokens(text) {
  const tokens = new Set();
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (!raw || STOP_WORDS.has(raw) || raw === 'real') continue;
    tokens.add(SYNONYMS[raw] || raw);
  }
  return tokens;
}

/**
 * What Search Console says about a target: every query of ours that holds all
 * its words (in either language's spelling), summed, with the position
 * weighted by impressions — the figure Search Console itself shows for a
 * group of queries. Null when no query matches.
 *
 * @param {string} target
 * @param {Array<{keys: string[], clicks: number, impressions: number, position: number}>} rows
 */
export function matchTargetRows(target, rows) {
  const wanted = [...queryTokens(target)];
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  let queries = 0;
  for (const row of rows || []) {
    const have = queryTokens(row.keys?.[0]);
    if (!wanted.every((word) => have.has(word))) continue;
    queries += 1;
    clicks += Number(row.clicks) || 0;
    const shown = Number(row.impressions) || 0;
    impressions += shown;
    weighted += (Number(row.position) || 0) * shown;
  }
  if (!queries) return null;
  return { queries, clicks, impressions, position: impressions ? weighted / impressions : null };
}

/** Google's results page a position lands on (10 results a page). */
export function resultsPage(position) {
  if (!Number.isFinite(position) || position <= 0) return null;
  return Math.ceil(position / 10);
}

// ── Listing content ───────────────────────────────────────────────────────

/** A description shorter than this gives Google almost nothing to read. */
export const SHORT_DESCRIPTION_CHARS = 120;

/** Share of a total, rounded to a whole percent; 0 of 0 is 0. */
export function percentOf(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Every type slug the landing pages use, so the audit can list the type pages. */
export const SEO_TYPE_SLUGS = Object.keys(SEO_PROPERTY_TYPES);
