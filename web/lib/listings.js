import 'server-only';
import { getPool } from './db';

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
// with no agent attached must still return, with these three columns NULL,
// not disappear from the feed. `agents.image`/`agents.phone` are whatever
// the Laravel admin form eventually lets a team member enter — no known
// URL-prefixing convention for `image` was verified, so it's selected as-is
// and the UI (AgencyLogo.js) falls back to text on a load failure rather
// than assuming a base path that might be wrong.
const SELECT_FIELDS = `
  p.id, p.price, p.purpose, p.beds, p.bath, p.area, p.quartier,
  p.parcelle_subtype, p.units_count, p.reference, p.featured_image,
  p.created_at, p.price_period, p.deposit_months,
  pc.title, pc.slug, pc.address,
  catc.name AS category_name,
  pc.description,
  a.image AS agency_logo_url, a.username AS agency_name, a.phone AS agent_phone,
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

/**
 * "St"/"Ste" <-> "Saint"/"Sainte" is a generic French abbreviation, not a
 * fact about any one place — an agent writing a listing description might
 * spell a landmark either way ("paroisse St Luc" vs "paroisse Saint Luc"),
 * and `ILIKE '%St Luc%'` does not substring-match "Saint Luc" or vice versa.
 * Expanding both directions here means the search box doesn't need a
 * hand-maintained alias table per landmark — it works for any "St ___" name
 * a landmark's real gazetteer label (lib/data/kinshasa-gazetteer.json) or a
 * visitor's typed query happens to use.
 */
function abbreviationVariants(term) {
  const variants = new Set([term]);

  const expanded = term.replace(/\bste\.?(?=\s|$)/gi, 'Sainte').replace(/\bst\.?(?=\s|$)/gi, 'Saint');
  if (expanded !== term) variants.add(expanded);

  const abbreviated = term.replace(/\bsainte\b/gi, 'Ste').replace(/\bsaint\b/gi, 'St');
  if (abbreviated !== term) variants.add(abbreviated);

  return Array.from(variants);
}

const LISTINGS_LIMIT_DEFAULT = 12; // 12 cards per feed page
const LISTINGS_LIMIT_MAX = 60;

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
function buildFilters({ transactionType, propertyType, parcelleSubtype, commune, quartier, priceMin, priceMax, bedsMin, bathMin, areaMin, search, excludeId }) {
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

  // `area` is a TEXT column holding m2 as a string ('95', and '0' rather
  // than NULL when unknown). Strip every non-digit before casting so a
  // malformed value becomes NULL instead of erroring the whole query.
  const minArea = Number.parseInt(areaMin, 10);
  if (Number.isFinite(minArea) && minArea > 0) {
    params.push(minArea);
    where.push(`NULLIF(regexp_replace(COALESCE(p.area, ''), '[^0-9]', '', 'g'), '')::numeric >= $${params.length}`);
  }

  // Used by the detail page's "other properties in this commune" rail so a
  // listing never recommends itself.
  const excluded = Number.parseInt(excludeId, 10);
  if (Number.isFinite(excluded)) {
    params.push(excluded);
    where.push(`p.id <> $${params.length}`);
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

  if (commune) {
    params.push(commune);
    where.push(`EXISTS (
      SELECT 1 FROM property_amenities pa
      JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
      WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name = $${params.length}
    )`);
  }

  if (quartier) {
    params.push(quartier);
    where.push(`p.quartier = $${params.length}`);
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
 * @param {number} [options.priceMin]
 * @param {number} [options.priceMax]
 * @param {number} [options.bedsMin] Minimum bedrooms (`p.beds >= bedsMin`).
 * @param {string} [options.search] Free-text match against title/description/address/quartier/reference/commune.
 * @param {'newest'|'price_asc'|'price_desc'} [options.sort='newest']
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {Promise<{total: number, limit: number, offset: number, count: number, data: Object[], locationRelaxed: boolean, relaxedFromCommune: string|null}>}
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
