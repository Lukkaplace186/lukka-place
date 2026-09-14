/**
 * lib/mapViewport.js
 *
 * Pure helpers for the /listings viewport map (components/ListingsMap.js) and
 * the endpoint behind it (app/api/listings/map/route.js). No Maps globals and
 * no database — the browser key cannot run on localhost (web/CLAUDE.md), so
 * everything that decides what the map asks for and where a marker sits is a
 * plain function over plain data, pinned by tests/unit/map-viewport.test.js.
 *
 * THE MODEL (Rightmove / Zillow)
 * ------------------------------
 * The list pane is paginated, 12 cards a page. The map is not: it shows every
 * listing matching the active filters inside the visible area, and asks again
 * whenever the visitor stops panning or zooming. Filters and area combine —
 * "2 chambres" still applies after panning out of Bandal — but the LOCATION
 * filters (commune, quartier, radius) are the one exception: on the map they
 * decide where the map first opens, and after that the viewport is the area.
 * Keeping `commune = Bandalungwa` as a hard constraint would make panning out
 * of Bandal load nothing, which is the behaviour this replaced.
 */

import { KINSHASA_COMMUNE_CENTROIDS, inferListingCommune } from './geocoding';

export const MAP_BOUNDS_PARAMS = ['sw_lat', 'sw_lng', 'ne_lat', 'ne_lng'];

/** Filters that say WHERE to look. On the map the viewport replaces them. */
export const LOCATION_FILTER_PARAMS = ['commune', 'quartier', 'radius'];

/**
 * Params that never change WHICH listings match: paging and sort belong to the
 * list pane, `view` to the layout, and the bounds are added per request.
 */
const NON_FILTER_PARAMS = new Set(['page', 'sort', 'view', 'extent', ...MAP_BOUNDS_PARAMS]);

/** How long the map must sit still before it asks for markers. */
export const FETCH_DEBOUNCE_MS = 350;

/**
 * Each request covers the viewport plus this much on every side, so a short
 * pan stays inside the area already fetched and needs no request at all.
 */
export const VIEWPORT_PAD_RATIO = 0.25;

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function readParam(searchParamsLike, key) {
  if (!searchParamsLike) return undefined;
  return typeof searchParamsLike.get === 'function'
    ? searchParamsLike.get(key) ?? undefined
    : firstValue(searchParamsLike[key]);
}

/**
 * The four bounds params → `{ south, west, north, east }`.
 *
 * `{ bounds: null }` when none are present (a caller may legitimately ask
 * without an area), `{ error }` when some are present but unusable — a
 * half-specified box is a client bug, and silently widening it to the whole
 * city would hide that.
 *
 * No antimeridian handling: a box with west > east is refused rather than
 * interpreted as wrapping. Nothing this product lists is anywhere near ±180°.
 */
export function parseBounds(searchParamsLike) {
  const raw = MAP_BOUNDS_PARAMS.map((key) => readParam(searchParamsLike, key));
  if (raw.every((value) => value === undefined || value === null || value === '')) return { bounds: null };

  const [south, west, north, east] = raw.map((value) => Number.parseFloat(value));
  if (![south, west, north, east].every(Number.isFinite)) {
    return { error: 'sw_lat, sw_lng, ne_lat and ne_lng must all be numbers' };
  }
  if (south < -90 || north > 90 || west < -180 || east > 180) {
    return { error: 'bounds out of range' };
  }
  if (south > north || west > east) {
    return { error: 'south-west corner must be below and left of north-east' };
  }
  return { bounds: { south, west, north, east } };
}

/** `{ south, west, north, east }` → the four query params, at ~10cm precision. */
export function boundsToQuery(bounds) {
  return {
    sw_lat: bounds.south.toFixed(6),
    sw_lng: bounds.west.toFixed(6),
    ne_lat: bounds.north.toFixed(6),
    ne_lng: bounds.east.toFixed(6),
  };
}

/** Grow a box by `ratio` of its own size on each side, clamped to the globe. */
export function padBounds(bounds, ratio = VIEWPORT_PAD_RATIO) {
  const latPad = (bounds.north - bounds.south) * ratio;
  const lngPad = (bounds.east - bounds.west) * ratio;
  return {
    south: Math.max(-90, bounds.south - latPad),
    north: Math.min(90, bounds.north + latPad),
    west: Math.max(-180, bounds.west - lngPad),
    east: Math.min(180, bounds.east + lngPad),
  };
}

export function boundsContain(bounds, { lat, lng }) {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

/** Is `inner` entirely inside `outer`? Used to skip a request a pan does not need. */
export function boundsWithin(inner, outer) {
  return Boolean(
    inner && outer
      && inner.south >= outer.south && inner.north <= outer.north
      && inner.west >= outer.west && inner.east <= outer.east,
  );
}

/**
 * The filter part of the current URL, as a canonical query string: sorted
 * keys, empty values dropped, paging/sort/view removed. Two URLs that would
 * return the same markers produce the same string, so it doubles as the
 * "did the filters actually change?" key.
 *
 * @param {URLSearchParams|Record<string,string|string[]>} params
 */
export function mapFilterQuery(params) {
  const entries = [];
  const push = (key, value) => {
    const v = firstValue(value);
    if (v === undefined || v === null || String(v).trim() === '' || NON_FILTER_PARAMS.has(key)) return;
    entries.push([key, String(v)]);
  };

  if (params && typeof params.forEach === 'function' && typeof params.get === 'function') {
    params.forEach((value, key) => push(key, value));
  } else {
    for (const [key, value] of Object.entries(params || {})) push(key, value);
  }

  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(entries).toString();
}

/**
 * The place the map should open on for these filters, or null when the search
 * names none. A radius of 'citywide' is an explicit "not this commune" and
 * names no place either.
 */
export function locationTarget(params) {
  const commune = readParam(params, 'commune') || null;
  const quartier = readParam(params, 'quartier') || null;
  if (!commune || readParam(params, 'radius') === 'citywide') return null;
  return { commune, quartier };
}

/** Geocoder queries for a target, most specific first. */
export function locationGeocodeQueries(target) {
  if (!target?.commune) return [];
  const queries = [];
  if (target.quartier) queries.push(`${target.quartier}, ${target.commune}, Kinshasa, RD Congo`);
  queries.push(`Commune de ${target.commune}, Kinshasa, RD Congo`);
  return queries;
}

/**
 * Where a listing's marker sits, from the row the map endpoint read.
 *
 *   - Stored coordinates (geocoded at publish time, or set by hand from
 *     /admin/listings/[id]) → that point, `approximate: false`.
 *   - None, but a known commune (its tag, or a commune named in its own
 *     address text) → that commune's verified centroid, `approximate: true`.
 *     The same fallback the map has always used; the UI says how many pins
 *     are placed this way.
 *   - Neither → null. The listing is counted as unlocated and gets no pin,
 *     never a made-up point.
 *
 * `lat`/`lng` arrive as numbers (the SQL casts them) or null.
 */
export function resolveMarkerPosition(row) {
  const lat = row?.lat === null || row?.lat === undefined ? NaN : Number(row.lat);
  const lng = row?.lng === null || row?.lng === undefined ? NaN : Number(row.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng, approximate: false };
  }

  const centroid = KINSHASA_COMMUNE_CENTROIDS[inferListingCommune(row)];
  if (centroid) return { lat: centroid.lat, lng: centroid.lng, approximate: true };

  return null;
}
