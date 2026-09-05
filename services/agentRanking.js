/**
 * services/agentRanking.js
 *
 * Ranks real, registered agencies against one customer request, and returns
 * the best N (7 by default).
 *
 * WHY THIS LIVES IN THE ENGINE, NOT IN web/
 * -----------------------------------------
 * The matching has to be event-driven — scored and pushed the instant a
 * request is created — and requests are created in three different places:
 * the customer portal's "Trouver pour moi" form (web/ -> POST /admin/leads),
 * the WhatsApp buyer assistant's `create_enquiry` tool
 * (services/openai.js -> services/db.js directly), and the agent-profile
 * inquiry form (web/ -> POST /admin/leads again). Only the engine sits
 * downstream of all three, and only the engine holds the WhatsApp
 * credentials that make a push possible at all. Putting the dispatcher in
 * web/ would leave every WhatsApp-originated request unmatched.
 *
 * The engine already has a real Postgres pool (services/postgres.js) for the
 * listing sync, so reading `agents` here is not a new dependency.
 *
 * THE SCORE
 * ---------
 * Every signal below is a real column or a real count. Nothing is invented,
 * and an agency missing a signal is neutral on it rather than penalised into
 * oblivion — a brand-new agency has to be reachable, or the platform can
 * never onboard anyone into the rotation.
 *
 *   coverage      50  the request's commune is one of the agency's PRIMARY
 *                     communes (agents.primary_communes — their stated
 *                     specialty)
 *                 20  it's in their wider serviced area
 *                     (agents.serviced_communes) but not a specialty
 *                     Agencies matching neither are excluded entirely by the
 *                     WHERE clause — this is a local-knowledge product, and
 *                     pushing a Gombe request to a Ngaliema-only agency is
 *                     exactly the noise that trains agents to ignore alerts.
 *   inventory   0-25  real approved, live listings this agency holds IN that
 *                     commune (5 each, capped). An agency with matching
 *                     stock can answer today.
 *   fit         0-15  real listings in that commune that also fit the budget
 *                     and bedroom count asked for. Strictly stronger evidence
 *                     than raw inventory, so it scores on top of it.
 *   verified       10 agents.phone_verified_at IS NOT NULL — we can actually
 *                     reach them on WhatsApp, which is the entire delivery
 *                     mechanism.
 *
 * multiplied by the subscription tier's `packages.priority_multiplier`
 * (default 1.0 — an unsubscribed agency is not excluded, just unweighted),
 * and then adjusted for responsiveness and fairness by the caller
 * (services/leadDispatch.js), which owns the signals that live in SQLite.
 *
 * The ordering is computed in SQL rather than in JS so that LIMIT actually
 * means "the best N" at the database, instead of fetching every agency in
 * the city and sorting a page of them in memory.
 */

const { getPool, isConfigured } = require('./postgres');

/** The cap the whole matching product is specified around. */
const MAX_AGENTS_PER_LEAD = 7;

/**
 * Real approved-and-public gate, identical to the one every read in
 * web/lib/listings.js applies (CLAUDE.md: `status` and `approve_status` are
 * integers, and there is no row-level security backing this up). Repeated
 * here rather than imported because the two apps don't share a module.
 */
const PUBLIC_LISTING_FILTER = 'p.status = 1 AND p.approve_status = 1';

/**
 * Commune is not a column on `properties` — it's tagged via
 * `property_amenities` onto one of amenity ids 21-44 (see
 * services/postgres.js's COMMUNE_AMENITY_IDS). Counting an agency's listings
 * "in this commune" therefore means an EXISTS against that join, not
 * `WHERE commune = $1`.
 */
const COMMUNE_MATCH = `
  EXISTS (
    SELECT 1 FROM property_amenities pa
    JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
    WHERE pa.property_id = p.id
      AND pa.amenity_id BETWEEN 21 AND 44
      AND LOWER(ac.name) = LOWER($1)
  )
`;

/**
 * @param {Object} request
 * @param {string} request.commune           Canonical commune name (already resolved via services/locations.js).
 * @param {number|null} [request.priceMax]   Budget ceiling in USD.
 * @param {number|null} [request.priceMin]
 * @param {number|null} [request.bedrooms]
 * @param {string|null} [request.transactionType] 'location' | 'vente' — mapped to properties.purpose.
 * @param {number} [limit]
 * @returns {Promise<Array<{agent_id: number, phone: string, display_name: string, agency_name: string|null,
 *   base_score: number, priority_multiplier: number, matching_listings: number, fitting_listings: number,
 *   is_primary: boolean}>>}
 */
