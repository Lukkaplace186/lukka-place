import 'server-only';
import { getPool } from './db';
import { keysetClause, pageCursors } from './adminPagination';
import { BLOCKING_FLAGS, EXTRACTION_FAILURE_MARKERS, MODERATION_QUEUE_STATUSES } from './moderation';

/**
 * The listing moderation queue — one server page at a time, with quality flags.
 *
 * Replaces a grid of the 50 newest cards with no search, no paging and no bulk
 * decisions. A moderator facing 300 pending listings needs to see the OLDEST
 * first (pending defaults to oldest), know how long each has waited, filter to
 * the ones with a problem, and decide many at once.
 *
 * FLAGS ARE FACTS, NOT VERDICTS. Each is something visible in the row a
 * moderator should look at — no photos, the same photo on another listing, the
 * same title at the same price, an unverified agent, a price far from its
 * commune's median. Nothing is auto-rejected on a flag.
 *
 * Status filters: `suspended` is `approve_status = 1 AND status = 0` (approved
 * but off the site) and `approved` is only what is actually public, so the two
 * no longer overlap as they did in the old queue.
 */

export const STATUS_WHERE = {
  pending: 'p.approve_status = 0',
  approved: 'p.approve_status = 1 AND p.status = 1',
  rejected: 'p.approve_status = 2',
  suspended: 'p.approve_status = 1 AND p.status = 0',
};

const SORTS = {
  oldest: 'f.created_at ASC, f.id ASC',
  newest: 'f.created_at DESC, f.id DESC',
  price_asc: 'f.price ASC NULLS LAST, f.id ASC',
  price_desc: 'f.price DESC NULLS LAST, f.id DESC',
  moderated: 'f.moderated_at DESC NULLS LAST, f.id DESC',
};
export const MODERATION_SORTS = Object.keys(SORTS);

/** Flags filterable in SQL. `price_outlier` depends on cached medians and is display-only. */
const FLAG_SQL = {
  no_photos: 'f.f_no_photos',
  few_photos: 'f.f_few_photos',
  missing_commune: 'f.f_missing_commune',
  missing_price: 'f.f_missing_price',
  missing_content: 'f.f_missing_content',
  extraction_failure: 'f.f_extraction_failure',
  duplicate_photo: 'f.f_duplicate_photo',
  duplicate_listing: 'f.f_duplicate_listing',
  agent_unverified: 'f.f_agent_unverified',
  no_agent: 'f.f_no_agent',
};
export const FILTERABLE_FLAGS = Object.keys(FLAG_SQL);

const COMMUNE_OF_P = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

