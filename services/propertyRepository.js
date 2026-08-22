/**
 * services/propertyRepository.js
 *
 * Read-only path into the Supabase Postgres database for the WhatsApp
 * property-search assistant (search_properties / get_property tools — see
 * services/conversationEngine.js).
 *
 * Until now this engine only ever WROTE to Supabase (services/postgres.js,
 * fire-and-forget on publish) — see the root CLAUDE.md's documented
 * architecture note "there is no read path back out of Supabase in this repo
 * today." A conversational assistant that answers "what do you have in
 * Gombe?" needs one, so this file adds it. It deliberately mirrors the exact
 * query conventions already proven in web/lib/listings.js (same repo family,
 * same database, same schema) rather than reinventing them:
 *   - The real moderation gate is `status = 1 AND approve_status = 1` (both
 *     integers) — never assume a `published` column or a string status.
 *   - `commune` is not a column: it's tagged via `property_amenities` onto
 *     one of amenity ids 21-44, joined through `amenity_contents`.
 *   - `property_contents` carries title/address at `language_id = 20`.
 *
 * Same connection posture as services/postgres.js: lazy pool, `isConfigured()`
 * gate, `ssl: { rejectUnauthorized: false }` for Supabase's pooler. A search
 * attempted before DB_HOST/DB_USER/DB_PASSWORD/DB_NAME are set returns an
 * empty result rather than throwing — see AI safety rule in
 * services/conversationEngine.js: no properties found must never be
 * confused with "search failed", but neither should ever be reported as if
 * real listings were checked when they weren't.
 */

const { Pool } = require('pg');

const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

const APPROVED_FILTER = 'p.status = 1 AND p.approve_status = 1';

function isConfigured() {
  return Boolean(
    process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME,
  );
}

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

const COMMUNE_SUBQUERY = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
) AS commune`;

const SELECT_FIELDS = `
  p.id, p.price, p.purpose, p.beds, p.bath, p.area, p.quartier,
  p.parcelle_subtype, p.units_count, p.reference, p.featured_image,
  p.created_at,
  pc.title, pc.slug, pc.address,
  catc.name AS category_name,
  ${COMMUNE_SUBQUERY}
`;

const FROM_JOINS = `
  FROM properties p
  JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
  JOIN property_categories cat ON cat.id = p.category_id
  JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = ${CATEGORY_LANGUAGE_ID}
`;

const TRANSACTION_TYPE_TO_PURPOSE = { location: 'rent', vente: 'sale' };

const SEARCH_LIMIT_DEFAULT = 8;
const SEARCH_LIMIT_MAX = 20;

/**
 * Build the WHERE clause + params shared by searchProperties and its count.
 * Same filtering rules as web/lib/listings.js's buildFilters, minus the
 * free-text `search` param (the assistant's requirements are already
 * structured by the time they reach here — see conversationEngine.js's
 * extractRequirements).
 */
function buildFilters({
  transactionType, propertyType, parcelleSubtype, commune, quartier,
  priceMin, priceMax, bedsMin,
} = {}) {
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

  if (propertyType === 'appartement') {
    where.push(`catc.name = 'appartement'`);
  } else if (propertyType === 'parcelle') {
    where.push('p.parcelle_subtype IS NOT NULL');
    if (parcelleSubtype) {
      params.push(parcelleSubtype);
      where.push(`p.parcelle_subtype = $${params.length}`);
    }
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

  return { whereClause: where.join(' AND '), params };
}

/**
 * Search real, approved listings for the WhatsApp assistant's
 * `search_properties` tool. Never fabricated: an unconfigured database or a
 * genuine query error both return `{ data: [], total: 0 }` rather than
 * throwing, so a tool-calling loop always gets a well-formed (possibly
 * empty) result to reason about — see services/conversationEngine.js for
 * how "zero results" and "search unavailable" are told apart for the user.
 *
 * @param {Object} [criteria] Same shape as web/lib/listings.js's getListings filters.
 * @param {number} [criteria.limit]
 * @returns {Promise<{total: number, data: Object[], error: boolean}>}
 */
async function searchProperties(criteria = {}) {
  if (!isConfigured()) {
    return { total: 0, data: [], error: true };
  }

  const { whereClause, params } = buildFilters(criteria);

  const parsedLimit = Number.parseInt(criteria.limit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), SEARCH_LIMIT_MAX)
    : SEARCH_LIMIT_DEFAULT;

  try {
    const client = getPool();

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) AS total ${FROM_JOINS} WHERE ${whereClause}`,
      params,
    );
    const total = Number.parseInt(countRows[0].total, 10);

    const { rows: data } = await client.query(
      `SELECT ${SELECT_FIELDS} ${FROM_JOINS} WHERE ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit],
    );

    return { total, data, error: false };
  } catch (err) {
    console.error(`[propertyRepository] searchProperties failed: ${err.message}`);
    return { total: 0, data: [], error: true };
  }
}

/**
 * One approved listing by id, for `get_property` — or `null` if it doesn't
 * exist, isn't approved, or the database is unreachable. Callers must treat
 * `null` as "say this isn't available", never retry with fabricated data.
 *
 * @param {number|string} id
 * @returns {Promise<Object|null>}
 */
async function getPropertyById(id) {
  const numericId = Number.parseInt(id, 10);
  if (!Number.isFinite(numericId) || !isConfigured()) return null;

  try {
    const client = getPool();
    const { rows } = await client.query(
      `SELECT ${SELECT_FIELDS}, pc.description
       ${FROM_JOINS}
       WHERE p.id = $1 AND ${APPROVED_FILTER}`,
      [numericId],
    );
    return rows[0] || null;
  } catch (err) {
    console.error(`[propertyRepository] getPropertyById(${id}) failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  isConfigured,
  searchProperties,
  getPropertyById,
  buildFilters,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
};
