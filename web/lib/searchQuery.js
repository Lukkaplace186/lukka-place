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
    // 'citywide' honestly widens past the selected commune (see
    // FilterBar.js's "Rayon" toggle) — there is no real commune-adjacency
    // or coordinate data to back a "+1 quartier proche" style radius (see
    // web/CLAUDE.md's "No fabricated data" rule and kinshasa_locations.json,
    // which only carries commune -> quartier names, no geometry), so this
    // is a real broaden-to-Kinshasa toggle rather than a distance claim.
    radius: get('radius'),
    reference: get('reference'),
    priceMin: get('price_min'),
    priceMax: get('price_max'),
    bedsMin: get('beds_min'),
    bathMin: get('bath_min'),
    depositMax: get('deposit_max'),
    // Comma-separated checkbox keys (lib/constants.js's AMENITY_GROUPS,
    // FiltersDrawer.js) -> an array, or [] rather than [''] for an absent/
    // empty param — '' would otherwise become a single bogus key that
    // lib/listings.js's buildFilters just silently ignores (VALID_AMENITY_
    // KEYS won't contain it), but returning [] here is more honest about
    // there being no active amenity filters at all.
    amenities: get('amenities') ? get('amenities').split(',').filter(Boolean) : [],
    search: get('q'),
  };
}
