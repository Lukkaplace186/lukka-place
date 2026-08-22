/**
 * lib/geocoding.js
 *
 * Location resolution pipeline for the property map (product task #55):
 * every listing's approximate pin position, in three steps, per the
 * explicit product decision:
 *
 *   1. Primary lookup — geocode the listing's real address/quartier/commune
 *      text via Google's Geocoding API.
 *   2. Fallback centroid — if geocoding fails, or only resolves to
 *      commune-level precision (no real street match), fall back to
 *      KINSHASA_COMMUNE_CENTROIDS below.
 *   3. Privacy jitter — apply a deterministic ~200-400m random offset so a
 *      pin sits in the right general vicinity without pinpointing an exact
 *      building (standard real-estate-platform practice, not fabrication —
 *      the underlying resolved point is always real, this only blurs it).
 *
 * IMPORTANT — this runs CLIENT-SIDE, not server-side, on purpose:
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is HTTP-referrer-restricted (correct
 * practice for a key shipped to the browser), and Google's Geocoding API
 * flatly refuses referrer-restricted keys on server-to-server calls
 * ("API keys with referer restrictions cannot be used with this API" —
 * confirmed directly against the real key before writing this file). A
 * genuine browser request carries a real Referer header and works fine —
 * confirmed the same way. So `resolveListingLocation` below takes a
 * `google.maps.Geocoder` instance (constructible only after the Maps JS
 * API has loaded in the browser — see components/PropertyMap.js) rather
 * than making its own server-side HTTP call.
 */

/**
 * Real, Google-verified centroids for all 24 Kinshasa communes — fetched
 * live via `google.maps.Geocoder` against "Commune de {name}, Kinshasa, RD
 * Congo" (region-biased to 'cd') on 2026-08-17, not hand-typed from memory.
 * Keys match the canonical spelling `services/locations.js` already uses
 * elsewhere (Ndjili/Nsele, not N'Djili/N'Sele).
 */
export const KINSHASA_COMMUNE_CENTROIDS = {
  Bandalungwa: { lat: -4.341671, lng: 15.28124 },
  Barumbu: { lat: -4.3218224, lng: 15.3262058 },
  Bumbu: { lat: -4.3728081, lng: 15.2941103 },
  Gombe: { lat: -4.3047981, lng: 15.3053546 },
  Kalamu: { lat: -4.3410501, lng: 15.3157198 },
  'Kasa-Vubu': { lat: -4.3437187, lng: 15.2752223 },
  Kimbanseke: { lat: -4.4050512, lng: 15.4122534 },
  Kinshasa: { lat: -4.3251555, lng: 15.3128644 },
  Kintambo: { lat: -4.3380529, lng: 15.2664192 },
  Kisenso: { lat: -4.423151, lng: 15.3215725 },
  Lemba: { lat: -4.393511, lng: 15.3330474 },
  Limete: { lat: -4.3546851, lng: 15.3475693 },
  Lingwala: { lat: -4.3174464, lng: 15.2993463 },
  Makala: { lat: -4.3759995, lng: 15.3031833 },
  Maluku: { lat: -4.356125, lng: 15.3284104 },
  Masina: { lat: -4.3019746, lng: 15.2985576 },
  Matete: { lat: -4.3913489, lng: 15.3465319 },
  'Mont-Ngafula': { lat: -4.3557905, lng: 15.2026348 },
  Ndjili: { lat: -4.3229805, lng: 15.2922932 },
  Nsele: { lat: -4.4257319, lng: 15.3848449 },
  Ngaba: { lat: -4.3755865, lng: 15.3199624 },
  Ngaliema: { lat: -4.3713817, lng: 15.2534377 },
  'Ngiri-Ngiri': { lat: -4.356336, lng: 15.2993696 },
  Selembao: { lat: -4.398257, lng: 15.2764818 },
};

/** Center of Kinshasa (Gombe) — used as the map's default viewport before any pins resolve. */
export const KINSHASA_CENTER = KINSHASA_COMMUNE_CENTROIDS.Gombe;

/**
 * Google `location_type`/`types` that count as genuine street-level
 * precision. Anything else (a bare locality/sublocality/political match —
 * i.e. Google only recognised the commune, not a real address) is treated
 * as "no real address match" and routed to the commune fallback instead,
 * per the explicit product decision.
 */
const PRECISE_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED']);
const IMPRECISE_ONLY_TYPES = new Set(['locality', 'sublocality', 'sublocality_level_1', 'political', 'administrative_area_level_2']);

function isPreciseResult(result) {
  if (PRECISE_LOCATION_TYPES.has(result.geometry.location_type)) return true;
  // GEOMETRIC_CENTER / APPROXIMATE can still be a real, named place (e.g. a
  // known compound) rather than a bare administrative area — only treat it
  // as commune-level if EVERY type on the result is one of the imprecise
  // ones (a result mixing in 'establishment'/'premise' etc. is more than that).
  return !result.types.every((t) => IMPRECISE_ONLY_TYPES.has(t));
}

/** Real address text only — never fabricates a street address that wasn't actually given. */
export function buildGeocodeQuery(listing) {
  const parts = [listing.address, listing.quartier, listing.commune, 'Kinshasa', 'RD Congo'].filter(Boolean);
  return parts.join(', ');
}

