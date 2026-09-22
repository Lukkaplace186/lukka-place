import 'server-only';
import { getPool } from './db';
import { listingGaps, profileGaps } from './completenessRules';

/**
 * Profile and listing completeness for the agent dashboard — the data half.
 * The rules (which codes, which thresholds, where each is fixed) live in
 * lib/completenessRules.js so client components can share them; this module
 * only reads the rows those rules are applied to.
 *
 * `getIncompleteListings(agentId, { limit })` is a CONTRACT: another surface
 * (the agent's to-do list) consumes `[{ id, title, gaps: [code] }]` exactly.
 * Change the shape only together with that consumer.
 */

export { listingGaps, profileGaps } from './completenessRules';

const CONTENT_LANGUAGE_ID = 20;

/*
 * Only listings still in play. A closed transaction or an archived listing is
 * off the market, and asking an agent to add photos to a flat that was let
 * last month is noise. Ownership is in the WHERE clause, not the caller.
 *
 * Photo count: property_slider_images is the gallery (attachListingPhotos /
 * setListingGallery write the cover into it too); a listing that somehow has
 * a cover and no gallery rows still has one photo, not zero.
 */
const LISTING_GAP_SQL = `
  SELECT p.id, pc.title, pc.description, p.price, p.purpose, p.deposit_months,
         p.latitude, p.longitude, p.quartier,
         GREATEST(
           (SELECT count(*) FROM property_slider_images psi WHERE psi.property_id = p.id),
           CASE WHEN NULLIF(TRIM(p.featured_image), '') IS NULL THEN 0 ELSE 1 END
         )::int AS photo_count,
         (
           SELECT ac.name FROM property_amenities pa
           JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
           WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
           LIMIT 1
         ) AS commune
  FROM properties p
  JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
  WHERE p.agent_id = $2
    AND p.listing_status IS DISTINCT FROM 'closed'
    AND p.archived_at IS NULL
  ORDER BY p.created_at DESC, p.id DESC
`;

/**
 * Every in-play listing of this agent with its gap codes (an empty array for a
 * complete one). One query; the per-agent listing count is bounded by the plan
 * (packages.number_of_property), so computing the codes in JS keeps exactly
 * one definition of each rule instead of a SQL copy that could drift.
 *
 * @returns {Promise<Array<{id: number, title: string, gaps: string[], photoCount: number}>>}
 */
export async function getAgentListingGaps(agentId) {
  const id = Number(agentId);
  if (!Number.isSafeInteger(id) || id <= 0) return [];
  const { rows } = await getPool().query(LISTING_GAP_SQL, [CONTENT_LANGUAGE_ID, id]);
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title || '',
    gaps: listingGaps(row),
    photoCount: Number(row.photo_count) || 0,
  }));
}

/**
 * The agent's listings that still have something to fix, newest first.
 * Never throws: a read failure is logged and reads as "nothing listed", so a
 * consumer's to-do list degrades to empty rather than taking its page down.
 *
 * @param {number|string} agentId
 * @param {{limit?: number}} [options]
 * @returns {Promise<Array<{id: number, title: string, gaps: string[]}>>}
 */
export async function getIncompleteListings(agentId, { limit = 10 } = {}) {
  const cap = Math.max(1, Math.min(Number.parseInt(limit, 10) || 10, 200));
  try {
    const all = await getAgentListingGaps(agentId);
    return all
      .filter((listing) => listing.gaps.length > 0)
      .slice(0, cap)
      .map(({ id, title, gaps }) => ({ id, title, gaps }));
  } catch (err) {
    console.error(`[completeness] incomplete listings unavailable: ${err.message}`);
    return [];
  }
}

/**
 * Profile gaps for an agent row as lib/agents.js's AGENT_FIELDS returns it.
 * `serviced_communes` is not in that shared field list (it feeds matching,
 * not display), so it is read here rather than widening every agent query.
 */
export async function getAgentProfileGaps(agent) {
  if (!agent) return [];
  let serviced = agent.serviced_communes;
  if (serviced === undefined) {
    const { rows } = await getPool().query('SELECT serviced_communes FROM agents WHERE id = $1', [agent.id]);
    serviced = rows[0]?.serviced_communes ?? null;
  }
  return profileGaps({ ...agent, serviced_communes: serviced });
}

/**
 * The paid photography package, read live — its title and price are
 * whatever /admin/subscriptions says today, never a figure typed here. Found
 * by name because `packages` has no kind column; an active, undeleted row
 * whose title mentions "photo" is the service. None → no offer shown.
 *
 * @returns {Promise<{id: number, title: string, price: number, term: string}|null>}
 */
export async function getPhotographyOffer() {
  const { rows } = await getPool().query(
    `SELECT id, title, price, term FROM packages
     WHERE status = 1 AND deleted_at IS NULL AND LOWER(title) LIKE '%photo%'
     ORDER BY price ASC, id ASC
     LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const price = Number(row.price);
  return { id: Number(row.id), title: row.title, price: Number.isFinite(price) ? price : null, term: row.term };
}
