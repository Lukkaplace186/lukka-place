import { matchPercent } from './agentMatching';

/**
 * "92 % correspond à votre recherche" on listing cards, for a signed-in
 * customer with a saved search (2026-11-03). Client-safe and pure.
 *
 * Honest by construction:
 *  - The hard parts of a search are GATES, never scored: a listing for the
 *    other transaction, outside the searched communes, or of another type
 *    gets no badge at all rather than a low number.
 *  - The percentage is the same budget + bedrooms scoring agents see on
 *    customer requests (lib/agentMatching.js matchPercent). A search that
 *    states neither gives nothing to score, so no badge.
 *  - A type we cannot compare exactly (parcelle, commercial and alias
 *    groups) shows nothing rather than a guess.
 *  - Below MIN_SHOWN_PERCENT nothing is shown: "41 % correspond" is not a
 *    reason to look, it is noise on the card.
 *
 * With several saved searches the best match wins; the badge says "votre
 * recherche", not which one.
 */

export const MIN_SHOWN_PERCENT = 70;

const PURPOSE_BY_TRANSACTION = { location: 'rent', vente: 'sale' };

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const criteriaCache = new Map();

/** The parts of a saved query string this badge can use, or null. */
export function criteriaFromQuery(query) {
  if (typeof query !== 'string' || !query) return null;
  if (criteriaCache.has(query)) return criteriaCache.get(query);

  // The same param names lib/searchQuery.js reads — read directly here,
  // because that module pulls the map and gazetteer code into every card.
  const params = new URLSearchParams(query);
  const extra = (params.get('communes') || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 5);
  const communes = [params.get('commune'), ...extra].filter(Boolean).map(fold);
  const priceMin = Number.parseFloat(params.get('price_min'));
  const priceMax = Number.parseFloat(params.get('price_max'));
  const bedsMin = Number.parseInt(params.get('beds_min'), 10);
  const propertyType = params.get('property_type');
  const criteria = {
    purpose: PURPOSE_BY_TRANSACTION[params.get('transaction_type')] || null,
    communes,
    propertyType: propertyType ? fold(propertyType) : null,
    priceMin: Number.isFinite(priceMin) && priceMin > 0 ? priceMin : null,
    priceMax: Number.isFinite(priceMax) && priceMax > 0 ? priceMax : null,
    bedsMin: Number.isFinite(bedsMin) && bedsMin > 0 ? bedsMin : null,
  };
  if (criteriaCache.size > 50) criteriaCache.clear();
  criteriaCache.set(query, criteria);
  return criteria;
}

function bedsScore(beds, bedsMin) {
  if (bedsMin == null) return null;
  const n = Number(beds);
  if (!Number.isFinite(n)) return null;
  if (n >= bedsMin) return 1;
  return n === bedsMin - 1 ? 0.6 : 0.2;
}

/**
 * @param {Object} listing a public listing row (purpose, commune, category_name, price, beds)
 * @param {ReturnType<typeof criteriaFromQuery>} criteria
 * @returns {number|null} 0–100, or null when it must not be shown
 */
export function matchForCriteria(listing, criteria) {
  if (!listing || !criteria) return null;
  if (listing.listing_status === 'under_offer' || listing.listing_status === 'closed') return null;
  if (criteria.purpose && listing.purpose !== criteria.purpose) return null;
  if (criteria.communes.length > 0 && !criteria.communes.includes(fold(listing.commune))) return null;
  if (criteria.propertyType && fold(listing.category_name) !== criteria.propertyType) return null;

  // Budget through the agents' scoring; bedrooms as a minimum ("2 ch.+").
  const budget = matchPercent(listing, { price_min: criteria.priceMin, price_max: criteria.priceMax, bedrooms: null });
  const beds = bedsScore(listing.beds, criteria.bedsMin);
  const parts = [budget == null ? null : budget / 100, beds].filter((s) => s != null);
  if (parts.length === 0) return null;
  return Math.round((parts.reduce((sum, s) => sum + s, 0) / parts.length) * 100);
}

/** Best match over every saved search, or null below MIN_SHOWN_PERCENT. */
export function bestSavedSearchMatch(listing, queries) {
  let best = null;
  for (const query of queries || []) {
    const score = matchForCriteria(listing, criteriaFromQuery(query));
    if (score != null && (best == null || score > best)) best = score;
  }
  return best != null && best >= MIN_SHOWN_PERCENT ? best : null;
}
