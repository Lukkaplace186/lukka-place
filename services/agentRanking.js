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
 *   verified       10 agents.phone_verified_at IS NOT NULL — now also a hard
 *                     filter (the shared agent gate, 2026-11-09), so every
 *                     ranked agent scores it; kept so scores stay comparable.
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
      AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
      AND LOWER(ac.name) = LOWER($1)
  )
`;

/**
 * "Portfolio up to date" (2026-11-09, owner decision: an incentive to answer
 * the fortnightly availability check). A listing is up to date when its own
 * agent confirmed it within UP_TO_DATE_DAYS (properties.availability_confirmed_at)
 * or — never confirmed — it went public within that window (the later of
 * created_at and moderated_at, web/lib/listings.js PUBLISHED_AT_EXPR), so a
 * brand-new listing counts. Both columns are read through to_jsonb(p) so a
 * database without them reads NULL instead of raising 42703. Same rule as
 * web/lib/listings.js UP_TO_DATE_SQL (and its 14 days is web's
 * CONFIRM_AFTER_DAYS) — change one, change the other.
 */
const UP_TO_DATE_DAYS = 14;
const UP_TO_DATE_SQL = `(COALESCE(
    NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
    GREATEST(p.created_at, COALESCE(NULLIF(to_jsonb(p) ->> 'moderated_at', '')::timestamptz, p.created_at))
  ) >= NOW() - interval '${UP_TO_DATE_DAYS} days')`;

/** Public and still on the market: the public gate, not let / sold. */
const LIVE_LISTING_FILTER = `${PUBLIC_LISTING_FILTER} AND p.listing_status IS DISTINCT FROM 'closed'`;

/**
 * The agents among `agentIds` whose portfolio is up to date: at least one
 * live listing, and every live listing up to date (a NULL date counts as
 * stale). Used by services/leadDispatch.js as a small boost and tie-breaker,
 * never as a filter — an agent missing from this set is still ranked.
 *
 * Never throws: any failure (Postgres down, an unexpected 42703) is logged and
 * answers "nobody", i.e. no boost for anyone, which is today's ranking.
 *
 * @param {number[]} agentIds
 * @returns {Promise<Set<number>>}
 */
async function upToDateAgentIds(agentIds) {
  const ids = [...new Set((agentIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0 || !isConfigured()) return new Set();
  try {
    const { rows } = await getPool().query(UP_TO_DATE_AGENTS_SQL, [ids]);
    return new Set(rows.map((r) => Number(r.agent_id)));
  } catch (err) {
    console.warn(`[agentRanking] portfolio freshness unavailable (${err.code || 'error'}): ${err.message} — no boost`);
    return new Set();
  }
}

const UP_TO_DATE_AGENTS_SQL = `
  SELECT p.agent_id
    FROM properties p
   WHERE p.agent_id = ANY($1::int[])
     AND ${LIVE_LISTING_FILTER}
   GROUP BY p.agent_id
  HAVING COUNT(*) > 0
     AND COUNT(*) FILTER (WHERE ${UP_TO_DATE_SQL} IS NOT TRUE) = 0`;

/**
 * Portfolio signals for the priority level (services/agentPriority.js,
 * 2026-11-10): per agent, live listings, how many of them are NOT up to date
 * (same rule as UP_TO_DATE_SQL), and the last time a listing of theirs went
 * public (created_at / moderated_at). An agent with no row has no live
 * listing and published nothing.
 */
const PORTFOLIO_SIGNALS_SQL = `
  SELECT p.agent_id,
         COUNT(*) FILTER (WHERE ${LIVE_LISTING_FILTER})                                     AS live,
         COUNT(*) FILTER (WHERE ${LIVE_LISTING_FILTER} AND ${UP_TO_DATE_SQL} IS NOT TRUE)   AS stale,
         MAX(GREATEST(p.created_at, COALESCE(NULLIF(to_jsonb(p) ->> 'moderated_at', '')::timestamptz, p.created_at)))
           FILTER (WHERE p.approve_status = 1)                                              AS last_published_at
    FROM properties p
   WHERE p.agent_id = ANY($1::int[])
   GROUP BY p.agent_id`;

/**
 * @param {number[]} agentIds
 * @returns {Promise<Map<number, {live: number, stale: number, lastPublishedAt: Date|null}>|null>}
 *   null when Postgres cannot answer (the caller then gives nobody portfolio points).
 */
async function portfolioSignals(agentIds) {
  const ids = [...new Set((agentIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return new Map();
  if (!isConfigured()) return null;
  try {
    const { rows } = await getPool().query(PORTFOLIO_SIGNALS_SQL, [ids]);
    return new Map(rows.map((r) => [Number(r.agent_id), {
      live: Number(r.live) || 0,
      stale: Number(r.stale) || 0,
      lastPublishedAt: r.last_published_at ? new Date(r.last_published_at) : null,
    }]));
  } catch (err) {
    console.warn(`[agentRanking] portfolio signals unavailable (${err.code || 'error'}): ${err.message}`);
    return null;
  }
}

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
        -- The shared agent gate (CLAUDE.md, "Agent gates are shared"): a
        -- request is only pushed to a number the agent proved they hold, on an
        -- account not deleted, with direct routing not switched off. Before
        -- 2026-11-09 verification only added 10 points here, so a lead could
        -- be pushed to an unverified or deleted agent.
        AND a.phone_verified_at IS NOT NULL
        AND a.deleted_at IS NULL
        AND a.direct_routing_enabled IS DISTINCT FROM false
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
  upToDateAgentIds,
  portfolioSignals,
  PORTFOLIO_SIGNALS_SQL,
  MAX_AGENTS_PER_LEAD,
  UP_TO_DATE_DAYS,
  UP_TO_DATE_SQL,
  UP_TO_DATE_AGENTS_SQL,
};