function buildBase({ status, q, commune, purpose, agentId }, params) {
  const where = [STATUS_WHERE[status] || STATUS_WHERE.pending];
  const term = String(q || '').trim();
  if (term) {
    params.push(/^#?\d+$/.test(term) ? Number.parseInt(term.replace('#', ''), 10) : -1);
    const idParam = params.length;
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const likeParam = params.length;
    const digits = term.replace(/\D/g, '');
    params.push(digits.length >= 4 ? `%${digits}%` : '');
    const digitsParam = params.length;
    where.push(`(p.id = $${idParam} OR p.reference ILIKE $${likeParam} OR pc.title ILIKE $${likeParam}
                OR CONCAT_WS(' ', ai.first_name, ai.last_name) ILIKE $${likeParam} OR v.username ILIKE $${likeParam}
                OR ($${digitsParam} <> '' AND a.phone LIKE $${digitsParam}))`);
  }
  if (commune === '__none__') {
    where.push('NOT EXISTS (SELECT 1 FROM property_amenities pa WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44)');
  } else if (commune) {
    params.push(commune);
    where.push(`EXISTS (SELECT 1 FROM property_amenities pa
                        JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
                        WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name = $${params.length})`);
  }
  if (purpose === 'rent' || purpose === 'sale') {
    params.push(purpose);
    where.push(`p.purpose = $${params.length}`);
  }
  if (agentId != null && Number.isFinite(Number(agentId))) {
    params.push(Number(agentId));
    where.push(`p.agent_id = $${params.length}`);
  }
  params.push(EXTRACTION_FAILURE_MARKERS.map((marker) => `%${marker}%`));
  const markersParam = params.length;

  return `
    WITH base AS (
      SELECT p.id, p.created_at, p.updated_at, p.price, p.price_period, p.purpose, p.currency, p.featured_image,
             p.reference, p.agent_id, p.approve_status, p.status, p.quartier, p.beds,
             p.moderation_reason_code, p.moderation_note, p.moderated_at, p.moderated_by, p.verified_at,
             pc.title, pc.description,
             ${COMMUNE_OF_P} AS commune,
             (SELECT COUNT(*)::int FROM property_slider_images si WHERE si.property_id = p.id) AS photo_count,
             (a.phone_verified_at IS NOT NULL) AS agent_verified,
             a.phone AS agent_phone,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), NULLIF(v.username, '')) AS agent_name
      FROM properties p
      LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      LEFT JOIN agents a ON a.id = p.agent_id
      LEFT JOIN LATERAL (
        SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id
        ORDER BY (language_id = 20) DESC, language_id LIMIT 1
      ) ai ON true
      LEFT JOIN vendors v ON v.id = a.vendor_id
      WHERE ${where.join(' AND ')}
    ),
    flagged AS (
      SELECT b.*,
        (b.photo_count = 0 AND (COALESCE(b.featured_image, '') = '' OR b.featured_image LIKE '%noimage%')) AS f_no_photos,
        (b.photo_count BETWEEN 1 AND 2) AS f_few_photos,
        (b.commune IS NULL) AS f_missing_commune,
        (b.price IS NULL OR b.price <= 0) AS f_missing_price,
        (b.title IS NULL OR b.description IS NULL OR btrim(b.description) = '') AS f_missing_content,
        (LOWER(COALESCE(b.description, '')) LIKE ANY ($${markersParam}::text[])) AS f_extraction_failure,
        (
          (COALESCE(b.featured_image, '') <> '' AND b.featured_image NOT LIKE '%noimage%'
            AND EXISTS (SELECT 1 FROM properties o WHERE o.featured_image = b.featured_image AND o.id <> b.id))
          OR EXISTS (
            SELECT 1 FROM property_slider_images s1
            JOIN property_slider_images s2 ON s2.image = s1.image AND s2.property_id <> s1.property_id
            WHERE s1.property_id = b.id AND s1.image NOT LIKE '%noimage%'
          )
        ) AS f_duplicate_photo,
        (b.title IS NOT NULL AND b.price IS NOT NULL AND EXISTS (
          SELECT 1 FROM property_contents oc
          JOIN properties o ON o.id = oc.property_id
          WHERE LOWER(oc.title) = LOWER(b.title) AND oc.property_id <> b.id
            AND o.price = b.price AND o.approve_status <> 2
        )) AS f_duplicate_listing,
        (b.agent_id IS NOT NULL AND NOT b.agent_verified) AS f_agent_unverified,
        (b.agent_id IS NULL) AS f_no_agent
      FROM base b
    )
  `;
}

/**
 * Median asking price per (purpose, commune) over PUBLIC listings, cached for
 * ten minutes — it changes slowly and is one pass over every live listing.
 */
const MEDIAN_CACHE_MS = 10 * 60 * 1000;
let medianCache = { at: 0, value: null };

async function getCommuneMedians() {
  if (medianCache.value && Date.now() - medianCache.at < MEDIAN_CACHE_MS) return medianCache.value;
  const { rows } = await getPool().query(`
    WITH pub AS (
      SELECT p.purpose, ${COMMUNE_OF_P} AS commune,
             CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount
      FROM properties p
      WHERE p.status = 1 AND p.approve_status = 1 AND p.price > 0
    )
    SELECT purpose, commune, COUNT(*)::int AS n,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median
    FROM pub WHERE commune IS NOT NULL
    GROUP BY purpose, commune
  `);
  const value = new Map(rows.map((row) => [`${row.purpose}|${row.commune}`, row]));
  medianCache = { at: Date.now(), value };
  return value;
}

export const OUTLIER_MIN_SAMPLE = 5;
export const OUTLIER_RATIO = 3;

function toRow(row, medians) {
  const flags = Object.keys(FLAG_SQL).filter((flag) => row[`f_${flag}`]);
  const amount = row.price == null ? null : Number(row.price) / (row.purpose === 'rent' && row.price_period === 'an' ? 12 : 1);
  const median = row.commune ? medians.get(`${row.purpose}|${row.commune}`) : null;
  let outlier = null;
  if (amount && median && median.n >= OUTLIER_MIN_SAMPLE && median.median > 0) {
    const ratio = amount / median.median;
    if (ratio >= OUTLIER_RATIO || ratio <= 1 / OUTLIER_RATIO) {
      flags.push('price_outlier');
      outlier = { median: median.median, sample: median.n, ratio: Math.round(ratio * 10) / 10 };
    }
  }
  return {
    id: Number(row.id),
    title: row.title,
    reference: row.reference,
    price: row.price == null ? null : Number(row.price),
    pricePeriod: row.price_period,
    purpose: row.purpose,
    featuredImage: row.featured_image,
    photoCount: row.photo_count,
    commune: row.commune,
    quartier: row.quartier,
    beds: row.beds,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    agentVerified: Boolean(row.agent_verified),
    approveStatus: row.approve_status,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    moderatedAt: row.moderated_at ? new Date(row.moderated_at).toISOString() : null,
    moderatedByName: row.moderated_by_name || null,
    moderationReasonCode: row.moderation_reason_code,
    moderationNote: row.moderation_note,
    verified: Boolean(row.verified_at),
    flags,
    blocking: flags.some((flag) => BLOCKING_FLAGS.has(flag)),
    outlier,
  };
}

/**
 * @param {{status?: string, q?: string, commune?: string, purpose?: string, flag?: string,
 *          agentId?: number, sort?: string, limit?: number, offset?: number}} [options]
 */
export async function listModerationQueue({
  status = 'pending', q, commune, purpose, flag, agentId, sort, limit = 25, offset = 0, cursor = null,
} = {}) {
  const resolvedStatus = MODERATION_QUEUE_STATUSES.includes(status) ? status : 'pending';
  const params = [];
  const cte = buildBase({ status: resolvedStatus, q, commune, purpose, agentId }, params);
  const flagWhere = FLAG_SQL[flag] ? `WHERE ${FLAG_SQL[flag]}` : '';
  const resolvedSort = SORTS[sort] ? sort : resolvedStatus === 'pending' ? 'oldest' : 'newest';
  const pageLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 100);
  const pageOffset = Math.max(Number.parseInt(offset, 10) || 0, 0);
  // The two time orders page by cursor; price and moderated-at orders by offset.
  const keysetable = resolvedSort === 'oldest' || resolvedSort === 'newest';
  const keyset = keysetable
    ? keysetClause(cursor, { ts: 'f.created_at', id: 'f.id', descending: resolvedSort === 'newest' }, params.length + 1)
    : { condition: null, values: [], orderBy: SORTS[resolvedSort], reverse: false };
  const pageWhere = [FLAG_SQL[flag], keyset.condition].filter(Boolean);
  const pageParams = [...params, ...keyset.values];
  const pool = getPool();

  const [countResult, pageResult, medians] = await Promise.all([
    pool.query(`${cte} SELECT COUNT(*)::int AS total FROM flagged f ${flagWhere}`, params),
    pool.query(
      `${cte}
       SELECT f.*, f.created_at::text AS cursor_ts, mu.full_name AS moderated_by_name
       FROM flagged f
       LEFT JOIN console_admin_users mu ON mu.id = f.moderated_by
       ${pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : ''}
       ORDER BY ${keyset.orderBy}
       LIMIT $${pageParams.length + 1} OFFSET $${pageParams.length + 2}`,
      [...pageParams, pageLimit, keyset.condition ? 0 : pageOffset],
    ),
    getCommuneMedians().catch(() => new Map()),
  ]);

  const rawRows = keyset.reverse ? [...pageResult.rows].reverse() : pageResult.rows;
  return {
    total: countResult.rows[0]?.total ?? 0,
    rows: rawRows.map((row) => toRow(row, medians)),
    cursors: keysetable ? pageCursors(rawRows) : null,
  };
}

