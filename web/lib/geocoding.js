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

import { COLOCATION_EPSILON_DEG } from './mapPinSpread';

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

/**
 * A listing's `reference` is its OWN identifier ("Réf: LKP-2026-0091"), not a
 * place — CLAUDE.md is explicit that `reference` and `quartier` must never be
 * conflated, and nothing here does. But Kinshasa agents also routinely put a
 * landmark in that field ("Demiap", "Socimat"), and in a city where most
 * streets are unnamed a landmark is the single most useful token a geocoder
 * can be given.
 *
 * So a reference is treated as location text only when it reads as words: it
 * has to contain at least one real word — three or more letters, hyphens and
 * apostrophes allowed inside it, no digits. That is what separates the live
 * data ("Demiap", "Mimosas, Camp Docteur", "Birmanie Sur Macadam", "Petit
 * Boulevard, 2ᵉ Rue Industrielle" — all real, all currently on the site) from
 * an identifier ("LKP-2026-0091", "91", "A1", "REF2026"), which has no word in
 * it at all.
 *
 * Note it is the WORD that qualifies, not the absence of digits: "2ᵉ Rue
 * Industrielle" is a street and must survive. A code that somehow slipped
 * through costs at most one wasted geocode — the cascade below falls back to
 * the address-only query whenever a more specific one fails to land on a real
 * place, so a bad token can never move a pin.
 */
