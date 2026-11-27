/**
 * The detail page's map (components/ListingPinMap.js): only the approximate
 * zone, a pale circle around the listing's jittered point (2026-10-23, owner's
 * choice). A navy point with a type symbol, then an irregular zone with a
 * white type badge, came before it; both are gone.
 *
 * A comparison map (this listing big, similar listings nearby small) was
 * tried on 2026-09-28 and reverted the same day on product direction: the
 * detail page shows this one property, cleanly.
 */

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Where this listing's pin goes, from its STORED coordinates only, or null.
 * A listing with none keeps the geocoding map (PropertyMap), which can still
 * find its street from the address.
 */
export function storedPosition(listing) {
  const lat = numberOrNull(listing?.latitude);
  const lng = numberOrNull(listing?.longitude);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  // The range check resolveMarkerPosition (lib/mapViewport.js) applies to real
  // coordinates; its commune-centroid fallback is "approximate", which this
  // function always refused. Inlined on 2026-11-21 so the listing page's
  // JavaScript no longer carries mapViewport + geocoding + cities (~20 KB raw)
  // just to read two numbers; tests/unit/listing-pin.test.js pins the result.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, approximate: false };
}

/**
 * Radius of the pale "approximate zone" circle, in metres. Wider than the
 * privacy jitter (lib/geocoding.js, at most 400 m), so the listing's real
 * spot is always inside the circle drawn around its jittered point.
 */
export const PRIVACY_RADIUS_M = 500;
