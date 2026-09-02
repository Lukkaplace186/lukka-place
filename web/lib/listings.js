import 'server-only';
import { getPool } from './db';
import { KINSHASA_COMMUNE_CENTROIDS } from './geocoding';
import { AMENITY_GROUPS, AMENITY_KEYWORDS } from './constants';
import { abbreviationVariants } from './textVariants';

/**
 * Every read against `properties` filters on this — no exceptions. There is
 * no Row Level Security on this table (see CLAUDE.md); this query-time
 * filter is the only thing keeping pending/unapproved listings private.
 * Confirmed against live production data, not assumed: `status` and
 * `approve_status` are both integers — `status = 'approved'` would be a
 * Postgres type error, not an empty result.
 */
const APPROVED_FILTER = 'p.status = 1 AND p.approve_status = 1';

/** location = data content slot; 26 = category content slot — both fixed by
 *  lukka-place-engine/services/postgres.js's existing write-side convention. */
const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

/**
 * Commune is not a column — it's tagged via `property_amenities` onto one of
 * amenity ids 21-44 (see services/postgres.js's COMMUNE_AMENITY_IDS in the
 * engine repo). This subquery resolves that tag back to a name for display;
 * WHERE-clause filtering by commune uses the equivalent EXISTS form below.
 */
const COMMUNE_SUBQUERY = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
) AS commune`;

/**
 * Full photo set (featured_image is separate — this is the slider/gallery
 * table). Included on every read now, not just getListingById: the
 * Rightmove-style card design shows an inline mini-carousel on each card in
 * the feed, not just on the detail page.
 */
const GALLERY_SUBQUERY = `(
  SELECT COALESCE(array_agg(psi.image ORDER BY psi.id), ARRAY[]::text[])
  FROM property_slider_images psi
  WHERE psi.property_id = p.id
) AS gallery`;

// price_period/deposit_months: the ALTER TABLE this used to wait on
// (`price_period text, deposit_months integer`) has now run on live
// Supabase — confirmed directly against information_schema.columns, not
// assumed. services/postgres.js (engine repo) was already writing both
// fields on every sync; until this migration ran, every one of those
// writes was silently failing (syncListingToPostgres is fire-and-forget
// and swallows its own errors), so no listing has actually reached the
// public site with real deposit/period data yet — this is what turns that
// on. web/components/{ListingCard,ListingCardVertical,PropertyMetrics}.js
// already render a "Garantie N mois" badge whenever `deposit_months` is
// present; it was real code with nothing behind it until now.
// Agent contact: properties.agent_id (FK, NULL on every row today — see
// services/postgres.js's resolveAgentId in the engine repo, which only
// starts resolving real matches once real agent accounts with real phone
// numbers exist) LEFT JOINs to `agents`, never an inner join — a listing
// with no agent attached must still return, with these columns NULL, not
// disappear from the feed. `agents.image`/`agents.phone` are whatever the
// Laravel admin form eventually lets a team member enter — no known
// URL-prefixing convention for `image` was verified, so it's selected as-is
// and the UI (AgencyLogo.js) falls back to text on a load failure rather
// than assuming a base path that might be wrong. `a.id AS agent_id` is the
// real FK target itself — selected so the detail page can link to
// /agents/[id] (app/(portfolio)/agents/[id]/page.js) when a listing
// actually has one attached, rather than guessing at an id.
// Dual-column currency: p.price above stays the canonical USD figure that
// every filter (WHERE price >= / <=), ORDER BY price and MAX(price) in this
// module compare against. p.currency + p.price_original carry what the agent
// actually authored, so <Price> can render an FC-authored listing verbatim
// instead of round-tripping it through a rate that moves.
//
// (Kept as a JS comment, not an inline SQL one: this is a template literal,
// and a backtick inside it — as in a quoted column name — silently ends the
// string. That broke the build once.)
const SELECT_FIELDS = `
  p.id, p.price, p.purpose, p.beds, p.bath, p.area, p.quartier,
  p.currency, p.price_original,
  p.parcelle_subtype, p.units_count, p.reference, p.featured_image,
  p.created_at, p.price_period, p.deposit_months, p.listing_status,
  pc.title, pc.slug, pc.address,
  catc.name AS category_name,
  pc.description,
  a.id AS agent_id, a.image AS agency_logo_url, a.username AS agency_name, a.phone AS agent_phone,
  ${COMMUNE_SUBQUERY},
  ${GALLERY_SUBQUERY}
