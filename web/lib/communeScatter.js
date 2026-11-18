/**
 * Listings that only know their commune, scattered over it (2026-11-18,
 * owner decision, replacing the 2026-11-14 "89 biens · Limete" bubble).
 *
 * The owner: the bubble "takes away from the immersion"; every listing should
 * show its own price on the map, "messy but very polished". So a listing with
 * no stored point (lib/mapViewport.js resolveMarkerPosition, `approximate:
 * true`, drawn on its commune's centre) gets a spot drawn uniformly over a
 * disc around that centre instead of a place on a ring (the 2026-11-14
 * complaint: rings of prices around each commune).
 *
 * - The spot is a DISPLAY position only, never stored or sent anywhere, and
 *   seeded by the listing's id, so a pin does not move between refetches.
 * - The disc stays roughly inside the commune: its radius is a share of the
 *   distance to the nearest other commune centre, clamped to
 *   SCATTER_MIN_METERS..SCATTER_MAX_METERS. It never depends on how many
 *   listings the viewport loaded, or pins would move while panning.
 * - Uniform over the disc (radius ∝ √u), so the centre is not crowded and
 *   no ring forms.
 * - The listing page still says the location is approximate; nothing here
 *   changes that.
 *
 * Pure: tests/unit/commune-scatter.test.js.
 */
import { COMMUNE_CENTROIDS, inferListingCommune } from './geocoding';

const METERS_PER_DEG_LAT = 111_320;
export const SCATTER_MIN_METERS = 400;
export const SCATTER_MAX_METERS = 1800;
/** Share of the gap to the nearest other commune centre (half would touch it). */
const NEIGHBOUR_SHARE = 0.45;

function distanceMeters(a, b) {
  const dLat = (a.lat - b.lat) * METERS_PER_DEG_LAT;
  const dLng = (a.lng - b.lng) * METERS_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

const nearestCache = new Map();
/** Distance from a commune's centre to the nearest other commune centre (m). */
function nearestNeighbourMeters(commune) {
  if (nearestCache.has(commune)) return nearestCache.get(commune);
  const own = COMMUNE_CENTROIDS[commune];
  let best = Infinity;
  for (const [other, point] of Object.entries(COMMUNE_CENTROIDS)) {
    if (other === commune || !point) continue;
    const d = distanceMeters(own, point);
    // Two names for one place (aliases sharing a centre) are not a neighbour.
    if (d > 50 && d < best) best = d;
  }
  nearestCache.set(commune, best);
  return best;
}

/** The disc's radius around `commune`'s centre. */
export function scatterRadiusMeters(commune) {
  const neighbour = nearestNeighbourMeters(commune) * NEIGHBOUR_SHARE;
  return Math.min(SCATTER_MAX_METERS, Math.max(SCATTER_MIN_METERS, neighbour));
}

/** mulberry32 seeded by a djb2 hash of the id: stable per listing. */
function randomFor(id) {
  let h = 5381;
  const s = `scatter:${id}`;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point uniformly inside the disc of `radius` metres around `center`. */
export function scatterPoint(center, radius, id) {
  const rand = randomFor(id);
  const r = radius * Math.sqrt(rand());
  const angle = rand() * 2 * Math.PI;
  const lat = center.lat + (r * Math.cos(angle)) / METERS_PER_DEG_LAT;
  const lng = center.lng + (r * Math.sin(angle)) / (METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180));
  return { lat, lng };
}

/**
 * Markers with every commune-centre listing moved to its scattered spot and
 * flagged `scattered: true` (the map then adds no ring and no jitter). Located
 * markers, and approximate ones whose commune has no centre, are returned
 * as they are. Order is kept.
 */
export function scatterCommuneListings(markers) {
  return (markers || []).map((marker) => {
    if (!marker?.approximate) return marker;
    const commune = marker.commune || inferListingCommune(marker);
    if (!commune || !COMMUNE_CENTROIDS[commune]) return marker;
    const radius = scatterRadiusMeters(commune);
    const point = scatterPoint(COMMUNE_CENTROIDS[commune], radius, marker.id);
    return { ...marker, lat: point.lat, lng: point.lng, scattered: true };
  });
}
