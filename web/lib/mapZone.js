// A zone drawn by hand on the listings map (2026-11-13, the owner's app
// design): "show me homes inside this shape". Pure and client-safe, shared by
// the map (drawing, the URL), the search-params parser and the listings read,
// so "inside the zone" has one definition. Unit-tested.
//
// The zone lives in the URL as `zone=lat,lng;lat,lng;…` (5 decimals, about a
// metre), next to the map's own box (sw_lat…), which is set to the zone's
// bounding box: the list beside the map already knows how to show "the
// listings in this area", and the shape then narrows that area.

/** Until the drawing has been checked on real phones, the pencil shows only
 *  where `localStorage.lp_zone === '1'` (components/MapZoneDraw.js). */
export const ZONE_DRAW_PUBLIC = false;

export const ZONE_PARAM = 'zone';
/** A finger's path is thinned to at most this many corners. */
export const MAX_ZONE_POINTS = 24;
const MIN_ZONE_POINTS = 3;

const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * `zone=` → [{ lat, lng }] or null. Anything malformed, too short or too long
 * is no zone at all (never a guessed or widened one): the search then simply
 * runs without it.
 */
export function parseZone(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const points = [];
  for (const pair of raw.split(';')) {
    const [lat, lng, extra] = pair.split(',');
    if (extra !== undefined) return null;
    const point = { lat: Number.parseFloat(lat), lng: Number.parseFloat(lng) };
    if (!valid(point)) return null;
    points.push(point);
  }
  if (points.length < MIN_ZONE_POINTS || points.length > MAX_ZONE_POINTS) return null;
  return points;
}

export function zoneToParam(points) {
  return points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
}

/** The box around the zone, in the map's `{ south, west, north, east }` shape. */
export function zoneBounds(points) {
  if (!Array.isArray(points) || !points.length) return null;
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { south, west, north, east };
}

/** Ray casting. The zone closes itself (last corner back to the first). */
export function pointInZone(points, point) {
  if (!Array.isArray(points) || points.length < MIN_ZONE_POINTS || !valid(point)) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Douglas–Peucker on { x, y } points.
function thin(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first];
    const b = points[last];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = Math.abs(dy * points[i].x - dx * points[i].y + b.x * a.y - b.y * a.x) / length;
      if (distance > worst) {
        worst = distance;
        index = i;
      }
    }
    if (index !== -1 && worst > tolerance) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * A finger's path on the screen ([{ x, y }] in pixels) thinned to at most
 * `max` corners, or null when it is not a shape: fewer than three corners, or
 * smaller than `minSize` pixels across (a tap, a slip).
 */
export function simplifyScreenPath(path, { max = MAX_ZONE_POINTS, minSize = 28 } = {}) {
  const points = (Array.isArray(path) ? path : []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (points.length < MIN_ZONE_POINTS) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) < minSize || Math.max(...ys) - Math.min(...ys) < minSize) return null;
  let tolerance = 2;
  let out = thin(points, tolerance);
  while (out.length > max && tolerance < 200) {
    tolerance *= 1.5;
    out = thin(points, tolerance);
  }
  if (out.length > max) out = out.slice(0, max);
  // A closing stroke that came back to its start: drop the repeated corner.
  if (out.length > MIN_ZONE_POINTS && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < 6) out = out.slice(0, -1);
  return out.length >= MIN_ZONE_POINTS ? out : null;
}