/** Tab counts — one scan, every status. */
export async function getModerationCounts() {
  const { rows } = await getPool().query(`
    SELECT COUNT(*) FILTER (WHERE approve_status = 0)::int                 AS pending,
           COUNT(*) FILTER (WHERE approve_status = 1 AND status = 1)::int  AS approved,
           COUNT(*) FILTER (WHERE approve_status = 2)::int                 AS rejected,
           COUNT(*) FILTER (WHERE approve_status = 1 AND status = 0)::int  AS suspended,
           MIN(created_at) FILTER (WHERE approve_status = 0)               AS oldest_pending_at
    FROM properties
  `);
  return rows[0];
}

/** The moderation facts the listing detail page shows beside the editor. */
export async function getListingModerationInfo(propertyId) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.approve_status, p.status, p.moderation_reason_code, p.moderation_note, p.moderated_at,
            mu.full_name AS moderated_by_name, p.featured_image,
            COALESCE((SELECT array_agg(si.image ORDER BY si.id) FROM property_slider_images si WHERE si.property_id = p.id), ARRAY[]::text[]) AS gallery
     FROM properties p
     LEFT JOIN console_admin_users mu ON mu.id = p.moderated_by
     WHERE p.id = $1`,
    [propertyId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    approveStatus: row.approve_status,
    status: row.status,
    reasonCode: row.moderation_reason_code,
    note: row.moderation_note,
    moderatedAt: row.moderated_at ? new Date(row.moderated_at).toISOString() : null,
    moderatedByName: row.moderated_by_name,
    photos: [...new Set([row.featured_image, ...(row.gallery || [])].filter((src) => src && !String(src).includes('noimage')))],
  };
}
