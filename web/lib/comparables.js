import { resolveMarkerPosition } from './mapViewport';
import { kmBetween } from './landmarks';

/**
 * The listing detail page's comparison map (2026-09-28): this listing as one
 * big pin, and listings LIKE it nearby as small ones, so a visitor sees at a
 * glance whether 1 300 $ is the going rate for a 3-bedroom in Kintambo.
 *
 * "Like it" means the same thing a visitor comparing would mean:
 *   - the same purpose (a rent is never compared with a sale price);
 *   - the same type (Appartement with Appartement; a parcelle with the same
 *     parcelle sub-type — a Villa is not a Maison Type Locataire);
 *   - the same bedroom count, exactly, when the listing states one;
 *   - within COMPARABLES_RADIUS_KM, nearest first, at most COMPARABLES_MAX.
 *
 * Positions are the /listings map's own (stored coordinates, else the
 * commune centroid, flagged approximate), so every pin sits where it sits on
 * /listings, privacy jitter included.
 */

export const COMPARABLES_RADIUS_KM = 3;
export const COMPARABLES_MAX = 8;

const PURPOSE_TO_TRANSACTION = { rent: 'location', sale: 'vente' };

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** The bedroom count to match, or null when the listing states none (a terrain). */
export function comparableBeds(listing) {
  const beds = Number.parseInt(listing?.beds, 10);
  return Number.isFinite(beds) && beds > 0 ? beds : null;
}

/**
 * Where this listing's own pin goes, from its STORED coordinates only, or
 * null. A listing with none keeps the detail page's geocoding map
 * (PropertyMap), which can still find its street; the comparison needs a
 * point it can measure from.
 */
export function storedPosition(listing) {
  const lat = numberOrNull(listing?.latitude);
  const lng = numberOrNull(listing?.longitude);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  const position = resolveMarkerPosition({ lat, lng });
  return position && !position.approximate ? position : null;
}

/** A box COMPARABLES_RADIUS_KM around a point, as the map endpoint's sw/ne params. */
export function boxAround(center, km = COMPARABLES_RADIUS_KM) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return {
    sw_lat: (center.lat - dLat).toFixed(5),
    sw_lng: (center.lng - dLng).toFixed(5),
    ne_lat: (center.lat + dLat).toFixed(5),
    ne_lng: (center.lng + dLng).toFixed(5),
  };
}

/**
 * The /api/listings/map query for this listing's comparables, or null when
 * there is nothing sound to compare on (no purpose, no type).
 *
 * `beds_min` is the only bedroom filter the endpoint has; the exact match is
 * applied to its answer by pickComparables.
 */
export function comparablesQuery(listing, center) {
  const transaction = PURPOSE_TO_TRANSACTION[listing?.purpose];
  if (!transaction || !center) return null;
  const params = { transaction_type: transaction };
  if (listing.parcelle_subtype) {
    params.property_type = 'parcelle';
    params.parcelle_subtype = listing.parcelle_subtype;
  } else if (listing.category_name) {
    params.property_type = String(listing.category_name).toLowerCase();
  } else {
    return null;
  }
  const beds = comparableBeds(listing);
  if (beds) params.beds_min = String(beds);
  return new URLSearchParams({ ...params, ...boxAround(center) });
}

/**
 * The comparables to draw: never the listing itself, exact bedroom count,
 * inside the radius (the box's corners reach further), nearest first.
 */
export function pickComparables(markers, listing, center, { max = COMPARABLES_MAX, radiusKm = COMPARABLES_RADIUS_KM } = {}) {
  if (!Array.isArray(markers) || !center) return [];
  const beds = comparableBeds(listing);
  const selfId = String(listing?.id);
  return markers
    .filter((m) => String(m.id) !== selfId)
    .filter((m) => beds === null || Number(m.beds) === beds)
    .filter((m) => Number(m.price) > 0)
    .map((m) => ({ marker: m, km: kmBetween(center, { lat: Number(m.lat), lng: Number(m.lng) }) }))
    .filter(({ km }) => Number.isFinite(km) && km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, max)
    .map(({ marker }) => marker);
}
