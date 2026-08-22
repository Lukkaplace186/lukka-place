/**
 * Maps /listings-style query params onto lib/listings.js's `getListings()`
 * options shape. Extracted out of app/(site)/listings/page.js so
 * /compte/alertes can re-run a saved search's exact criteria through the
 * same real query function without a second copy of this mapping.
 *
 * @param {URLSearchParams|Record<string,string>} searchParamsLike
 */
export function parseListingsSearchParams(searchParamsLike) {
  const get = (key) =>
    typeof searchParamsLike.get === 'function' ? searchParamsLike.get(key) : searchParamsLike[key];

  return {
    transactionType: get('transaction_type'),
    propertyType: get('property_type'),
    parcelleSubtype: get('parcelle_subtype'),
    commune: get('commune'),
    quartier: get('quartier'),
    priceMin: get('price_min'),
    priceMax: get('price_max'),
    bedsMin: get('beds_min'),
    bathMin: get('bath_min'),
    areaMin: get('area_min'),
    search: get('q'),
  };
}