`;



const FROM_JOINS = `
  FROM properties p
  JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
  JOIN property_categories cat ON cat.id = p.category_id
  JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = ${CATEGORY_LANGUAGE_ID}
  LEFT JOIN agents a ON a.id = p.agent_id
`;

const TRANSACTION_TYPE_TO_PURPOSE = { location: 'rent', vente: 'sale' };

/** Escape regex metacharacters so a keyword is matched literally by `~*` below. */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Plus de filtres" amenity checkboxes (lib/constants.js's AMENITY_GROUPS
 * owns the UI labels/keys — this owns the actual keyword list per key, kept
 * here rather than in constants.js since it's a query-building detail the
 * UI doesn't need). Matched with a leading-word-boundary regex (`~* '\y...'`,
 * no trailing boundary), not plain ILIKE substring matching — confirmed
 * while writing this that a plain `ILIKE '%meuble%'` (furnished) matches
 * inside "immeuble" (building), a real false-positive substring collision,
 * not a hypothetical one. The trailing boundary is deliberately omitted,
 * also confirmed live against real data: `p.description ~* '\yclimatisé\y'`
 * does NOT match a real listing's actual text ("...chambres bien
 * CLIMATISÉES...") because French adjectives inflect for gender/number —
 * requiring a boundary immediately after the keyword rejects any suffixed
 * form. A leading-only boundary matches "climatisé" as a live word-start
 * prefix (so "climatisées"/"climatisé" both match) while still correctly
 * failing to match "meuble" inside "immeuble" (no boundary exists between
 * the second "m" and "meuble" there — confirmed with the same live query).
 * The keyword list itself now lives in lib/constants.js's AMENITY_KEYWORDS
 * (imported above) so lib/listingView.js's client-side card badges can
 * share the exact same list rather than a hand-duplicated copy.
 */

// Derived, not hand-duplicated, from lib/constants.js's AMENITY_GROUPS — the
// UI can only ever send a key that's actually offered as a checkbox.
const VALID_AMENITY_KEYS = new Set(AMENITY_GROUPS.flatMap((group) => group.options.map((o) => o.key)));

const LISTINGS_LIMIT_DEFAULT = 12; // 12 cards per feed page
const LISTINGS_LIMIT_MAX = 60;

// FilterBar.js's "Rayon" dropdown's kilometer options. Backed by real data
// as of the 2026-08-23 geocoding backfill (scripts/geocode-listings.js) —
// every currently-approved listing has a real, Google-geocoded lat/lng.
// A future listing published without a fresh geocode will have NULL
// coordinates again until re-synced/re-geocoded; see the isKmRadius branch
// below for how that case is handled rather than ignored.
const KM_RADIUS_KM = { 1: 1, 3: 3, 5: 5 };

/**
 * Build the WHERE clause + params shared by getListings and its COUNT query.
 *
 * "Parcelle" and "Appartement" are filtered on the fields that actually carry
 * that meaning in this schema, not on category_id directly:
 *   - Appartement -> category_content name = 'appartement'.
 *   - Parcelle -> parcelle_subtype IS NOT NULL. This is deliberately NOT the
 *     same as category_id = terrain's id: a plain 'villa' listing with no
 *     plot/compound signal (see services/openai.js's classification rules in
 *     the engine repo) is synced under the 'maison' category, not 'terrain' —
 *     only a listing that actually went through the parcelle classification
 *     path has parcelle_subtype set. Filtering on parcelle_subtype is the
 *     precise match for "this is a parcelle listing".
 */
function buildFilters({ transactionType, propertyType, parcelleSubtype, commune, quartier, radius, reference, priceMin, priceMax, bedsMin, bathMin, depositMax, amenities, search, excludeId, agentId }) {
  const where = [APPROVED_FILTER];
  const params = [];

  const purpose = TRANSACTION_TYPE_TO_PURPOSE[transactionType];
  if (purpose) {
    params.push(purpose);
    where.push(`p.purpose = $${params.length}`);
  }

  const minPrice = Number.parseFloat(priceMin);
  if (Number.isFinite(minPrice)) {
    params.push(minPrice);
    where.push(`p.price >= $${params.length}`);
  }

  const maxPrice = Number.parseFloat(priceMax);
  if (Number.isFinite(maxPrice)) {
    params.push(maxPrice);
    where.push(`p.price <= $${params.length}`);
  }

  const minBeds = Number.parseInt(bedsMin, 10);
  if (Number.isFinite(minBeds) && minBeds > 0) {
    params.push(minBeds);
    where.push(`p.beds >= $${params.length}`);
  }

  const minBath = Number.parseInt(bathMin, 10);
  if (Number.isFinite(minBath) && minBath > 0) {
    params.push(minBath);
    where.push(`p.bath >= $${params.length}`);
  }

  // Used by the detail page's "other properties in this commune" rail so a
  // listing never recommends itself.
  const excluded = Number.parseInt(excludeId, 10);
  if (Number.isFinite(excluded)) {
    params.push(excluded);
    where.push(`p.id <> $${params.length}`);
  }

  // Agent storefront (web/app/(site)/agents/[id]/page.js) — scopes results
  // to one real agents.id via the same p.agent_id column the public
  // agency_name/agency_logo_url fields already join through.
  const agent = Number.parseInt(agentId, 10);
  if (Number.isFinite(agent)) {
    params.push(agent);
    where.push(`p.agent_id = $${params.length}`);
  }

  // "Max Garantie / Avance" (FiltersDrawer.js) — deposit_months is a real,
  // structured column (see lib/constants.js's DEPOSIT_MAX_OPTIONS doc
  // comment), so unlike the amenity checkboxes below this is an exact
  // filter on verified data, not a text search. A listing whose deposit is
  // still unknown (NULL — synced before the 2026-08-19 migration, or never
  // republished since) is excluded rather than silently treated as a match.
  const maxDeposit = Number.parseInt(depositMax, 10);
  if (Number.isFinite(maxDeposit)) {
    params.push(maxDeposit);
    where.push(`p.deposit_months IS NOT NULL AND p.deposit_months <= $${params.length}`);
  }

  // "Plus de filtres" amenity checkboxes (Énergie & Eau / Accessibilité &
  // Sécurité / Conditions de location) — no structured column exists for
  // any of these (see AMENITY_KEYWORDS's doc comment above), so each
  // checked box ANDs in a real word-boundary match against the listing's
  // own title/description text. Only title/description, not address/
  // quartier/reference/commune (unlike the free-text `search` fallback
  // below): an amenity describes a feature of the property, not where it
  // is, so matching it against a quartier or reference name would be a
  // real false positive, not just an imprecise one. An unrecognised key is
  // silently ignored rather than erroring — the UI can only ever send one
  // of VALID_AMENITY_KEYS, but a stale/hand-edited URL shouldn't 500.
  if (Array.isArray(amenities)) {
    for (const key of amenities) {
      if (!VALID_AMENITY_KEYS.has(key)) continue;
      const keywords = AMENITY_KEYWORDS[key];
      const group = keywords.map((keyword) => {
        params.push(`\\y${escapeRegex(keyword)}`);
        const idx = params.length;
        return `pc.title ~* $${idx} OR pc.description ~* $${idx}`;
      });
      where.push(`(${group.join(' OR ')})`);
    }
  }

  if (propertyType === 'parcelle') {
    where.push('p.parcelle_subtype IS NOT NULL');
    if (parcelleSubtype) {
      params.push(parcelleSubtype);
      where.push(`p.parcelle_subtype = $${params.length}`);
    }
  } else if (propertyType) {
    // Case-insensitive on purpose: the live rows are 'Appartement' and
    // 'Maison' (capitalised), while this comparison used to be hardcoded to
    // lowercase 'appartement' — so the filter matched nothing at all. Do not
    // "simplify" this back to an exact match.
    params.push(propertyType.toLowerCase());
    where.push(`LOWER(catc.name) = $${params.length}`);
  }

  // FilterBar.js's "Rayon" dropdown.
  //   'commune'  -> drop the quartier constraint, keep commune.
  //   'citywide' -> drop both.
  //   '1'|'3'|'5' -> real kilometer radius (see below).
  const isCitywide = radius === 'citywide';
  const isCommuneWide = radius === 'commune';
  const kmValue = KM_RADIUS_KM[radius];
  const isKmRadius = Boolean(kmValue) && Boolean(commune) && Boolean(KINSHASA_COMMUNE_CENTROIDS[commune]);

  if (isKmRadius) {
    // A real Haversine distance, centered on the commune's real,
    // Google-verified centroid (KINSHASA_COMMUNE_CENTROIDS — lib/geocoding.js,
    // fetched live from the Geocoding API, not typed from memory). There is
    // still no quartier-level or landmark-level coordinate data, so this
    // centers on the commune regardless of whether a quartier is also
    // selected — the closest real reference point available.
    //
    // A listing whose own lat/lng is still NULL (a future un-geocoded
    // submission — see scripts/geocode-listings.js) can't be measured by
    // distance at all, so it falls back to the same commune-tag EXISTS check
    // used by the plain commune filter below rather than silently vanishing
    // from every km-radius search.
    //
    // LEAST/GREATEST clamps the acos() argument to [-1, 1]: floating-point
    // rounding on a listing essentially at the centroid itself can push the
    // cosine expression a hair past 1, and acos() of anything outside that
    // domain is NaN in Postgres — a real failure mode of this exact formula,
    // not a hypothetical one, so it's guarded here rather than shipped as
    // written in the original spec.
    const centroid = KINSHASA_COMMUNE_CENTROIDS[commune];
    params.push(centroid.lat, centroid.lng, kmValue, commune);
    const latIdx = params.length - 3;
    const lngIdx = params.length - 2;
    const radiusIdx = params.length - 1;
    const communeIdx = params.length;
    where.push(`(
      (
        p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND p.latitude != '' AND p.longitude != '' AND (
          6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians($${latIdx})) * cos(radians(p.latitude::double precision)) *
              cos(radians(p.longitude::double precision) - radians($${lngIdx})) +
              sin(radians($${latIdx})) * sin(radians(p.latitude::double precision))
            ))
          )
        ) <= $${radiusIdx}
      )
      OR (
        (p.latitude IS NULL OR p.longitude IS NULL OR p.latitude = '' OR p.longitude = '') AND EXISTS (
          SELECT 1 FROM property_amenities pa
          JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
          WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name = $${communeIdx}
        )
      )
    )`);
  } else if (commune && !isCitywide) {
    params.push(commune);
    where.push(`EXISTS (
      SELECT 1 FROM property_amenities pa
      JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
      WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name = $${params.length}
    )`);
  }

  if (quartier && !isCitywide && !isCommuneWide && !isKmRadius) {
    params.push(quartier);
    where.push(`p.quartier = $${params.length}`);
  }

  // lib/searchParser.js's reference-code extraction ("LKP-2026-0091", or a
  // bare remembered number like "réf 91") — ILIKE, not an exact match:
  // "réf 91" only carries the trailing digits, with no way to reconstruct
  // the real LKP-YYYY-NNNN code from that alone, so a partial match is the
  // honest behaviour rather than requiring the visitor to have the exact
  // full code.
  if (reference) {
    params.push(`%${reference}%`);
    where.push(`p.reference ILIKE $${params.length}`);
  }

  // Free-text search box (Zillow-style sticky pill on /listings): real
  // ILIKE matching against the columns a visitor would actually type —
  // title, description, address, quartier, reference, or a commune name —
  // not a cosmetic wrapper around the existing cascading dropdowns. `pc.
  // description` matters specifically for landmark-style queries ("Saint
  // Luc", "après la paroisse..."): agents write that wayfinding text into
  // the free-text description, not into any structured column, so a search
  // limited to title/address/quartier/reference silently misses it.
  //
  // Each abbreviation variant (see abbreviationVariants() above) gets its
  // own OR'd column group, since ILIKE is a literal substring match and
  // "St Luc" / "Saint Luc" don't substring-match each other. Same $n
  // placeholder is referenced multiple times per group, which Postgres
  // allows.
  const term = typeof search === 'string' ? search.trim() : '';
  if (term) {
    const groups = abbreviationVariants(term).map((variant) => {
      params.push(`%${variant}%`);
      const idx = params.length;
      return `
        pc.title ILIKE $${idx} OR
        pc.description ILIKE $${idx} OR
        pc.address ILIKE $${idx} OR
        p.quartier ILIKE $${idx} OR
        p.reference ILIKE $${idx} OR
        EXISTS (
          SELECT 1 FROM property_amenities pa
          JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
          WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name ILIKE $${idx}
        )
      `;
    });
    where.push(`(${groups.join(' OR ')})`);
  }

  return { whereClause: where.join(' AND '), params };
}

