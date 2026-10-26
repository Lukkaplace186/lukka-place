/**
 * services/geocoding.js
 *
 * Publish-time geocoding: a listing's `properties.latitude`/`longitude` are
 * filled once, server-side, when it syncs to Postgres — instead of every
 * visitor's browser re-geocoding every listing on every map view. The web
 * map (web/lib/listings.js getMapMarkers) filters on these columns by
 * bounding box, so a listing without them can only ever be placed at its
 * commune's centroid.
 *
 * Needs `GOOGLE_MAPS_SERVER_KEY`: an IP-restricted key for this server. The
 * storefront's NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is HTTP-referrer-restricted and
 * Google refuses it server-side ("API keys with referer restrictions cannot
 * be used with this API"). Unset means this module does nothing and says so
 * once — the map's commune fallback still works.
 *
 * Requests go out over IPv4 explicitly: the key is restricted to the VPS's
 * IPv4 address, and this host is dual-stack. Node prefers IPv6 when both are
 * available, and Google then denies the key for an address it does not know
 * (confirmed live by web/scripts/geocode-listings.js, which hit exactly that).
 * `family: 4` on the one request, rather than dns.setDefaultResultOrder, so
 * nothing else in this process changes how it connects.
 *
 * WHAT COUNTS AS A LOCATION — the same rules as web/lib/geocoding.js's
 * client-side cascade, deliberately duplicated (CommonJS vs the app's ESM);
 * change one, change the other, and web/scripts/geocode-listings.js too:
 *   - A `reference` is used as location text only when it reads as words
 *     ("Demiap", "2ᵉ Rue Industrielle"), never an identifier ("LKP-2026-0091").
 *   - A result counts only at real place precision. A bare commune/locality
 *     outline is refused: storing it would put a commune-centre guess in a
 *     column the map reads as the property's own position.
 *   - Nothing is fabricated. A listing that does not resolve stays NULL.
 *
 * NAMES ARE CHECKED (2026-10-24). Listing #387 ("GB / Hôtel Diplomate",
 * Ngaliema) was stored 2.7 km away, by Joli Parc: the Geocoding API answered
 * "GB / Hôtel Diplomate, Ngaliema" with a ROOFTOP hotel literally NAMED "GB"
 * in Quartier Bassoko. The Geocoding API returns no name, so an answer that is
 * a business can never be checked against what was asked. Now:
 *   1. The location text is split into terms ("GB" | "Hôtel Diplomate"); a
 *      term that is a known quartier or alias of the listing's commune
 *      (services/locations.js) is a PLACE, any other worded term a LANDMARK.
 *   2. PLACE → kinshasa_quartier_points.json (built by
 *      scripts/geocode-quartiers.js from the same lookup below), else Places
 *      API (New) text search: a neighbourhood whose name matches, or else the
 *      median of ≥3 businesses carrying the name within 1.5 km of each other
 *      ("Kin Marché GB", "Maison Galaxy GB"… — how a place nobody mapped is
 *      known). Every result must lie in the commune's own box.
 *   3. LANDMARK → Places text search, a result whose NAME matches, in the
 *      commune's box, ≤3 km from the place point when there is one (nearest
 *      wins). This runs first: it is the most precise thing an agent writes.
 *   4. Only then the old Geocoding API cascade, now refusing any business /
 *      point-of-interest answer (unverifiable) and anything outside the box.
 * The detail page draws a 500 m zone around the stored point, so a landmark
 * or quartier point is as close as this gets without a real address.
 */
const { cityOfCommune, communeLabel, resolveCity, DEFAULT_CITY } = require('./cities');
const locations = require('./locations');
const https = require('https');

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT_MS = 5000;

const PRECISE_LOCATION_TYPES = new Set(['ROOFTOP', 'RANGE_INTERPOLATED']);
const IMPRECISE_ONLY_TYPES = new Set([
  'locality', 'sublocality', 'sublocality_level_1', 'political', 'administrative_area_level_2',
  // Never in the web cascade's list because the client queries always carry a
  // commune; here a query can degrade further, and the province is not a place.
  'administrative_area_level_1', 'country',
]);