async function rankAgentsForRequest(
  { commune, priceMin = null, priceMax = null, bedrooms = null, transactionType = null },
  limit = MAX_AGENTS_PER_LEAD,
) {
  if (!isConfigured()) {
    console.warn('[agentRanking] Postgres is not configured — no agents can be ranked');
    return [];
  }
  if (!commune) return [];

  // 'location' -> rent, 'vente' -> sale. The engine's own vocabulary is
  // French (services/openai.js), Postgres' `purpose` is English — the same
  // mapping services/postgres.js already applies on the write side.
  const purpose = transactionType === 'vente' ? 'sale' : transactionType === 'location' ? 'rent' : null;

  const sql = `
    WITH scoped AS (
      SELECT
        a.id,
        a.phone,
        a.username,
        a.agency_name,
        a.primary_communes,
        a.phone_verified_at,
        COALESCE(ai.first_name || ' ' || COALESCE(ai.last_name, ''), a.username) AS display_name,
        COALESCE(pkg.priority_multiplier, 1.0) AS priority_multiplier,
        (
          SELECT COUNT(*) FROM properties p
          WHERE p.agent_id = a.id
            AND ${PUBLIC_LISTING_FILTER}
            AND p.listing_status = 'active'
            AND ${COMMUNE_MATCH}
        ) AS matching_listings,
        (
          SELECT COUNT(*) FROM properties p
          WHERE p.agent_id = a.id
            AND ${PUBLIC_LISTING_FILTER}
            AND p.listing_status = 'active'
            AND ${COMMUNE_MATCH}
            AND ($2::numeric IS NULL OR p.price IS NULL OR p.price <= $2::numeric)
            AND ($3::numeric IS NULL OR p.price IS NULL OR p.price >= $3::numeric)
            AND ($4::int     IS NULL OR p.beds  IS NULL OR ABS(p.beds - $4::int) <= 1)
            AND ($5::text    IS NULL OR p.purpose = $5::text)
        ) AS fitting_listings
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT first_name, last_name FROM agent_infos
        WHERE agent_id = a.id
        ORDER BY (language_id = 20) DESC, language_id
        LIMIT 1
      ) ai ON true
      LEFT JOIN LATERAL (
        SELECT package_id FROM memberships
        WHERE vendor_id = a.vendor_id AND status = 1 AND expire_date > NOW()
        ORDER BY expire_date DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN packages pkg ON pkg.id = m.package_id
      WHERE a.status = 1
        AND a.phone IS NOT NULL
        AND a.phone <> ''
        -- Coverage is the hard filter. LOWER() on both sides because
        -- primary_communes is agent-entered through a checkbox list built
        -- from the canonical hierarchy, while a lead's commune comes from the
        -- AI extractor via services/locations.js — both resolve to the same
        -- names, but case has drifted before.
        AND (
          EXISTS (SELECT 1 FROM unnest(COALESCE(a.primary_communes,  '{}')) c WHERE LOWER(c) = LOWER($1))
          OR
          EXISTS (SELECT 1 FROM unnest(COALESCE(a.serviced_communes, '{}')) c WHERE LOWER(c) = LOWER($1))
        )
    )
    SELECT
      id AS agent_id,
      phone,
      display_name,
      agency_name,
      priority_multiplier,
      matching_listings,
      fitting_listings,
      EXISTS (SELECT 1 FROM unnest(COALESCE(primary_communes, '{}')) c WHERE LOWER(c) = LOWER($1)) AS is_primary,
      (
        CASE WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(primary_communes, '{}')) c WHERE LOWER(c) = LOWER($1))
             THEN 50 ELSE 20 END
        + LEAST(matching_listings * 5, 25)
        + LEAST(fitting_listings * 5, 15)
        + CASE WHEN phone_verified_at IS NOT NULL THEN 10 ELSE 0 END
      ) * COALESCE(priority_multiplier, 1.0) AS base_score
    FROM scoped
    ORDER BY base_score DESC, matching_listings DESC, id ASC
    LIMIT $6
  `;

  const { rows } = await getPool().query(sql, [
    commune,
    priceMax,
    priceMin,
    bedrooms,
    purpose,
    // Over-fetch: the caller applies responsiveness and fairness adjustments
    // that can reorder this list, and trimming to exactly `limit` here would
    // mean an agency ranked 8th on the raw score could never be promoted past
    // a 7th that has ignored its last ten pushes.
    Math.max(limit * 3, limit),
  ]);

  return rows.map((r) => ({
    ...r,
    agent_id: Number(r.agent_id),
    base_score: Number(r.base_score),
    priority_multiplier: Number(r.priority_multiplier),
    matching_listings: Number(r.matching_listings),
    fitting_listings: Number(r.fitting_listings),
    display_name: (r.display_name || '').trim() || null,
  }));
}

module.exports = {
  rankAgentsForRequest,
  MAX_AGENTS_PER_LEAD,
};
