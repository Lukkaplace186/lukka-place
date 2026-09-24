import LANDMARK_POINTS from './data/landmark-points.json';

/**
 * Real coordinates for the gazetteer's landmarks ("St Luc", "UPN",
 * "Rond-Point Victoire"), so a search can be "près de UPN" and a listing can
 * say how far it is.
 *
 * Every point came from Google's Geocoding API through the engine's own
 * precision-checked geocoder (scripts/geocode-landmarks.js, run 2026-09-24)
 * and was kept only when it lay within 5 km of its commune's verified
 * centroid (web/scripts/build-landmark-points.mjs). 106 of 151 landmarks have
 * one; the rest simply have no point — the search then opens on the commune
 * and no distance is printed. Nothing here is typed by hand.
 */

/** Default radius (km) of a landmark search; the list's radius ladder widens it. */
export const NEAR_DEFAULT_RADIUS = '3';

/**
 * @param {string|null} commune
 * @param {string|null} label
 * @returns {{lat: number, lng: number}|null}
 */
export function landmarkPoint(commune, label) {
  if (!commune || !label) return null;
  return LANDMARK_POINTS[`${commune}|${label}`] || null;
}

/** Great-circle distance in km. */
export function kmBetween(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * How far a listing is from a point, in km — only from the listing's OWN
 * stored coordinates. A listing placed on its commune's centroid gets null:
 * "à 0,4 km de UPN" measured from a commune centre would be invented
 * precision.
 *
 * @param {{latitude?: any, longitude?: any, lat?: any, lng?: any, approximate?: boolean}} listing
 * @param {{lat: number, lng: number}|null} point
 */
export function listingDistanceKm(listing, point) {
  if (!point || !listing || listing.approximate) return null;
  const lat = Number.parseFloat(listing.latitude ?? listing.lat);
  const lng = Number.parseFloat(listing.longitude ?? listing.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return kmBetween({ lat, lng }, point);
}

/** "350 m" under a kilometre, "1,2 km" to 10 km, "14 km" beyond. French decimals. */
export function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
