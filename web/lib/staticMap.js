import { MAP_STYLES } from './mapStyle';

/**
 * The detail page's map as ONE image (Google Static Maps API), 2026-11-06
 * speed pass. The interactive map (components/ListingPinMap.js) costs ~200 KB
 * of Maps JS fetched in four or five dependent round trips, then ~10 tiles —
 * several seconds on a Kinshasa 3G link (~450 ms RTT, ~0.5 Mbps measured).
 * The page only shows a pale zone around the listing, which an image says
 * just as well: one request, ~40-70 KB, cached by the browser.
 *
 * Same look as the interactive map: MAP_STYLES turned into `style=` params,
 * the same zoom and the same PRIVACY_RADIUS_M circle drawn as a filled path
 * around the same privacy-jittered point. Pure (no window, no key lookup), so
 * tests can pin it.
 */

export const STATIC_MAP_ENDPOINT = 'https://maps.googleapis.com/maps/api/staticmap';

/** Free-tier ceiling for each side, before `scale`. */
export const STATIC_MAP_MAX_SIDE = 640;

/** `#1e3a8a` + alpha byte → Static Maps' 0xRRGGBBAA. */
function hexColor(hex, alpha) {
  const rgb = String(hex).replace('#', '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(rgb)) return null;
  if (alpha === undefined) return `0x${rgb}`;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
  return `0x${rgb}${a}`;
}

/** One classic `styles` entry → one `style=` value, or null when it says nothing. */
export function styleParam(entry) {
  const parts = [];
  if (entry.featureType) parts.push(`feature:${entry.featureType}`);
  if (entry.elementType) parts.push(`element:${entry.elementType}`);
  for (const styler of entry.stylers || []) {
    for (const [key, value] of Object.entries(styler)) {
      if (key === 'color') {
        const c = hexColor(value);
        if (c) parts.push(`color:${c}`);
      } else {
        parts.push(`${key}:${value}`);
      }
    }
  }
  return parts.some((p) => !p.startsWith('feature:') && !p.startsWith('element:')) ? parts.join('|') : null;
}

/**
 * A circle of `radiusM` metres around `center`, as `points` lat/lng pairs
 * (closed: the last equals the first). Equirectangular, which is exact
 * enough at 500 m and 4° south.
 */
export function circlePoints(center, radiusM, points = 32) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const out = [];
  for (let i = 0; i <= points; i += 1) {
    const a = (i % points) * ((2 * Math.PI) / points);
    out.push({
      lat: Number((center.lat + dLat * Math.sin(a)).toFixed(5)),
      lng: Number((center.lng + dLng * Math.cos(a)).toFixed(5)),
    });
  }
  return out;
}

/**
 * The image URL. `width`/`height` are CSS pixels of the frame; they are
 * scaled down together to fit STATIC_MAP_MAX_SIDE and fetched at `scale` 2,
 * so a phone's sharp screen gets a sharp map.
 */
export function staticMapUrl({
  center, zoom, radiusM, width, height, apiKey, language = 'fr', scale = 2,
}) {
  if (!apiKey || !center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  const ratio = Math.min(1, STATIC_MAP_MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const params = [
    `center=${center.lat.toFixed(5)},${center.lng.toFixed(5)}`,
    `zoom=${zoom}`,
    `size=${w}x${h}`,
    `scale=${scale}`,
    `language=${language}`,
    'format=png',
  ];
  for (const entry of MAP_STYLES) {
    const s = styleParam(entry);
    if (s) params.push(`style=${encodeURIComponent(s)}`);
  }
  if (radiusM) {
    // Same navy, same opacities as ListingPinMap's google.maps.Circle.
    const path = [
      `color:${hexColor('#1e3a8a', 0.35)}`,
      'weight:1',
      `fillcolor:${hexColor('#1e3a8a', 0.1)}`,
      ...circlePoints(center, radiusM).map((p) => `${p.lat},${p.lng}`),
    ].join('|');
    params.push(`path=${encodeURIComponent(path)}`);
  }
  params.push(`key=${encodeURIComponent(apiKey)}`);
  return `${STATIC_MAP_ENDPOINT}?${params.join('&')}`;
}

/**
 * The listing detail page's static map URL, or null (no stored coordinates,
 * no key, or NEXT_PUBLIC_STATIC_LISTING_MAP not 'on'). Server only in
 * practice: it pulls lib/geocoding.js (and its quartier data) for the
 * privacy jitter, which the browser should not download for one URL.
 *
 * Off until the Static Maps API is enabled on the browser key's Google Cloud
 * project — it answered 403 "This API is not activated" on 2026-11-06. If the
 * key has an API restriction list, Static Maps must be on it too. Then set
 * NEXT_PUBLIC_STATIC_LISTING_MAP=on and rebuild.
 */
export async function listingStaticMapSrc(listing, locale, env = process.env) {
  if (env.NEXT_PUBLIC_STATIC_LISTING_MAP !== 'on') return null;
  const [{ storedPosition, PRIVACY_RADIUS_M }, { placeResolvedListings }] = await Promise.all([
    import('./listingPin'),
    import('./geocoding'),
  ]);
  const position = storedPosition(listing);
  if (!position) return null;
  // The same privacy-jittered point ListingPinMap centres its circle on.
  const placed = placeResolvedListings([
    { id: listing.id, base: { lat: position.lat, lng: position.lng, source: 'existing', precise: true } },
  ]).get(listing.id) || position;
  return staticMapUrl({
    center: { lat: placed.lat, lng: placed.lng },
    zoom: STATIC_LISTING_MAP_ZOOM,
    radiusM: PRIVACY_RADIUS_M,
    width: 640,
    height: 416,
    apiKey: env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    language: locale === 'en' ? 'en' : 'fr',
  });
}

/** ListingPinMap's LISTING_MAP_ZOOM (that module is a client component). */
export const STATIC_LISTING_MAP_ZOOM = 14;