const LANDMARK_WORD = /^\p{L}[\p{L}'’-]*$/u;

export function isLandmarkReference(reference) {
  const value = String(reference ?? '').trim();
  if (value.length < 3) return false;

  return value
    .split(/[\s,]+/)
    .some((token) => LANDMARK_WORD.test(token) && (token.match(/\p{L}/gu)?.length ?? 0) >= 3);
}

/**
 * The ordered geocode queries for one listing, most specific first. Every
 * entry is built only from text the listing actually carries — this never
 * fabricates a street address that was not given.
 *
 *   1. address + landmark reference + quartier + commune   (street precision)
 *   2. address + quartier + commune                        (the original query)
 *   3. landmark reference + quartier + commune             (no usable address)
 *   4. quartier + commune                                  (neighbourhood)
 *
 * `resolveListingBase` walks these in order and stops at the first result
 * Google returns at real place precision, so the common case still costs one
 * call: query 1 is only followed by query 2 when query 1 found nothing better
 * than a commune outline. Duplicates collapse, so a listing with neither an
 * address nor a landmark produces exactly one query rather than four.
 *
 * Two listings in the same building also produce the SAME query text here
 * (same address, same landmark reference), which is what makes them resolve
 * to one identical base point — and therefore what lets
 * `placeResolvedListings` recognise them as co-located and fan them apart.
 */
export function buildGeocodeQueries(listing) {
  const commune = inferCommune(listing);
  const landmark = isLandmarkReference(listing?.reference) ? String(listing.reference).trim() : null;
  const tail = [listing?.quartier, commune, 'Kinshasa', 'RD Congo'];

  const candidates = [
    [listing?.address, landmark, ...tail],
    [listing?.address, ...tail],
    [landmark, ...tail],
    tail,
  ];

  const seen = new Set();
  const queries = [];
  for (const parts of candidates) {
    const query = parts.filter(Boolean).join(', ');
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
  }
  return queries;
}

/** The most specific query for a listing — one string, for callers that log or cache by it. */
export function buildGeocodeQuery(listing) {
  return buildGeocodeQueries(listing)[0] ?? '';
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

/** The privacy blur every pin carries: 200-400m from its real resolved point. */
const JITTER_MIN_METERS = 200;
const JITTER_SPAN_METERS = 200;

/**
 * Roughly how far apart two co-located pins should sit. Only used to widen
 * the ring when many listings share one point (every listing that falls back
 * to a commune centroid does), so a group of twenty does not fan onto a
 * circle too tight to tell them apart.
 */
const MIN_PIN_GAP_METERS = 150;

/**
 * Ceiling on that widening. A pin may drift within its own neighbourhood; it
 * may not drift into the next commune because its group happened to be large.
 */
const MAX_SPREAD_RADIUS_METERS = 900;

/**
 * Offsets (lat, lng) away from the real resolved point — the actual privacy
 * measure: a pin never sits exactly on the point it resolved to.
 *
 * Without a `slot` this is the original behaviour: a 200-400m hop in a
 * direction that depends only on `seed`, so a listing lands on the same
 * nearby point on every reload rather than visibly relocating.
 *
 * With a `slot` ({ index, count, rotation }) the DISTANCE is still seeded per
 * listing but the DIRECTION comes from the pin's place on a ring instead of
 * from its id. That is what makes co-location handling reliable rather than
 * lucky: N listings resolving to one identical point get N evenly separated
 * bearings by construction, where two independently seeded random angles
 * could perfectly well come out a degree apart. `rotation` turns the whole
 * ring by a per-group angle, so every stack is not identically oriented.
 */
export function applyPrivacyJitter(lat, lng, seed, slot = null) {
  const rand = seededRandom(seed);
  const count = Number.isFinite(slot?.count) && slot.count > 1 ? slot.count : 1;

  const minRadius =
    count > 1
      ? Math.min(
          Math.max(JITTER_MIN_METERS, (MIN_PIN_GAP_METERS * count) / (2 * Math.PI)),
          MAX_SPREAD_RADIUS_METERS,
        )
      : JITTER_MIN_METERS;

  // rand() is consumed for the distance first in BOTH branches, so a listing
  // that stops being co-located keeps the distance it always had.
  const distanceMeters = minRadius + rand() * JITTER_SPAN_METERS;
  const angle =
    count > 1 ? (slot.rotation ?? 0) + (2 * Math.PI * slot.index) / count : rand() * 2 * Math.PI;

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
 * Resolves a listing to its REAL, un-jittered point, or null when there is
 * genuinely nothing to go on (no place match, no commune, no coordinates).
 *
 * Split out of `resolveListingLocation` because co-located listings can only
 * be separated once EVERY base point is known — which listing shares a spot
 * with which is not decidable one listing at a time. Callers plotting a set of
 * listings use this plus `placeResolvedListings`; the single-listing
 * `resolveListingLocation` below wraps both for one-off use.
 *
 * @param {Object} params
 * @param {Object} params.listing Real listing row (id, address, quartier, commune, reference, ...).
 * @param {google.maps.Geocoder} params.geocoder
 * @returns {Promise<{lat: number, lng: number, source: 'existing'|'geocoded'|'commune_fallback', precise: boolean, query: string|null}|null>}
 */
export async function resolveListingBase({ listing, geocoder }) {
  // Forward-compatible: if a listing ever does carry real coordinates (the
  // Postgres columns exist, just empty today — see CLAUDE.md), use them
  // directly and skip geocoding entirely.
  const existingLat = Number.parseFloat(listing.latitude);
  const existingLng = Number.parseFloat(listing.longitude);
  if (Number.isFinite(existingLat) && Number.isFinite(existingLng)) {
    return { lat: existingLat, lng: existingLng, source: 'existing', precise: true, query: null };
  }

  // Most specific query first, stopping at the first one Google resolves to a
  // real place rather than a commune outline.
  for (const query of buildGeocodeQueries(listing)) {
    let resolved;
    if (resolutionCache.has(query)) {
      resolved = resolutionCache.get(query);
    } else {
      resolved = await geocodeOneQuery(geocoder, query);
      resolutionCache.set(query, resolved);
    }
    if (resolved) return { ...resolved, query };
  }

  // No query landed on a real place — fall back to the commune's own real,
  // verified centroid rather than trusting Google's broad match. Keeping every
  // commune-level pin on one identical point is deliberate: it is exactly what
  // lets placeResolvedListings see them as a group and fan them apart, instead
  // of scattering them onto slightly different "approximate" guesses.
  const centroid = KINSHASA_COMMUNE_CENTROIDS[inferCommune(listing)];
  if (centroid) {
    return { lat: centroid.lat, lng: centroid.lng, source: 'commune_fallback', precise: false, query: null };
  }

  return null;
}

/**
 * Turns real resolved base points into the positions actually plotted.
 *
 * Listings that resolved to the same point — the same building, or far more
 * commonly the same commune centroid — are fanned onto a ring around it
 * instead of each choosing an independent random bearing, so N listings at one
 * spot render as N clickable pins rather than one pin with N-1 invisible
 * underneath. The displacement is the privacy jitter every pin already
 * carried; only its direction is chosen differently.
 *
 * @param {Array<{id: string|number, base: {lat: number, lng: number, source: string, precise: boolean}|null}>} entries
 * @returns {Map<string|number, {lat: number, lng: number, source: string, precise: boolean, colocated: boolean, groupSize: number}>}
 *   keyed by listing id, so a caller never depends on the order groups come out in.
 */
export function placeResolvedListings(entries) {
  const groups = new Map();

  for (const entry of entries ?? []) {
    const base = entry?.base;
    if (!base || !Number.isFinite(base.lat) || !Number.isFinite(base.lng)) continue;
    const key = colocationKey(base);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const placed = new Map();

  for (const [key, group] of groups) {
    // Sorted by id, not by arrival order: `listings` order changes with the
    // sort dropdown, and one building must not rearrange its pins every time
    // the visitor re-sorts. Numeric collation so #9 precedes #10.
    const ordered = [...group].sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );
    const rotation = seededRandom(hashString(key))() * 2 * Math.PI;

    ordered.forEach((entry, index) => {
      const slot = ordered.length > 1 ? { index, count: ordered.length, rotation } : null;
      placed.set(entry.id, placeOne(entry.id, entry.base, slot));
    });
  }

  return placed;
}

/** The same ~22m "one building footprint" threshold the final de-overlap pass uses. */
function colocationKey(base) {
  return `${Math.round(base.lat / COLOCATION_EPSILON_DEG)}:${Math.round(base.lng / COLOCATION_EPSILON_DEG)}`;
}

/** djb2 — this only needs to spread group keys over the PRNG's seed space. */
function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  return hash;
}

function placeOne(id, base, slot) {
  if (!base) return { lat: null, lng: null, source: 'unresolved', precise: false, colocated: false, groupSize: 0 };
  const jittered = applyPrivacyJitter(base.lat, base.lng, seedFromId(id), slot);
  return {
    ...jittered,
    source: base.source,
    precise: base.precise,
    colocated: Boolean(slot),
    groupSize: slot ? slot.count : 1,
  };
}

/**
 * Single-listing convenience wrapper: resolve, then place. A listing plotted
 * on its own has nothing to be co-located with, so no ring is applied.
 *
 * @param {Object} params
 * @param {Object} params.listing Real listing row (id, address, quartier, commune, ...).
 * @param {google.maps.Geocoder} params.geocoder
 * @returns {Promise<{lat: number, lng: number, source: 'existing'|'geocoded'|'commune_fallback'|'unresolved', precise: boolean}>}
 */
export async function resolveListingLocation({ listing, geocoder }) {
  const base = await resolveListingBase({ listing, geocoder });
  return placeOne(listing.id, base, null);
}

/**
 * Some listings predate the commune-tagging feature (see CLAUDE.md) and have
 * `commune: null` even though a real commune name is sitting right there in
 * the free-text address — e.g. address "Ngiri-Ngiri, Kinshasa" with no
 * structured commune. Falls back to scanning the real address/quartier text
 * for one of the 24 known commune names before giving up — this is reading
 * data that is already there, not inventing anything.
 */
function inferCommune(listing) {
  if (listing?.commune) return listing.commune;

  const haystack = `${listing?.address || ''} ${listing?.quartier || ''}`.toLowerCase();
  return Object.keys(KINSHASA_COMMUNE_CENTROIDS).find((commune) => haystack.includes(commune.toLowerCase())) || null;
}

/**
 * One real Geocoding API call. Resolves to a real point only when Google
 * matched a real PLACE; a bare commune/locality outline resolves to null, so
 * `resolveListingBase` can try the next, less specific query and ultimately
 * the verified commune centroid instead. Cached by its caller before any
 * jitter is applied, so a repeated query never re-jitters either.
 */
function geocodeOneQuery(geocoder, query) {
  return new Promise((resolve) => {
    geocoder.geocode({ address: query, region: 'cd' }, (results, status) => {
      if (status === 'OK' && results?.[0] && isPreciseResult(results[0])) {
        const loc = results[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng(), source: 'geocoded', precise: true });
        return;
      }
      resolve(null);
    });
  });
}