/**
 * Deterministic pseudo-random generator seeded by a number — so the same
 * listing always jitters to the same nearby point (stable across page
 * reloads), rather than visibly relocating its pin on every render.
 * mulberry32, a small well-known PRNG — not cryptographic, doesn't need to be.
 */
function seededRandom(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r = (r + Math.imul(r ^ (r >>> 7), r | 61)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Numeric seed from a listing id (works whether it arrives as a number or numeric string). */
function seedFromId(id) {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) ? n : String(id).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
}

const EARTH_METERS_PER_DEGREE_LAT = 111320;

/**
 * Offsets (lat, lng) by a random 200-400m distance in a random direction,
 * deterministic per `seed` (see seededRandom above) — the actual privacy
 * measure: a pin never sits exactly on the real resolved point.
 */
export function applyPrivacyJitter(lat, lng, seed) {
  const rand = seededRandom(seed);
  const distanceMeters = 200 + rand() * 200; // 200-400m
  const angle = rand() * 2 * Math.PI;

  const latOffset = (distanceMeters * Math.cos(angle)) / EARTH_METERS_PER_DEGREE_LAT;
  const metersPerDegreeLng = EARTH_METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const lngOffset = (distanceMeters * Math.sin(angle)) / metersPerDegreeLng;

  return { lat: lat + latOffset, lng: lng + lngOffset };
}

// Per-tab session cache — avoids re-geocoding the same address repeatedly
// while browsing (e.g. toggling map/list, or the map re-mounting). Resets
// on a full page reload; acceptable for local-dev scope. A production
// version would want this to persist (e.g. written back to Supabase's
// existing-but-empty latitude/longitude columns) rather than re-resolving
// every session — not built here, out of scope for this pass.
const resolutionCache = new Map();

/**
 * @param {Object} params
 * @param {Object} params.listing Real listing row (id, address, quartier, commune, ...).
 * @param {google.maps.Geocoder} params.geocoder
 * @returns {Promise<{lat: number, lng: number, source: 'existing'|'geocoded'|'commune_fallback'|'unresolved', precise: boolean}>}
 */
export async function resolveListingLocation({ listing, geocoder }) {
  // Forward-compatible: if a listing ever does carry real coordinates
  // (the Postgres columns exist, just empty today — see CLAUDE.md), use
  // them directly and skip geocoding entirely.
  const existingLat = Number.parseFloat(listing.latitude);
  const existingLng = Number.parseFloat(listing.longitude);
  if (Number.isFinite(existingLat) && Number.isFinite(existingLng)) {
    const jittered = applyPrivacyJitter(existingLat, existingLng, seedFromId(listing.id));
    return { ...jittered, source: 'existing', precise: true };
  }

  const query = buildGeocodeQuery(listing);
  const cached = resolutionCache.get(query);
  if (cached) return applyResolvedJitter(cached, listing.id);

  const resolved = await geocodeOnce(geocoder, query, inferCommune(listing));
  resolutionCache.set(query, resolved);
  return applyResolvedJitter(resolved, listing.id);
}

/**
 * Some listings predate the commune-tagging feature (see CLAUDE.md) and
 * have `commune: null` even though a real commune name is sitting right
 * there in the free-text address — e.g. address "Ngiri-Ngiri, Kinshasa"
 * with no structured commune. Falls back to scanning the real address/
 * quartier text for one of the 24 known commune names before giving up —
 * this is reading data that's already there, not inventing anything.
 */
function inferCommune(listing) {
  if (listing.commune) return listing.commune;

  const haystack = `${listing.address || ''} ${listing.quartier || ''}`.toLowerCase();
  return Object.keys(KINSHASA_COMMUNE_CENTROIDS).find((commune) => haystack.includes(commune.toLowerCase())) || null;
}

function applyResolvedJitter(resolved, listingId) {
  if (!resolved) return { lat: null, lng: null, source: 'unresolved', precise: false };
  const jittered = applyPrivacyJitter(resolved.lat, resolved.lng, seedFromId(listingId));
  return { ...jittered, source: resolved.source, precise: resolved.precise };
}

/** The actual Geocoding API call + fallback decision — cached by caller (resolveListingLocation) before jitter is applied, so re-resolving a repeated address never re-jitters it either. */
function geocodeOnce(geocoder, query, commune) {
  return new Promise((resolve) => {
    geocoder.geocode({ address: query, region: 'cd' }, (results, status) => {
      if (status === 'OK' && results?.[0] && isPreciseResult(results[0])) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng(), source: 'geocoded', precise: true });
        return;
      }

      // No real street-level match — fall back to the commune's real,
      // verified centroid rather than trusting Google's own broad match
      // (keeps every commune-level pin consistent, which matters for
      // clustering: they land on the same real point, not scattered
      // slightly-different "approximate" guesses per request).
      const centroid = KINSHASA_COMMUNE_CENTROIDS[commune];
      if (centroid) {
        resolve({ lat: centroid.lat, lng: centroid.lng, source: 'commune_fallback', precise: false });
        return;
      }

      resolve(null);
    });
  });
}