const SORT_COLUMNS = {
  newest: 'p.created_at DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
};

/**
 * Paginated, filtered public listings.
 *
 * @param {Object} [options]
 * @param {'location'|'vente'} [options.transactionType]
 * @param {'parcelle'|'appartement'} [options.propertyType]
 * @param {'maison_type_locataire'|'villa'|'terrain_nu'} [options.parcelleSubtype]
 * @param {string} [options.commune]  Canonical commune name (see GET /locations).
 * @param {string} [options.quartier] Canonical quartier name.
 * @param {'commune'|'citywide'|'1'|'3'|'5'} [options.radius] 'commune' drops the quartier constraint (keeps commune); 'citywide' drops both. '1'|'3'|'5' is a real kilometer radius, Haversine-measured from the commune's real geocoded centroid against each listing's own real coordinates (backfilled via scripts/geocode-listings.js) — a listing still missing coordinates falls back to the commune-tag match instead of being silently excluded.
 * @param {number} [options.priceMin]
 * @param {number} [options.priceMax]
 * @param {number} [options.bedsMin] Minimum bedrooms (`p.beds >= bedsMin`).
 * @param {number} [options.depositMax] Real, structured `deposit_months <= depositMax` filter (NULL deposits excluded — see lib/constants.js's DEPOSIT_MAX_OPTIONS).
 * @param {string[]} [options.amenities] "Plus de filtres" checkboxes (lib/constants.js's AMENITY_GROUPS keys) — word-boundary text match against title/description, not a structured flag (see AMENITY_KEYWORDS above).
 * @param {string} [options.search] Free-text match against title/description/address/quartier/reference/commune.
 * @param {number} [options.agentId] Scopes to one real agents.id — the agent storefront's inventory filter.
 * @param {'newest'|'price_asc'|'price_desc'} [options.sort='newest']
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[], locationRelaxed: boolean, relaxedFromCommune: string|null, requestedRadius: string|null, radiusExpanded: boolean, effectiveRadius: string|null}>}
 */
