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
 */
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

/**
 * Ordered geocode queries for a listing row, most specific first. Only ever
 * built from text the row carries; a row with nothing but the city to go on
 * produces no query at all — "Kinshasa, RD Congo" is the city centre, not
 * this property.
 *
 * @param {{quartier?: string, commune?: string, reference?: string}} row
 * @returns {string[]}
 */
function buildGeocodeQueries(row) {
  const landmark = isLandmarkReference(row?.reference) ? String(row.reference).trim() : null;
  const quartier = row?.quartier ? String(row.quartier).trim() : null;
  const commune = row?.commune ? String(row.commune).trim() : null;
  const city = ['Kinshasa', 'RD Congo'];

  const candidates = [
    [landmark, quartier, commune],
    [quartier, commune],
  ];

  // A landmark with no quartier or commune beside it is not geocoded at all.
  // Seen in the first production dry run: a `reference` of "7 maisons offres
  // bien metriser" (promotional text that happens to read as words) came back
  // as a ROOFTOP somewhere in the city — a confident point with nothing real
  // behind it. The quartier/commune is what anchors a landmark to an area.
  if (!quartier && !commune) return [];

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
async function geocodeQuery(query, { apiKey, request = httpsGetJson } = {}) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&region=cd&key=${encodeURIComponent(apiKey)}`;
  const json = await request(url);
  if (FATAL_STATUSES.has(json?.status)) {
    throw new Error(`geocoding refused: ${json.status}${json.error_message ? ` — ${json.error_message}` : ''}`);
  }
  const result = json?.status === 'OK' ? json.results?.[0] : null;
  if (!result || !isPreciseResult(result)) return null;
  const { lat, lng } = result.geometry.location || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, locationType: result.geometry.location_type };
}

/** Walk the cascade; the first query Google resolves to a real place wins. */
async function geocodeListingRow(row, options = {}) {
  for (const query of buildGeocodeQueries(row)) {
    const point = await geocodeQuery(query, options);
    if (point) return { ...point, query };
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
  return ['quartier', 'commune', 'reference'].some(
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
async function storeListingCoordinates(db, propertyId, row, { apiKey = process.env.GOOGLE_MAPS_SERVER_KEY, request } = {}) {
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

  const point = await geocodeListingRow(row, { apiKey, request });
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
  buildGeocodeQueries,
  isPreciseResult,
  geocodeQuery,
  geocodeListingRow,
  hasCoordinates,
  locationInputsChanged,
  storeListingCoordinates,
};
