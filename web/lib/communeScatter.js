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

/**
 * Units of one building on the map, each its own price tag (2026-11-18,
 * owner: "split them", replacing the "3 unités · dès $650" pin).
 *
 * A developer's units are `exact`: they share the building's real point and
 * get no privacy jitter, so they would stack into one tag. Every group of
 * two or more exact markers on one spot (~22 m) is spread over a small disc
 * around it: radius 60 m × √units, 80–300 m, seeded per listing id, display
 * only. They are then `scattered` like commune listings (no ring on top).
 * An agent's units are not exact; the map's usual privacy jitter already
 * fans them apart, so they are left as they are.
 */
const SHARED_POINT_DEG = 0.0002;

export function scatterSharedBuildingPoints(markers) {
  const list = markers || [];
  const groups = new Map();
  for (const marker of list) {
    if (!marker?.exact || marker.scattered) continue;
    if (!Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) continue;
    const key = `${Math.round(marker.lat / SHARED_POINT_DEG)}:${Math.round(marker.lng / SHARED_POINT_DEG)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(marker);
  }
  const moved = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const center = { lat: group[0].lat, lng: group[0].lng };
    const radius = Math.min(300, Math.max(80, 60 * Math.sqrt(group.length)));
    for (const marker of group) {
      const point = scatterPoint(center, radius, `unit:${marker.id}`);
      moved.set(marker, { ...marker, lat: point.lat, lng: point.lng, scattered: true });
    }
  }
  return list.map((marker) => moved.get(marker) || marker);
}