export async function getListings(options = {}) {
  let { whereClause, params } = buildFilters(options);

  const parsedLimit = Number.parseInt(options.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), LISTINGS_LIMIT_MAX)
    : LISTINGS_LIMIT_DEFAULT;

  const parsedOffset = Number.parseInt(options.offset, 10);
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const orderBy = SORT_COLUMNS[options.sort] || SORT_COLUMNS.newest;

  const pool = getPool();

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS total ${FROM_JOINS} WHERE ${whereClause}`,
    params,
  );
  let total = Number.parseInt(countRows[0].total, 10);

  // Hybrid location fallback: a landmark suggestion (LocationAutocomplete.js)
  // sets `commune` *and* `q` together, AND'd in buildFilters(). That's too
  // strict when a real listing's text matches the landmark but its commune
  // amenity tag is missing or wrong — a known real gap (see web/CLAUDE.md's
  // "no commune tag" note). Rather than presenting that as a dead end, drop
  // just the commune constraint and re-check: if the text match alone finds
  // something, use it, and say so honestly (`locationRelaxed`) instead of
  // silently pretending it was an exact match — same honesty convention as
  // `widened` in the engine's services/propertyMatching.js.
  const hasCommune = Boolean(options.commune);
  const hasSearch = typeof options.search === 'string' && options.search.trim();
  let locationRelaxed = false;

  if (total === 0 && hasCommune && hasSearch) {
    const relaxedFilters = buildFilters({ ...options, commune: undefined });
    const { rows: relaxedCountRows } = await pool.query(
      `SELECT COUNT(*) AS total ${FROM_JOINS} WHERE ${relaxedFilters.whereClause}`,
      relaxedFilters.params,
    );
    const relaxedTotal = Number.parseInt(relaxedCountRows[0].total, 10);
    if (relaxedTotal > 0) {
      whereClause = relaxedFilters.whereClause;
      params = relaxedFilters.params;
      total = relaxedTotal;
      locationRelaxed = true;
    }
  }

  // Km-radius auto-expand ladder: FilterBar.js's "Rayon" pill lets a visitor
  // pick a narrow km tier explicitly. Rather than dead-ending, step through
  // the wider km tiers in order (RADIUS_LADDER, reusing KM_RADIUS_KM as the
  // one source of truth) and use the first one that finds something — same
  // swap-only-on-success shape as the locationRelaxed block above. Only ever
  // reported honestly via requestedRadius/radiusExpanded/effectiveRadius
  // below, never presented as an exact match at the tier the visitor picked.
  //
  // Deliberately does NOT auto-continue into 'commune'/'citywide' — those
  // mean "give up on distance entirely", a bigger jump than "look a bit
  // further", and stay a manual, explicit choice via
  // ListingsEmptyState.js's real relaxation links. Also does not fire for a
  // plain quartier/commune search with no radius chosen at all — silently
  // widening every such search to citywide would destroy the informative
  // "there's genuinely nothing here" signal that empty state relies on.
  const RADIUS_LADDER = Object.keys(KM_RADIUS_KM); // ['1', '3', '5']
  const requestedRadius = options.radius || null;
  const requestedIdx = RADIUS_LADDER.indexOf(options.radius);
  let radiusExpanded = false;
  let effectiveRadius = null;

  if (total === 0 && requestedIdx !== -1) {
    for (let i = requestedIdx + 1; i < RADIUS_LADDER.length; i++) {
      const candidate = RADIUS_LADDER[i];
      const widerFilters = buildFilters({ ...options, radius: candidate });
      const { rows: widerCountRows } = await pool.query(
        `SELECT COUNT(*) AS total ${FROM_JOINS} WHERE ${widerFilters.whereClause}`,
        widerFilters.params,
      );
      const widerTotal = Number.parseInt(widerCountRows[0].total, 10);
      if (widerTotal > 0) {
        whereClause = widerFilters.whereClause;
        params = widerFilters.params;
        total = widerTotal;
        radiusExpanded = true;
        effectiveRadius = candidate;
        break;
      }
    }
  }

  const { rows: data } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${FROM_JOINS} WHERE ${whereClause}
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return {
    total,
    limit,
    offset,
    count: data.length,
    data,
    locationRelaxed,
    relaxedFromCommune: locationRelaxed ? options.commune : null,
    // Radius ladder (FilterBar.js's Rayon pill): requestedRadius is exactly
    // what the caller asked for, unchanged, so the UI can always show the
    // visitor's real choice even when wider data is what's actually
    // rendered. effectiveRadius is only set when the ladder actually fired
    // and found something ('3'|'5' — never equal to requestedRadius, never
    // 'commune'/'citywide', those stay manual).
    requestedRadius,
    radiusExpanded,
    effectiveRadius,
  };
}

/**
 * Listings by id, for the local-only Favorites page (`/favoris`): the
 * favorited ids live in the visitor's own localStorage (see lib/favorites.js
 * — there's no accounts backend), so the page needs a way to turn those ids
 * back into real listing data. Same approval filter as everywhere else — a
 * favorited listing that's since been unpublished simply drops out.
 *
 * @param {Array<number|string>} ids
 * @returns {Promise<Object[]>}
 */
export async function getListingsByIds(ids) {
  const numericIds = (ids || [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id));

  if (numericIds.length === 0) return [];

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${FROM_JOINS} WHERE ${APPROVED_FILTER} AND p.id = ANY($1) ORDER BY p.created_at DESC`,
    [numericIds],
  );
  return rows;
}

