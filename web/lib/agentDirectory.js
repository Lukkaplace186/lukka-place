import 'server-only';
import { getPool } from './db';
import { vendorNameSql } from './vendorName';
import { communesOfCity } from './cities';
import { MIN_PUBLIC_REVIEWS } from './agentReviews';
import { DIRECTORY_PAGE_SIZE, foldSearchText } from './agentDirectoryRules';

/**
 * Public agent directory (/agents). One page of agents per request, filtered
 * and counted in SQL — it replaced getPublicAgents(), which loaded every
 * agent with two correlated counts and filtered in JS.
 *
 * Who is listed: an active, non-deleted agent with at least one live listing
 * (the public gate, status = 1 AND approve_status = 1). An account with
 * nothing online leads a visitor to an empty page, so it is not listed.
 *
 * The phone is selected only under the listing page's own rule (verified
 * number AND direct routing not switched off — lib/listings.js
 * agent_phone); everybody else's card has no call or WhatsApp button.
 */

const CONTENT_LANGUAGE_ID = 20;
const PURPOSE = { location: 'rent', vente: 'sale' };

// translate() folds the accents French names carry; the term is folded the
// same way in JS (foldSearchText), so "Kabila" finds "Kabilá" and back.
const FOLD_FROM = 'àáâäãåèéêëìíîïòóôöõùúûüçñÀÁÂÄÃÅÈÉÊËÌÍÎÏÒÓÔÖÕÙÚÛÜÇÑ';
const FOLD_TO = 'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn';
const fold = (expr) => `translate(lower(${expr}), '${FOLD_FROM}', '${FOLD_TO}')`;

function likeTerm(value) {
  const term = foldSearchText(value).trim();
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const LIVE_COMMUNE_SQL = (param) => `EXISTS (
  SELECT 1 FROM properties lp
  JOIN property_amenities pa ON pa.property_id = lp.id
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE lp.agent_id = a.id AND lp.status = 1 AND lp.approve_status = 1
    AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
    AND ac.name = ANY(${param}::text[])
)`;

const VERIFIED_SQL = `COALESCE((to_jsonb(a) ->> 'verification_level') IN ('verified', 'agency_partner'), false)`;

const ORDER_BY = {
  listings: `${VERIFIED_SQL} DESC, live.live_count DESC, a.id`,
  rating: `(COALESCE(r.review_count, 0) >= ${MIN_PUBLIC_REVIEWS}) DESC, r.average_stars DESC NULLS LAST, live.live_count DESC, a.id`,
  recent: 'live.latest_at DESC NULLS LAST, a.id',
};

/** Exported for the SQL-text test. */
export function buildDirectoryQuery(params, { withRatings = true } = {}) {
  const values = [];
  const where = ['a.status = 1', 'a.deleted_at IS NULL'];

  const term = likeTerm(params.q);
  if (term) {
    values.push(term);
    const n = values.length;
    where.push(`(${fold("concat_ws(' ', ai.first_name, ai.last_name)")} LIKE $${n}
      OR ${fold("COALESCE(a.agency_name, '')")} LIKE $${n}
      OR ${fold(vendorNameSql('v'))} LIKE $${n})`);
  }

  // A commune narrows to that commune; a city alone, to any of its communes.
  // An agent matches by the communes they declared OR by a live listing there.
  const communes = params.commune ? [params.commune] : params.ville ? communesOfCity(params.ville) : [];
  if (communes.length > 0) {
    values.push(communes);
    const n = values.length;
    where.push(`(COALESCE(a.primary_communes, '{}') && $${n}::text[]
      OR COALESCE(a.serviced_communes, '{}') && $${n}::text[]
      OR ${LIVE_COMMUNE_SQL(`$${n}`)})`);
  }

  if (params.offre === 'location') where.push('live.rent_count > 0');
  if (params.offre === 'vente') where.push('live.sale_count > 0');
  if (params.verifies) where.push(VERIFIED_SQL);

  const ratingJoin = withRatings
    ? `LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS review_count, AVG(stars)::float AS average_stars
           FROM agent_reviews WHERE agent_id = a.id
       ) r ON true`
    : 'LEFT JOIN LATERAL (SELECT NULL::int AS review_count, NULL::float AS average_stars) r ON true';

  // Without the reviews table a "best rated" sort has nothing to sort by.
  const tri = !withRatings && params.tri === 'rating' ? 'listings' : params.tri;
  const order = ORDER_BY[tri] || ORDER_BY.listings;

  values.push(DIRECTORY_PAGE_SIZE, (params.page - 1) * DIRECTORY_PAGE_SIZE);
  const limitIdx = values.length - 1;

  // verification_level goes through jsonb (lib/agents.js does the same) so
  // the page works on a database without that column.
  const sql = `
    WITH live AS (
      SELECT p.agent_id,
             COUNT(*)::int AS live_count,
             (COUNT(*) FILTER (WHERE p.purpose = '${PURPOSE.location}'))::int AS rent_count,
             (COUNT(*) FILTER (WHERE p.purpose = '${PURPOSE.vente}'))::int AS sale_count,
             MAX(p.created_at) AS latest_at
        FROM properties p
       WHERE p.status = 1 AND p.approve_status = 1 AND p.agent_id IS NOT NULL
       GROUP BY p.agent_id
    )
    SELECT a.id, a.image, a.agency_name, a.primary_communes, a.serviced_communes,
           ${vendorNameSql('v')} AS vendor_name,
           to_jsonb(a) ->> 'verification_level' AS verification_level,
           CASE WHEN a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE
                THEN a.phone END AS contact_phone,
           live.live_count, live.rent_count, live.sale_count,
           r.review_count, r.average_stars,
           COUNT(*) OVER ()::int AS total_count
      FROM agents a
      JOIN live ON live.agent_id = a.id
      LEFT JOIN vendors v ON v.id = a.vendor_id
      LEFT JOIN LATERAL (
        SELECT first_name, last_name FROM agent_infos
         WHERE agent_id = a.id
         ORDER BY (language_id = ${CONTENT_LANGUAGE_ID}) DESC, language_id
         LIMIT 1
      ) ai ON true
      ${ratingJoin}
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`;

  return { sql, values };
}

/**
 * One page of the directory: `{ agents, total }`. Never throws — a database
 * error renders an empty directory with a note rather than a 500 (`failed`).
 */
export async function getAgentDirectory(params) {
  const pool = getPool();
  try {
    const { sql, values } = buildDirectoryQuery(params);
    const { rows } = await pool.query(sql, values);
    return { agents: rows, total: rows[0]?.total_count ?? 0, failed: false };
  } catch (err) {
    // agent_reviews is an engine migration; before it runs the list still works.
    if (err?.code === '42P01') {
      try {
        const { sql, values } = buildDirectoryQuery(params, { withRatings: false });
        const { rows } = await pool.query(sql, values);
        return { agents: rows, total: rows[0]?.total_count ?? 0, failed: false };
      } catch (retryErr) {
        console.error(`[agentDirectory] ${retryErr.message}`);
        return { agents: [], total: 0, failed: true };
      }
    }
    console.error(`[agentDirectory] ${err.message}`);
    return { agents: [], total: 0, failed: true };
  }
}
