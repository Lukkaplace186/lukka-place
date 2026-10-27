/**
 * "Autour de moi" on /agents (lib/agentDirectoryRules.js re-exports it).
 * Its own module with no imports, because it runs in the browser: the
 * visitor's position never leaves the phone, only commune names do.
 */

/**
 * "Autour de moi": the nearest commune centre must be within this distance,
 * or the visitor is outside every city we cover.
 */
export const NEAR_ME_MAX_KM = 15;
/** Up to this many communes, the nearest first. */
export const NEAR_ME_MAX_COMMUNES = 3;

/** Great-circle distance in km (same formula as lib/mapViewport.js distanceKm). */
function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * "Autour de moi": the communes whose centre is nearest `point` — the
 * nearest one, plus up to two more no further than 1.6× its distance (or
 * 2 km), so a visitor on a commune boundary sees both sides. Null when the
 * nearest centre is over NEAR_ME_MAX_KM away (outside every covered city).
 * Runs in the browser: the position never leaves the phone, only the
 * commune names do.
 *
 * @param {{lat: number, lng: number}} point
 * @param {Array<{key: string, lat: number, lng: number}>} centres
 * @returns {string[]|null}
 */
export function nearestCommunes(point, centres) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const ranked = centres
    .map((c) => ({ key: c.key, km: distanceKm(point, c) }))
    .sort((a, b) => a.km - b.km);
  if (ranked.length === 0 || ranked[0].km > NEAR_ME_MAX_KM) return null;
  const reach = Math.max(2, ranked[0].km * 1.6);
  return ranked.filter((c, i) => i === 0 || c.km <= reach).slice(0, NEAR_ME_MAX_COMMUNES).map((c) => c.key);
}