/**
 * One listing by id, including its full photo gallery — or `null` if it
 * doesn't exist OR isn't approved. The approval filter is repeated here
 * deliberately: a guessed/leaked URL to a pending listing must 404 exactly
 * like it would be absent from the grid, never partially visible.
 *
 * @param {number|string} id
 * @returns {Promise<Object|null>}
 */
/**
 * Communes ranked by how many approved listings they actually have — real,
 * derived data for the sidebar's "popular communes" list, not a fabricated
 * or hand-picked ranking. Communes with zero listings simply don't appear.
 *
 * @param {number} [limit=6]
 * @returns {Promise<Array<{commune: string, count: number}>>}
 */
export async function getPopularCommunes(limit = 6) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ac.name AS commune, COUNT(*) AS count
     FROM properties p
     JOIN property_amenities pa ON pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
     JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
     WHERE ${APPROVED_FILTER}
     GROUP BY ac.name
     ORDER BY count DESC, commune ASC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ commune: r.commune, count: Number.parseInt(r.count, 10) }));
}

export async function getListingById(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${FROM_JOINS}
     WHERE p.id = $1 AND ${APPROVED_FILTER}`,
    [numericId],
  );

  return rows[0] || null;
}

const MODERATION_STATUS_FILTERS = {
  pending: 'p.approve_status = 0',
  approved: 'p.approve_status = 1',
  rejected: 'p.approve_status = 2',
};

/**
 * Admin-only: every listing at a given moderation status, regardless of
 * `status`/`approve_status`. This is intentionally the one query in this
 * file that does NOT apply APPROVED_FILTER — callers must only ever reach it
 * from behind the /admin password gate (see middleware.js), never from a
 * public-facing page.
 *
 * @param {'pending'|'approved'|'rejected'} [status='pending']
 * @returns {Promise<Array<object>>}
 */
export async function getListingsForModeration(status = 'pending', { limit = 50 } = {}) {
  const filter = MODERATION_STATUS_FILTERS[status] ?? MODERATION_STATUS_FILTERS.pending;
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS}
     ${FROM_JOINS}
     WHERE ${filter}
     ORDER BY p.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * One showcase tile per commune: its real approved-listing count, plus the
 * photo of its most recent approved listing.
 *
 * The image is a genuine property in that commune — not stock, and not a
 * photo of somewhere else captioned as that commune. That distinction is
 * what keeps this inside CLAUDE.md's no-fabricated-data rule; the previous
 * implementation used flat CSS gradients precisely because no commune
 * photography existed, and this is the honest way to get real imagery in.
 *
 * Communes whose latest listing has no usable photo come back with
 * `image: null` and the caller falls back to the typographic treatment.
 *
 * @param {number} [limit=6]
 * @returns {Promise<Array<{commune: string, count: number, image: string|null}>>}
 */
export async function getCommuneShowcase(limit = 6) {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH tagged AS (
       SELECT ac.name AS commune, p.id, p.featured_image, p.created_at
       FROM properties p
       JOIN property_amenities pa ON pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
       JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
       WHERE ${APPROVED_FILTER}
     ),
     ranked AS (
       SELECT
         commune,
         featured_image,
         COUNT(*) OVER (PARTITION BY commune) AS listing_count,
         ROW_NUMBER() OVER (PARTITION BY commune ORDER BY created_at DESC, id DESC) AS rn
       FROM tagged
     )
     SELECT commune, listing_count, featured_image
     FROM ranked
     WHERE rn = 1
     ORDER BY listing_count DESC, commune ASC
     LIMIT $1`,
    [limit],
  );

  return rows.map((r) => ({
    commune: r.commune,
    count: Number.parseInt(r.listing_count, 10),
    image: r.featured_image || null,
  }));
}

