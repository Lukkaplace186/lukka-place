import 'server-only';
import { getPool } from './db';
import { vendorNameSql } from './vendorName';
import { CITIES, communesOfCity } from './cities';
import { MIN_PUBLIC_REVIEWS } from './agentReviews';
import { DIRECTORY_PAGE_SIZE, foldSearchText, nameQuery } from './agentDirectoryRules';

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

/**
 * The communes a search narrows to: the chosen ones, else every commune of
 * the chosen city, else none (the whole country).
 */
function searchedCommunes(params) {
  if (params.communes?.length) return params.communes;
  return params.ville ? communesOfCity(params.ville) : [];
}

/**
 * The WHERE every directory read shares: active, not deleted, the name search
 * (unless the text was read as a place), rent/sale, the verified tier — and
 * the communes, unless `withCommunes` is false (the chip counts, which must
 * count every commune whatever is chosen). Pushes its parameters onto `values`.
 */
function directoryWhere(params, values, { withCommunes = true } = {}) {
  const where = ['a.status = 1', 'a.deleted_at IS NULL'];

  const term = likeTerm(nameQuery(params));
  if (term) {
    values.push(term);
    const n = values.length;
    where.push(`(${fold("concat_ws(' ', ai.first_name, ai.last_name)")} LIKE $${n}
      OR ${fold("COALESCE(a.agency_name, '')")} LIKE $${n}
      OR ${fold(vendorNameSql('v'))} LIKE $${n})`);
  }

  // An agent matches a commune by the communes they declared OR by a live
  // listing there; several communes are an OR.
  const communes = withCommunes ? searchedCommunes(params) : [];
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
  return where;
}

/** Every listed agent is one with at least one live listing. */
const LIVE_CTE = `live AS (
      SELECT p.agent_id,
             COUNT(*)::int AS live_count,
             (COUNT(*) FILTER (WHERE p.purpose = '${PURPOSE.location}'))::int AS rent_count,
             (COUNT(*) FILTER (WHERE p.purpose = '${PURPOSE.vente}'))::int AS sale_count,
             MAX(p.created_at) AS latest_at
        FROM properties p
       WHERE p.status = 1 AND p.approve_status = 1 AND p.agent_id IS NOT NULL
       GROUP BY p.agent_id
    )`;

const AGENT_JOINS = `FROM agents a
      JOIN live ON live.agent_id = a.id
      LEFT JOIN vendors v ON v.id = a.vendor_id
      LEFT JOIN LATERAL (
        SELECT first_name, last_name FROM agent_infos
         WHERE agent_id = a.id
         ORDER BY (language_id = ${CONTENT_LANGUAGE_ID}) DESC, language_id
         LIMIT 1
      ) ai ON true`;

/** Exported for the SQL-text test. */
export function buildDirectoryQuery(params, { withRatings = true } = {}) {
  const values = [];
  const where = directoryWhere(params, values);

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
    WITH ${LIVE_CTE}
    SELECT a.id, a.image, a.agency_name, a.primary_communes, a.serviced_communes,
           ${vendorNameSql('v')} AS vendor_name,
           to_jsonb(a) ->> 'verification_level' AS verification_level,
           CASE WHEN a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE
                THEN a.phone END AS contact_phone,
           live.live_count, live.rent_count, live.sale_count,
           r.review_count, r.average_stars,
           COUNT(*) OVER ()::int AS total_count
      ${AGENT_JOINS}
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

/**
 * How many listed agents each commune has, for the one-tap chips — every
 * commune of the chosen city (or of every city), whatever communes are chosen,
 * and with the other filters applied, so a chip's number is what tapping it
 * shows. An agent counts in a commune they declared or have a live listing in.
 * Exported for the SQL-text test.
 */
export function buildCommuneCountsQuery(params) {
  const values = [];
  const where = directoryWhere(params, values, { withCommunes: false });
  values.push(params.ville ? communesOfCity(params.ville) : allCommuneKeys());
  const keys = values.length;
  const sql = `
    WITH ${LIVE_CTE},
    eligible AS (
      SELECT a.id, a.primary_communes, a.serviced_communes
      ${AGENT_JOINS}
      WHERE ${where.join(' AND ')}
    ),
    pairs AS (
      SELECT e.id, unnest(COALESCE(e.primary_communes, '{}') || COALESCE(e.serviced_communes, '{}')) AS commune
        FROM eligible e
      UNION
      SELECT e.id, ac.name AS commune
        FROM eligible e
        JOIN properties lp ON lp.agent_id = e.id AND lp.status = 1 AND lp.approve_status = 1
        JOIN property_amenities pa ON pa.property_id = lp.id
        JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
       WHERE pa.amenity_id IN (SELECT amenity_id FROM location_communes)
    )
    SELECT commune, COUNT(DISTINCT id)::int AS agent_count
      FROM pairs
     WHERE commune = ANY($${keys}::text[])
     GROUP BY commune
     ORDER BY agent_count DESC, commune`;
  return { sql, values };
}

function allCommuneKeys() {
  return CITIES.flatMap((city) => city.communes.map((c) => c.key));
}

/**
 * `[{ key, count }]`, busiest first, communes with no agent left out. Never
 * throws: without counts the page simply shows no chips.
 */
export async function getCommuneCounts(params) {
  try {
    const { sql, values } = buildCommuneCountsQuery(params);
    const { rows } = await getPool().query(sql, values);
    return rows.map((row) => ({ key: row.commune, count: row.agent_count }));
  } catch (err) {
    console.error(`[agentDirectory] commune counts unavailable: ${err.message}`);
    return [];
  }
}
