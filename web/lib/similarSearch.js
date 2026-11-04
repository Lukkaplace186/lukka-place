/**
 * What "similar to this listing" means, in one place, for the two things
 * that use it: the "Biens similaires" rail (lib/listings.js
 * getSimilarListings and the listing page's fallbacks) and the
 * "M'alerter des biens similaires" button (components/SimilarAlertButton.js).
 *
 * Same rent / sale, same rent period, and a price within a band around the
 * listing's own. Before this the rail was ranked by text similarity alone,
 * so an $800 / month flat showed a $1,000,000 building for sale beside it
 * (listing 653, 2026-11-04).
 *
 * Pure: no database, no React.
 */

/** The rail's price band: 70 % to 130 % of the listing's price. */
export const SIMILAR_PRICE_LOW = 0.7;
export const SIMILAR_PRICE_HIGH = 1.3;

/** The alert's band is the same; kept as one pair so the two never differ. */
export function similarPriceRange(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return null;
  return {
    min: Math.floor(value * SIMILAR_PRICE_LOW),
    max: Math.ceil(value * SIMILAR_PRICE_HIGH),
  };
}

const PURPOSE_TO_TRANSACTION = { rent: 'location', sale: 'vente' };

/** /listings' transaction_type for a listing's purpose ('rent' → 'location'), else null. */
export function transactionTypeOfPurpose(purpose) {
  return PURPOSE_TO_TRANSACTION[purpose] || null;
}

/**
 * The /listings query an alert for listings like this one saves.
 *
 * Only criteria the listing actually states: no commune → no commune, no
 * bedrooms → no bedroom floor. A rent quoted per day / week / year gets no
 * price band (the alert sweep compares monthly figures) but keeps the lease
 * term for a short stay. Returns null when there is nothing to search on
 * beyond "everything", since an alert on the whole catalogue is not an alert
 * for similar listings.
 *
 * @param {{purpose?: string, commune?: string, city_name?: string, category_name?: string,
 *   beds?: number|string, price?: number|string, price_period?: string}} listing
 *   a row from lib/listings.js (SELECT_FIELDS).
 * @returns {string|null} a query string without the leading "?"
 */
export function similarAlertQuery(listing) {
  if (!listing) return null;
  const params = new URLSearchParams();
  const transaction = PURPOSE_TO_TRANSACTION[listing.purpose];
  if (!transaction) return null;
  params.set('transaction_type', transaction);

  const city = String(listing.city_name || '').trim();
  if (city && city.toLowerCase() !== 'kinshasa') params.set('ville', city);

  const commune = String(listing.commune || '').trim();
  if (commune) params.set('commune', commune);

  // /listings' property_type is the lowercased category name (FilterBar's
  // facets, lib/listings.js buildFilters).
  const type = String(listing.category_name || '').trim().toLowerCase();
  if (type) params.set('property_type', type);

  const beds = Number.parseInt(listing.beds, 10);
  if (Number.isFinite(beds) && beds > 0) params.set('beds_min', String(beds));

  const period = String(listing.price_period || '').trim();
  const shortStay = period === 'jour' || period === 'semaine';
  const monthlyOrSale = listing.purpose === 'sale' || !period || period === 'mois';
  if (shortStay) params.set('lease_term', 'short');
  if (monthlyOrSale) {
    const range = similarPriceRange(listing.price);
    if (range) {
      params.set('price_min', String(range.min));
      params.set('price_max', String(range.max));
    }
  }

  // transaction_type alone is the whole rent (or sale) catalogue.
  if ([...params.keys()].length <= 1) return null;
  return params.toString();
}