/** Google statuses that mean "this key / this server cannot geocode" — stop, don't cascade. */
const FATAL_STATUSES = new Set(['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'INVALID_REQUEST']);

const LANDMARK_WORD = /^\p{L}[\p{L}'’-]*$/u;

function isLandmarkReference(reference) {
  const value = String(reference ?? '').trim();
  if (value.length < 3) return false;
  return value
    .split(/[\s,]+/)
    .some((token) => LANDMARK_WORD.test(token) && (token.match(/\p{L}/gu) || []).length >= 3);
}

/** "GB / Hôtel Diplomate", "Mimosas, Camp Docteur" → its separate terms. */
const TERM_SPLIT = /\s*(?:[/|;()[\]–—,]|\s-\s)\s*/;

function splitLocationText(text) {
  return String(text ?? '')
    .split(TERM_SPLIT)
    .map((term) => term.trim())
    .filter((term) => /\p{L}{2,}/u.test(term));
}

/** The listing's own city and commune (a suffixed key sent as its plain name). */
function areaOf(row) {
  const town = cityOfCommune(row?.commune) || resolveCity(row?.city) || DEFAULT_CITY;
  const commune = row?.commune ? String(row.commune).trim() : null;
  const communeName = commune ? communeLabel(commune) : null;
  return { town, commune, communeName: communeName && communeName !== town ? communeName : null };
}

/**
 * The row's location text as PLACE terms (a quartier or alias known to be in
 * the listing's commune) and LANDMARK terms (anything else that reads as
 * words). Quartier text first, then the reference; duplicates collapse.
 */
function locationTerms(row) {
  const { town, commune } = areaOf(row);
  const places = [];
  const landmarks = [];
  const seen = new Set();
  // Places in the quartier field first (it is the quartier); landmarks from
  // the reference first (it is the agent's pointer to the door: "11ème Rue
  // Industriel" | réf "Clinique Raphaël").
  const seenPlace = (field, kind) => {
    for (const term of splitLocationText(field)) {
      const key = locations.placeKey(term);
      if (!key || seen.has(`${kind}:${key}`)) continue;
      const found = locations.inferCommune(term, { allowFuzzy: false, city: town });
      const inCommune = found.how === 'exact' && (!commune
        || (found.status === 'unique' ? found.commune === commune : (found.communes || []).includes(commune)));
      if (inCommune && kind === 'place') {
        seen.add(`place:${key}`);
        places.push({ text: term, quartier: found.status === 'unique' ? found.quartier : null });
      } else if (!inCommune && kind === 'landmark' && isLandmarkReference(term)) {
        seen.add(`landmark:${key}`);
        landmarks.push({ text: term });
      }
    }
  };
  seenPlace(row?.quartier, 'place');
  seenPlace(row?.reference, 'place');
  seenPlace(row?.reference, 'landmark');
  seenPlace(row?.quartier, 'landmark');
  return { places, landmarks };
}

/**
 * Ordered geocode queries for a listing row, most specific first. Only ever
 * built from text the row carries; a row with nothing but the city to go on
 * produces no query at all — "Kinshasa, RD Congo" is the city centre, not
 * this property.
 *
 * The city closing every query is the listing's own (services/cities.js):
 * the commune's city, else the city the agent named, else Kinshasa. A suffixed
 * commune key is sent as its plain name ("Kalamu, Boma", not "Kalamu (Boma)").
 *
 * @param {{quartier?: string, commune?: string, reference?: string, city?: string}} row
 * @returns {string[]}
 */
function buildGeocodeQueries(row) {
  // "Gambela, Lubumbashi, Lubumbashi" says nothing the city does not.
  const { town, communeName: commune } = areaOf(row);
  const city = [town, 'RD Congo'];
  const { places, landmarks } = locationTerms(row);
  // Split, so "GB / Hôtel Diplomate" is asked as "Hôtel Diplomate, GB, …".
  const quartier = places.map((place) => place.text).join(', ') || null;

  const candidates = [
    ...landmarks.map((landmark) => [landmark.text, quartier, commune]),
    [quartier, commune],
  ];

  // A landmark with no quartier or commune beside it is not geocoded at all.
  // Seen in the first production dry run: a `reference` of "7 maisons offres
  // bien metriser" (promotional text that happens to read as words) came back
  // as a ROOFTOP somewhere in the city — a confident point with nothing real
  // behind it. The quartier/commune is what anchors a landmark to an area.
  if (!(row?.quartier && String(row.quartier).trim()) && !row?.commune) return [];

  const queries = [];
  for (const parts of candidates) {
    const specific = parts.filter(Boolean);
    if (specific.length === 0) continue;
    const query = [...specific, ...city].join(', ');
    if (!queries.includes(query)) queries.push(query);
  }
  return queries;
}

function isPreciseResult(result) {
  if (!result?.geometry) return false;
  if (PRECISE_LOCATION_TYPES.has(result.geometry.location_type)) return true;
  const types = Array.isArray(result.types) ? result.types : [];
  return types.length > 0 && !types.every((type) => IMPRECISE_ONLY_TYPES.has(type));
}

/** GET a JSON body over IPv4. The default transport; tests pass their own. */
function httpsGetJson(url, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { family: 4, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`geocoding: unreadable response (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`geocoding: timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
  });
}

/**
 * One Geocoding API call. Resolves to a point only at real place precision,
 * null for no match or a commune-level outline, and THROWS for a key or quota
 * problem — that is a configuration failure to log, not "this address has no
 * match", and the cascade must not paper over it with a vaguer query.
 */
async function geocodeQuery(query, { apiKey, request = httpsGetJson, box = null } = {}) {
  const json = await geocodeRaw(query, { apiKey, request });
  const result = json?.status === 'OK' ? json.results?.[0] : null;
  if (!result || !isPreciseResult(result)) return null;
  // A business answer is a match on a NAME the Geocoding API does not return,
  // so it cannot be checked (#387: "GB" → a hotel called "GB"). Names are
  // checked through Places, above this fallback.
  const types = Array.isArray(result.types) ? result.types : [];
  if (types.includes('establishment') || types.includes('point_of_interest')) return null;
  const { lat, lng } = result.geometry.location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (box && !inBox({ lat, lng }, box)) return null;
  return { lat, lng, locationType: result.geometry.location_type };
}

async function geocodeRaw(query, { apiKey, request = httpsGetJson }) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&region=cd&key=${encodeURIComponent(apiKey)}`;
  const json = await request(url);
  if (FATAL_STATUSES.has(json?.status)) {
    throw new Error(`geocoding refused: ${json.status}${json.error_message ? ` — ${json.error_message}` : ''}`);
  }
  return json;
}

// --- Places API (New): lookups whose NAME can be checked --------------------

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_FIELDS = 'places.displayName,places.location,places.types,places.formattedAddress';
/** A commune's box is padded by ~1.1 km: a landmark on its boundary road is still its own. */
const BOX_PAD_DEG = 0.01;
/** A landmark further than this from the listing's own quartier is another place of that name. */
const LANDMARK_MAX_FROM_PLACE_KM = 3;
/** With no quartier point to choose by, name matches further apart than this are two places: refused. */
const LANDMARK_AMBIGUOUS_KM = 1.5;
/** Businesses carrying a quartier's name agree on where it is when ≥3 lie within this of their median. */
const CLUSTER_RADIUS_KM = 1.5;
const CLUSTER_MIN = 3;
const NEIGHBORHOOD_TYPES = new Set(['neighborhood', 'sublocality_level_2', 'sublocality_level_3', 'colloquial_area']);
/**
 * Words that do not identify a place: "Hôtel Diplomate" is matched on
 * "diplomate", "Derrière Hôpital Akram" on "hopital akram". Not "a": it is
 * also the letter in "Zone A" (which matched "MOBILE ZONE" without it).
 */
const NAME_STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'au', 'aux', 'en', 'sur', 'dans',
  'quartier', 'q', 'commune', 'c', 'kinshasa', 'ref', 'reference', 'hotel',
  'derriere', 'devant', 'pres', 'face', 'cote', 'vers', 'apres', 'avant', 'arret', 'non', 'loin', 'entre',
]);
const NAME_SYNONYMS = { av: 'avenue', ave: 'avenue', bd: 'boulevard', blvd: 'boulevard', st: 'saint', ste: 'sainte' };

function nameTokens(text) {
  return locations.placeKey(String(text ?? '').replace(/ᵉ/g, 'e'))
    .split(' ')
    .filter(Boolean)
    .map((token) => NAME_SYNONYMS[token] || token);
}

/** Does a returned place's name carry every identifying word of the term? */
function nameMatches(term, displayName) {
  const wanted = nameTokens(term).filter((token) => !NAME_STOPWORDS.has(token));
  if (wanted.length === 0) return false;
  const have = nameTokens(displayName);
  if (wanted.every((token) => have.includes(token))) return true;
  // An agent's long repère names the place and more ("SUPER MARCHÉ GALAXY DE
  // SUKA MUR MBINZA OZONE" for "Super Marché Galaxy Ozone"): every identifying
  // word of a name of three or more such words is in the term. Two is too
  // few: "Golf météo" would then answer "Golf météo 1" while a second "Golf
  // météo" 3 km away went unseen.
  const named = have.filter((token) => !NAME_STOPWORDS.has(token));
  if (named.length >= 3 && named.every((token) => wanted.includes(token))) return true;
  // "Kasavubu" vs "Kasa-Vubu": the same letters, spaced differently — on whole
  // words only, so "Mushi" never matches "Mushie".
  const compact = wanted.join('');
  if (compact.length < 5) return false;
  for (let start = 0; start < have.length; start += 1) {
    let joined = '';
    for (let end = start; end < have.length && joined.length < compact.length; end += 1) {
      joined += have[end];
      if (joined === compact) return true;
    }
  }
  return false;
}

function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function inBox(point, box) {
  return point.lat >= box.low.lat && point.lat <= box.high.lat && point.lng >= box.low.lng && point.lng <= box.high.lng;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** POST a JSON body over IPv4 (same reason as httpsGetJson). Tests pass their own. */
function httpsPostJson(url, body, headers, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', family: 4, timeout: timeoutMs, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(new Error(`places: unreadable response (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`places: timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

/** One Places text search → [{name, lat, lng, types}]. A refused key or quota THROWS, like geocodeQuery. */
async function placesSearch(textQuery, { apiKey, placesRequest = httpsPostJson, box = null }) {
  const body = { textQuery, regionCode: 'CD', languageCode: 'fr', pageSize: 20 };
  if (box) body.locationRestriction = { rectangle: { low: { latitude: box.low.lat, longitude: box.low.lng }, high: { latitude: box.high.lat, longitude: box.high.lng } } };
  const json = await placesRequest(PLACES_URL, body, { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACES_FIELDS });
  if (json?.error) throw new Error(`places refused: ${json.error.status || json.error.code} — ${json.error.message || ''}`.trim());
  return (json?.places || [])
    .map((place) => ({
      name: place.displayName?.text || '',
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      types: place.types || [],
    }))
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
}

const boxCache = new Map();

/**
 * The commune's own area (Google's viewport for "Ngaliema, Kinshasa, RD
 * Congo", padded), or the city's when there is no commune. Null when Google
 * gives no administrative answer — lookups then run unrestricted, still
 * name-checked.
 */
async function areaBox(row, { apiKey, request = httpsGetJson }) {
  const { town, communeName } = areaOf(row);
  const query = [communeName, town, 'RD Congo'].filter(Boolean).join(', ');
  if (boxCache.has(query)) return boxCache.get(query);
  const json = await geocodeRaw(query, { apiKey, request });
  const result = json?.status === 'OK' ? json.results?.[0] : null;
  const types = result?.types || [];
  const area = types.some((type) => ['locality', 'sublocality', 'sublocality_level_1', 'administrative_area_level_2', 'administrative_area_level_3'].includes(type))
    ? result.geometry?.bounds || result.geometry?.viewport
    : null;
  const box = area?.southwest && area?.northeast
    ? {
      low: { lat: area.southwest.lat - BOX_PAD_DEG, lng: area.southwest.lng - BOX_PAD_DEG },
      high: { lat: area.northeast.lat + BOX_PAD_DEG, lng: area.northeast.lng + BOX_PAD_DEG },
    }
    : null;
  boxCache.set(query, box);
  return box;
}

let QUARTIER_POINTS = {};
try {
  // eslint-disable-next-line global-require
  QUARTIER_POINTS = require('../kinshasa_quartier_points.json').points || {};
} catch (err) {
  QUARTIER_POINTS = {};
}

function pointKey(commune, name) {
  return `${commune}|${locations.placeKey(name)}`;
}

const EDGE_KM = 0.8;

/**
 * Is a point in the listing's commune, by Google's own commune outlines
 * (reverse geocode, `sublocality_level_1`)? Boxes are rectangles and
 * neighbouring communes' boxes overlap: Makala's "Salongo" came back as
 * Lemba's. A point within EDGE_KM of its commune (a quartier on the boundary,
 * like Socimat) still counts. True when Google names no commune there at all
 * (most cities outside Kinshasa): nothing to check against.
 */
async function pointInCommune(point, row, { apiKey, request = httpsGetJson }) {
  const { communeName } = areaOf(row);
  if (!communeName) return true;
  const want = locations.placeKey(communeName);
  const namesAt = async ({ lat, lng }) => {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&result_type=sublocality_level_1&key=${encodeURIComponent(apiKey)}`;
    const json = await request(url);
    if (FATAL_STATUSES.has(json?.status)) throw new Error(`geocoding refused: ${json.status}`);
    return (json?.results || []).map((r) => locations.placeKey(r.address_components?.[0]?.long_name || ''));
  };
  const here = await namesAt(point);
  if (here.length === 0 || here.includes(want)) return true;
  const dLat = EDGE_KM / 111.32;
  const dLng = EDGE_KM / (111.32 * Math.cos((point.lat * Math.PI) / 180));
  for (const offset of [[dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]]) {
    if ((await namesAt({ lat: point.lat + offset[0], lng: point.lng + offset[1] })).includes(want)) return true;
  }
  return false;
}

/**
 * Where a quartier / alias of the commune is: neighbourhood whose name
 * matches, else the median of ≥3 name-matching places that agree within
 * CLUSTER_RADIUS_KM. Null when neither (never a guess).
 */
async function lookupPlaceTerm(term, row, options, box) {
  const { town, communeName } = areaOf(row);
  const query = [term, communeName, town].filter(Boolean).join(', ');
  const results = (await placesSearch(query, { ...options, box })).filter((place) => nameMatches(term, place.name));
  for (const place of results.filter((r) => r.types.some((type) => NEIGHBORHOOD_TYPES.has(type)))) {
    if (await pointInCommune(place, row, options)) return { lat: place.lat, lng: place.lng, how: 'neighborhood', query };
  }
  const businesses = results.filter((place) => !place.types.some((type) => NEIGHBORHOOD_TYPES.has(type) || type === 'sublocality_level_1' || type === 'locality'));
  if (businesses.length < CLUSTER_MIN) return null;
  const centre = { lat: median(businesses.map((p) => p.lat)), lng: median(businesses.map((p) => p.lng)) };
  const agreeing = businesses.filter((place) => distanceKm(place, centre) <= CLUSTER_RADIUS_KM);
  if (agreeing.length < CLUSTER_MIN) return null;
  const point = { lat: median(agreeing.map((p) => p.lat)), lng: median(agreeing.map((p) => p.lng)) };
  if (!(await pointInCommune(point, row, options))) return null;
  return { ...point, how: 'cluster', size: agreeing.length, query };
}

/** A place term: the built table first (key present with null = looked, nothing found), else live. */
async function resolvePlaceTerm(place, row, options, box) {
  const commune = row?.commune ? String(row.commune).trim() : null;
  if (commune && !options.ignoreTable) {
    for (const name of [place.quartier, place.text].filter(Boolean)) {
      const key = pointKey(commune, name);
      if (Object.prototype.hasOwnProperty.call(QUARTIER_POINTS, key)) {
        const hit = QUARTIER_POINTS[key];
        return hit ? { lat: hit.lat, lng: hit.lng, how: 'table', query: key } : null;
      }
    }
  }
  return lookupPlaceTerm(place.text, row, options, box);
}

/** A landmark term: a name-matching result in the box, nearest the place point when there is one. */
async function resolveLandmarkTerm(landmark, row, options, box, anchor) {
  const { town, communeName } = areaOf(row);
  const query = [landmark.text, communeName, town].filter(Boolean).join(', ');
  let candidates = (await placesSearch(query, { ...options, box }))
    .filter((place) => nameMatches(landmark.text, place.name))
    .filter((place) => !place.types.includes('sublocality_level_1') && !place.types.includes('locality'));
  if (anchor) {
    candidates = candidates
      .map((place) => ({ ...place, km: distanceKm(place, anchor) }))
      .filter((place) => place.km <= LANDMARK_MAX_FROM_PLACE_KM)
      .sort((a, b) => a.km - b.km);
  } else if (candidates.some((place) => distanceKm(place, candidates[0]) > LANDMARK_AMBIGUOUS_KM)) {
    // Two "Golf Météo" 3 km apart and nothing to tell which: not a guess.
    return null;
  }
  const best = candidates[0];
  return best ? { lat: best.lat, lng: best.lng, how: 'landmark', matched: best.name, query } : null;
}

/** Steps 1–3 of the header. Null when no term resolves through Places. */
async function resolveWithPlaces(row, options) {
  const { places, landmarks } = locationTerms(row);
  if (places.length === 0 && landmarks.length === 0) return null;
  if (!row?.quartier && !row?.commune) return null;
  const box = await areaBox(row, options);
  let anchor = null;
  for (const place of places) {
    anchor = await resolvePlaceTerm(place, row, options, box);
    if (anchor) {
      anchor = { ...anchor, term: place.text };
      break;
    }
  }
  for (const landmark of landmarks) {
    const point = await resolveLandmarkTerm(landmark, row, options, box, anchor);
    if (point) return { ...point, term: landmark.text, locationType: 'PLACES' };
  }
  return anchor ? { ...anchor, locationType: 'PLACES' } : null;
}

/**
 * Where a listing is: Places lookups whose names are checked, then the
 * Geocoding API cascade (businesses refused, the commune's box enforced).
 * `places: false` skips Places (scripts that only want the old cascade).
 */
async function geocodeListingRow(row, options = {}) {
  if (options.places !== false) {
    const point = await resolveWithPlaces(row, options);
    if (point) return point;
  }
  const box = buildGeocodeQueries(row).length ? await areaBox(row, options) : null;
  for (const query of buildGeocodeQueries(row)) {
    const point = await geocodeQuery(query, { ...options, box });
    if (point) return { ...point, query, how: 'geocoded' };
  }
  return null;
}

/** TEXT columns: an empty string is as absent as NULL. */
function hasCoordinates(row) {
  const lat = Number.parseFloat(row?.latitude);
  const lng = Number.parseFloat(row?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normaliseLocationText(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Did the text a listing is geocoded FROM change? A correction that moves a
 * listing to another quartier must not keep the old pin — but one that only
 * fixes the price must not throw away a position an admin set by hand.
 */
function locationInputsChanged(previous, row) {
  if (!previous) return false;
  return ['quartier', 'commune', 'reference', 'city'].some(
    (key) => normaliseLocationText(previous[key]) !== normaliseLocationText(row?.[key]),
  );
}

let warnedUnconfigured = false;

/**
 * Fill a property's blank coordinates from its listing row. Never overwrites a
 * coordinate that is already there (the UPDATE itself re-checks, so a value an
 * admin saves concurrently wins).
 *
 * @param {{query: Function}} db  A pg client or pool.
 * @returns {Promise<{status: 'unconfigured'|'skipped'|'kept'|'unresolved'|'geocoded', lat?: number, lng?: number, query?: string}>}
 */
async function storeListingCoordinates(db, propertyId, row, { apiKey = process.env.GOOGLE_MAPS_SERVER_KEY, ...options } = {}) {
  if (!apiKey) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn('[geocoding] GOOGLE_MAPS_SERVER_KEY is not set — new listings get no coordinates; the map places them at their commune centroid');
    }
    return { status: 'unconfigured' };
  }
  if (!propertyId) return { status: 'skipped' };

  const { rows } = await db.query('SELECT latitude, longitude FROM properties WHERE id = $1', [propertyId]);
  if (rows.length === 0) return { status: 'skipped' };
  if (hasCoordinates(rows[0])) return { status: 'kept' };

  const point = await geocodeListingRow(row, { ...options, apiKey });
  if (!point) return { status: 'unresolved' };

  await db.query(
    `UPDATE properties SET latitude = $1, longitude = $2
      WHERE id = $3 AND (NULLIF(TRIM(latitude), '') IS NULL OR NULLIF(TRIM(longitude), '') IS NULL)`,
    [String(point.lat), String(point.lng), propertyId],
  );
  return { status: 'geocoded', lat: point.lat, lng: point.lng, query: point.query };
}

module.exports = {
  isLandmarkReference,
  splitLocationText,
  locationTerms,
  nameMatches,
  buildGeocodeQueries,
  isPreciseResult,
  geocodeQuery,
  placesSearch,
  lookupPlaceTerm,
  resolveLandmarkTerm,
  areaBox,
  pointInCommune,
  geocodeListingRow,
  distanceKm,
  pointKey,
  hasCoordinates,
  locationInputsChanged,
  storeListingCoordinates,
};