/**
 * Which property types actually have approved listings right now, with real
 * counts — so the filter bar never offers an option that returns zero.
 *
 * This replaces a hardcoded option list. Two things made that list wrong:
 * only 'Appartement' and 'Maison' have approved rows today, and the values
 * are capitalised in the database while the filter compared lowercase, so
 * the one category anybody would pick matched nothing.
 *
 * 'parcelle' is not a category — it is `parcelle_subtype IS NOT NULL`, the
 * precise signal that a listing went through the parcelle classification
 * path — so it is counted separately and prepended when non-empty.
 *
 * @returns {Promise<Array<{value: string, label: string, count: number}>>}
 */
/**
 * The real current highest approved-listing price — feeds FilterBar.js's
 * price slider ceiling, which was a fixed $500,000 UI constant with no
 * relationship to actual inventory ("there's no live min/max-price
 * aggregate query today"). Same principle as getPropertyTypeFacets(): don't
 * hardcode a bound the database can just answer. Typing a value above the
 * ceiling into the Max input still filters correctly either way — this only
 * changes where the slider's own top end sits.
 *
 * @returns {Promise<{maxPrice: number|null}>} null when there are no
 *   approved listings with a price at all (a genuinely empty catalog),
 *   never a fabricated fallback number.
 */
export async function getPriceRange() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT MAX(p.price) AS max_price ${FROM_JOINS} WHERE ${APPROVED_FILTER} AND p.price IS NOT NULL`,
  );
  const maxPrice = Number.parseFloat(rows[0]?.max_price);
  return { maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null };
}

/**
 * Semantically similar approved listings, via pgvector cosine distance
 * (`<=>`) against the target listing's own stored embedding
 * (services/embeddings.js, engine repo — written on every publish since the
 * pgvector groundwork landed, backfilled for older rows by
 * scripts/backfill-embeddings.js). Confirmed live against production: every
 * currently-approved listing has a real, non-null embedding.
 *
 * The target's own embedding is resolved inside the query (a non-correlated
 * scalar subquery, computed once) rather than round-tripped through JS —
 * simpler than pulling the vector out, reformatting it, and passing it back
 * as a bind param. Returns [] rather than throwing when the target has no
 * embedding yet (a future listing synced through an OPENAI_API_KEY outage),
 * so the caller can fall back to the existing commune-based related rail.
 *
 * @param {number|string} id
 * @param {number} [limit=6]
 * @returns {Promise<Object[]>}
 */
export async function getSimilarListings(id, limit = 6) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId)) return [];

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT ${SELECT_FIELDS} ${FROM_JOINS}
     WHERE ${APPROVED_FILTER} AND p.id <> $1 AND p.embedding IS NOT NULL
       AND (SELECT embedding FROM properties WHERE id = $1) IS NOT NULL
     ORDER BY p.embedding <=> (SELECT embedding FROM properties WHERE id = $1)
     LIMIT $2`,
    [numericId, limit],
  );
  return rows;
}

export async function getPropertyTypeFacets() {
  const pool = getPool();

  const [categories, parcelle] = await Promise.all([
    pool.query(
      `SELECT catc.name AS label, COUNT(*) AS n
       ${FROM_JOINS}
       WHERE ${APPROVED_FILTER}
       GROUP BY catc.name
       ORDER BY n DESC, label ASC`,
    ),
    pool.query(
      `SELECT COUNT(*) AS n
       ${FROM_JOINS}
       WHERE ${APPROVED_FILTER} AND p.parcelle_subtype IS NOT NULL`,
    ),
  ]);

  const facets = categories.rows.map((r) => ({
    value: r.label.toLowerCase(),
    label: r.label,
    count: Number.parseInt(r.n, 10),
  }));

  const parcelleCount = Number.parseInt(parcelle.rows[0].n, 10);
  if (parcelleCount > 0) {
    facets.unshift({ value: 'parcelle', label: 'Parcelle', count: parcelleCount });
  }

  return facets;
}
