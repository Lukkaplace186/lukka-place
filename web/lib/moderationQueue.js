import 'server-only';
import { getPool } from './db';
import { keysetClause, pageCursors } from './adminPagination';
import { BLOCKING_FLAGS, EXTRACTION_FAILURE_MARKERS, MODERATION_QUEUE_STATUSES } from './moderation';
import { VIDEOS_SQL, VIDEO_COUNT_SQL, isVideoPoster, listingVideos } from './listingVideos';
import { monthlyEquivalent } from './leaseTerm';
import { SOCIAL_FILTER_SQL, hasTeamSocialPosts } from './teamSocialPosts';
import { TARGET_KEY_PATTERN } from './teamSocialTargets';

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

// A developer's unit listing (development_id set) is reviewed WITH its
// project on /admin/projets — publishing the project approves its units in
// the same transaction — so it never waits in this queue as well.
export const STATUS_WHERE = {
  pending: 'p.approve_status = 0 AND p.development_id IS NULL',
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
  same_agent_resend: 'f.f_same_agent_resend',
  duplicate_photo: 'f.f_duplicate_photo',
  duplicate_listing: 'f.f_duplicate_listing',
  agent_unverified: 'f.f_agent_unverified',
  no_agent: 'f.f_no_agent',
  availability_unanswered: 'f.f_availability_unanswered',
};

/**
 * A live listing whose two most recent WhatsApp availability questions
 * (services/availabilityCheck.js) both went unanswered, and which nobody has
 * confirmed on the dashboard since. Not proof the agent ignored them — a
 * session message outside the 24h window is accepted and never delivered —
 * but it is the listing somebody should call about.
 */
export const AVAILABILITY_UNANSWERED_SQL = `(
  p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') = 'active'
  AND (
    SELECT COUNT(*) FILTER (WHERE last_two.answered_at IS NULL) = 2
      FROM (SELECT c.answered_at FROM listing_availability_checks c
             WHERE c.property_id = p.id AND c.channel = 'WHATSAPP'
             ORDER BY c.asked_at DESC LIMIT 2) last_two
  )
  AND COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz, 'epoch'::timestamptz)
      < (SELECT MAX(c.asked_at) FROM listing_availability_checks c WHERE c.property_id = p.id AND c.channel = 'WHATSAPP')
)`;

let availabilityTable = { at: 0, value: null };

/**
 * Whether migrations/20260929_listing_availability_checks.sql has run. The
 * flag's subquery names that table, and a missing table would fail the whole
 * moderation queue rather than just the flag. Cached for ten minutes.
 */
export async function hasAvailabilityChecks() {
  if (availabilityTable.value !== null && Date.now() - availabilityTable.at < 10 * 60 * 1000) return availabilityTable.value;
  try {
    const { rows } = await getPool().query("SELECT to_regclass('public.listing_availability_checks') IS NOT NULL AS ok");
    availabilityTable = { at: Date.now(), value: Boolean(rows[0]?.ok) };
  } catch {
    availabilityTable = { at: Date.now(), value: false };
  }
  return availabilityTable.value;
}
export const FILTERABLE_FLAGS = Object.keys(FLAG_SQL);

/**
 * The content fingerprint in a stored photo's name: the engine names a
 * WhatsApp photo `whatsapp_<md5[0:13]>` of its bytes (services/supabaseStorage.js),
 * web an agent upload `agent_<md5[0:13]>` (lib/listingStorage.js). The same
 * photo sent twice has the same fingerprint on two listings, while the full
 * URL always differs (it carries the listing id) — which is why comparing
 * URLs never caught a re-send. Engine twin: services/resendGuard.js.
 */
export const PHOTO_FINGERPRINT_PATTERN = '(?:whatsapp|agent)_([0-9a-f]{13})';

/** Units of one WhatsApp message are created together; a re-send comes later. */
export const SAME_MESSAGE_SECONDS = 1800;

/** Below this many folded characters a description says too little to match on. */
export const MIN_DESCRIPTION_KEY = 40;

/**
 * Every photo fingerprint and description of live / pending listings, built
 * once per query (a few thousand rows) so the duplicate flags are joins, not
 * a scan of every photo per listing.
 */
export const DUPLICATE_INDEX_CTES = `
    fp_index AS MATERIALIZED (
      SELECT DISTINCT p.id, p.agent_id, p.purpose, p.beds, p.created_at, p.approve_status, p.status, p.listing_status,
             substring(img.src from '${PHOTO_FINGERPRINT_PATTERN}') AS fp
      FROM properties p
      CROSS JOIN LATERAL (
        SELECT p.featured_image AS src
        UNION ALL SELECT si.image FROM property_slider_images si WHERE si.property_id = p.id
      ) img
      WHERE p.deleted_at IS NULL AND p.approve_status IN (0, 1) AND img.src ~ '${PHOTO_FINGERPRINT_PATTERN}'
    ),
    desc_index AS MATERIALIZED (
      SELECT p.id, p.agent_id, p.purpose, p.beds, p.created_at, p.approve_status, p.status, p.listing_status,
             lower(regexp_replace(dpc.description, '[^[:alnum:]]+', '', 'g')) AS dk
      FROM properties p
      JOIN property_contents dpc ON dpc.property_id = p.id AND dpc.language_id = 20
      WHERE p.deleted_at IS NULL AND p.approve_status IN (0, 1)
        AND length(lower(regexp_replace(COALESCE(dpc.description, ''), '[^[:alnum:]]+', '', 'g'))) >= ${MIN_DESCRIPTION_KEY}
    )`;

/**
 * `o` (a row of fp_index / desc_index) is the SAME agent's listing of the same
 * property as `${b}` (owner decision 2026-11-10): same agent, still on the
 * market (live or pending, not hidden, not closed), same transaction, same
 * bedroom count or either unstated, and from another message. The caller's
 * join supplies the evidence: a shared photo fingerprint or the same text.
 */
export const SAME_AGENT_MATCH = (b) => `o.id <> ${b}.id AND o.agent_id = ${b}.agent_id
  AND o.approve_status IN (0, 1) AND o.status = 1 AND o.listing_status IS DISTINCT FROM 'closed'
  AND o.purpose IS NOT DISTINCT FROM ${b}.purpose
  AND (o.beds IS NULL OR ${b}.beds IS NULL OR o.beds = ${b}.beds)
  AND abs(extract(epoch FROM o.created_at - ${b}.created_at)) > ${SAME_MESSAGE_SECONDS}`;

export const COMMUNE_OF_P = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
  LIMIT 1
)`;

function buildBase({ status, q, commune, purpose, agentId, social, notIn, availabilityChecks = false, teamSocial = false }, params) {
  // Soft-deleted listings (lib/adminSoftDelete.js) leave every tab.
  const where = [STATUS_WHERE[status] || STATUS_WHERE.pending, 'p.deleted_at IS NULL'];
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
    where.push('NOT EXISTS (SELECT 1 FROM property_amenities pa WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes))');
  } else if (commune) {
    params.push(commune);
    where.push(`EXISTS (SELECT 1 FROM property_amenities pa
                        JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
                        WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes) AND ac.name = $${params.length})`);
  }
  if (purpose === 'rent' || purpose === 'sale') {
    params.push(purpose);
    where.push(`p.purpose = $${params.length}`);
  }
  if (agentId != null && Number.isFinite(Number(agentId))) {
    params.push(Number(agentId));
    where.push(`p.agent_id = $${params.length}`);
  }
  // Where the team already posted it (lib/teamSocialPosts.js): only once the
  // table exists, so the queue never fails on a missing table.
  if (teamSocial && SOCIAL_FILTER_SQL[social]) where.push(SOCIAL_FILTER_SQL[social]);
  if (teamSocial && notIn && TARGET_KEY_PATTERN.test(notIn)) {
    params.push(notIn);
    where.push(`NOT EXISTS (SELECT 1 FROM team_social_posts tsp WHERE tsp.property_id = p.id AND tsp.target_key = $${params.length})`);
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
             ${VIDEO_COUNT_SQL} AS video_count,
             (a.phone_verified_at IS NOT NULL) AS agent_verified,
             ${availabilityChecks ? AVAILABILITY_UNANSWERED_SQL : 'false'} AS availability_unanswered,
             a.phone AS agent_phone,
             -- The person, never vendors.username (phone digits, or free text
             -- typed during onboarding). The agency is shown on its own line.
             NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS agent_name,
             NULLIF(TRIM(a.agency_name), '') AS agent_agency,
             a.created_at AS agent_created_at
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
    ${DUPLICATE_INDEX_CTES},
    flagged AS (
      SELECT b.*,
        -- A video counts as media (lib/listingVideos.js): a video-only listing is not "no photos".
        (b.photo_count = 0 AND b.video_count = 0 AND (COALESCE(b.featured_image, '') = '' OR b.featured_image LIKE '%noimage%')) AS f_no_photos,
        (b.photo_count BETWEEN 1 AND 2) AS f_few_photos,
        (b.commune IS NULL) AS f_missing_commune,
        (b.price IS NULL OR b.price <= 0) AS f_missing_price,
        (b.title IS NULL OR b.description IS NULL OR btrim(b.description) = '') AS f_missing_content,
        (LOWER(COALESCE(b.description, '')) LIKE ANY ($${markersParam}::text[])) AS f_extraction_failure,
        -- The same photo (by content fingerprint) on a listing of ANOTHER
        -- agent: a co-mandate, allowed (owner, 2026-11-10) — a note only.
        EXISTS (
          SELECT 1 FROM fp_index x JOIN fp_index o ON o.fp = x.fp
          WHERE x.id = b.id AND o.id <> b.id AND o.agent_id IS DISTINCT FROM b.agent_id
        ) AS f_duplicate_photo,
        -- The SAME agent has this property live or pending from another
        -- message: not allowed. See SAME_AGENT_MATCH.
        (b.agent_id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM fp_index x JOIN fp_index o ON o.fp = x.fp WHERE x.id = b.id AND ${SAME_AGENT_MATCH('b')})
          OR EXISTS (SELECT 1 FROM desc_index x JOIN desc_index o ON o.dk = x.dk WHERE x.id = b.id AND ${SAME_AGENT_MATCH('b')})
        )) AS f_same_agent_resend,
        (b.title IS NOT NULL AND b.price IS NOT NULL AND EXISTS (
          SELECT 1 FROM property_contents oc
          JOIN properties o ON o.id = oc.property_id
          WHERE LOWER(oc.title) = LOWER(b.title) AND oc.property_id <> b.id
            AND o.price = b.price AND o.approve_status <> 2
        )) AS f_duplicate_listing,
        (b.agent_id IS NOT NULL AND NOT b.agent_verified) AS f_agent_unverified,
        (b.agent_id IS NULL) AS f_no_agent,
        b.availability_unanswered AS f_availability_unanswered
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
             CASE WHEN p.purpose = 'rent' AND p.price_period IN ('jour', 'semaine') THEN NULL WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount
      FROM properties p
      WHERE p.status = 1 AND p.approve_status = 1 AND p.price > 0
        AND COALESCE(p.price_period, '') NOT IN ('jour', 'semaine')
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
  const amount = row.price == null ? null : monthlyEquivalent(Number(row.price), row.purpose, row.price_period);
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
    videoCount: Number(row.video_count) || 0,
    commune: row.commune,
    quartier: row.quartier,
    beds: row.beds,
    agentId: row.agent_id == null ? null : Number(row.agent_id),
    agentName: row.agent_name,
    agentAgency: row.agent_agency || null,
    agentPhone: row.agent_phone,
    agentVerified: Boolean(row.agent_verified),
    agentCreatedAt: row.agent_created_at ? new Date(row.agent_created_at).toISOString() : null,
    agentListingCount: row.agent_listing_count == null ? null : Number(row.agent_listing_count),
    approveStatus: row.approve_status,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    moderatedAt: row.moderated_at ? new Date(row.moderated_at).toISOString() : null,
    moderatedByName: row.moderated_by_name || null,
    moderationReasonCode: row.moderation_reason_code,
    moderationNote: row.moderation_note,
    verified: Boolean(row.verified_at),
    flags,
    blocking: flags.some((flag) => BLOCKING_FLAGS.has(flag)),
    outlier,
    // The listings each duplicate flag points at (DUPLICATE_IDS_SQL).
    duplicates: {
      same_agent_resend: idList(row.dup_resend_ids),
      duplicate_listing: idList(row.dup_listing_ids),
      duplicate_photo: idList(row.dup_photo_ids),
    },
    // Whether a "same title and price" look-alike is the same agent's.
    duplicateListingSameAgent: Boolean(row.dup_listing_same_agent),
  };
}

/**
 * `social` ('unposted' | 'posted') and `notIn` (a target key: not yet posted
 * THERE) filter on where the team posted the listing (lib/teamSocialPosts.js);
 * both are ignored until migrations/20261106_team_social_posts.sql has run.
 *
 * @param {{status?: string, q?: string, commune?: string, purpose?: string, flag?: string,
 *          agentId?: number, social?: string, notIn?: string, sort?: string, limit?: number, offset?: number}} [options]
 */
export async function listModerationQueue({
  status = 'pending', q, commune, purpose, flag, agentId, social, notIn, sort, limit = 25, offset = 0, cursor = null,
} = {}) {
  const resolvedStatus = MODERATION_QUEUE_STATUSES.includes(status) ? status : 'pending';
  const params = [];
  const [availabilityChecks, teamSocial] = await Promise.all([
    hasAvailabilityChecks(),
    social || notIn ? hasTeamSocialPosts() : false,
  ]);
  const cte = buildBase({ status: resolvedStatus, q, commune, purpose, agentId, social, notIn, availabilityChecks, teamSocial }, params);
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
       SELECT f.*, f.created_at::text AS cursor_ts, mu.full_name AS moderated_by_name,
              -- How much this agent has on the platform: a first listing from
              -- an account created minutes ago reads very differently from an
              -- agency's 70th. Page rows only.
              (SELECT COUNT(*)::int FROM properties q WHERE q.agent_id = f.agent_id AND q.deleted_at IS NULL) AS agent_listing_count,
              ${DUPLICATE_IDS_SQL}
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

/**
 * Which listings a duplicate flag points at, so the flag can open them side by
 * side (/admin/listings/compare). Same conditions as f_duplicate_listing /
 * f_duplicate_photo above, newest first, at most DUPLICATE_LINK_LIMIT each.
 * Only computed for the rows of the page shown, never for the whole tab.
 */
export const DUPLICATE_LINK_LIMIT = 5;
export const DUPLICATE_IDS_SQL = `
  CASE WHEN f.f_duplicate_listing THEN ARRAY(
    SELECT DISTINCT o.id FROM property_contents oc
    JOIN properties o ON o.id = oc.property_id
    WHERE LOWER(oc.title) = LOWER(f.title) AND oc.property_id <> f.id
      AND o.price = f.price AND o.approve_status <> 2
    ORDER BY o.id DESC LIMIT ${DUPLICATE_LINK_LIMIT}
  ) END AS dup_listing_ids,
  (f.f_duplicate_listing AND f.agent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM property_contents oc JOIN properties o ON o.id = oc.property_id
    WHERE LOWER(oc.title) = LOWER(f.title) AND oc.property_id <> f.id
      AND o.price = f.price AND o.approve_status <> 2 AND o.agent_id = f.agent_id
  )) AS dup_listing_same_agent,
  CASE WHEN f.f_duplicate_photo THEN ARRAY(
    SELECT DISTINCT o.id FROM fp_index x JOIN fp_index o ON o.fp = x.fp
    WHERE x.id = f.id AND o.id <> f.id AND o.agent_id IS DISTINCT FROM f.agent_id
    ORDER BY o.id DESC LIMIT ${DUPLICATE_LINK_LIMIT}
  ) END AS dup_photo_ids,
  CASE WHEN f.f_same_agent_resend THEN ARRAY(
    SELECT m.id FROM (
      SELECT o.id FROM fp_index x JOIN fp_index o ON o.fp = x.fp WHERE x.id = f.id AND ${SAME_AGENT_MATCH('f')}
      UNION
      SELECT o.id FROM desc_index x JOIN desc_index o ON o.dk = x.dk WHERE x.id = f.id AND ${SAME_AGENT_MATCH('f')}
    ) m ORDER BY m.id DESC LIMIT ${DUPLICATE_LINK_LIMIT}
  ) END AS dup_resend_ids`;

/**
 * The same agent's other live / pending listings of this property
 * (SAME_AGENT_MATCH), newest first — what bulk approval refuses to publish
 * without a look at the comparison.
 * @returns {Promise<number[]>}
 */
export async function findSameAgentResends(listingId) {
  const id = Number.parseInt(listingId, 10);
  if (!Number.isInteger(id) || id <= 0) return [];
  const { rows } = await getPool().query(
    `WITH ${DUPLICATE_INDEX_CTES},
     b AS (SELECT id, agent_id, purpose, beds, created_at FROM properties WHERE id = $1 AND agent_id IS NOT NULL)
     SELECT m.id FROM (
       SELECT o.id FROM b JOIN fp_index x ON x.id = b.id JOIN fp_index o ON o.fp = x.fp WHERE ${SAME_AGENT_MATCH('b')}
       UNION
       SELECT o.id FROM b JOIN desc_index x ON x.id = b.id JOIN desc_index o ON o.dk = x.dk WHERE ${SAME_AGENT_MATCH('b')}
     ) m ORDER BY m.id DESC LIMIT ${DUPLICATE_LINK_LIMIT}`,
    [id],
  );
  return rows.map((row) => Number(row.id));
}

const idList = (value) => (Array.isArray(value) ? value.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

/** Tab counts — one scan, every status. */
export async function getModerationCounts() {
  const { rows } = await getPool().query(`
    SELECT COUNT(*) FILTER (WHERE approve_status = 0 AND development_id IS NULL)::int AS pending,
           COUNT(*) FILTER (WHERE approve_status = 1 AND status = 1)::int  AS approved,
           COUNT(*) FILTER (WHERE approve_status = 2)::int                 AS rejected,
           COUNT(*) FILTER (WHERE approve_status = 1 AND status = 0)::int  AS suspended,
           MIN(created_at) FILTER (WHERE approve_status = 0 AND development_id IS NULL) AS oldest_pending_at
    FROM properties
    WHERE deleted_at IS NULL
  `);
  return rows[0];
}

/** The moderation facts the listing detail page shows beside the editor. */
export async function getListingModerationInfo(propertyId) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.approve_status, p.status, p.moderation_reason_code, p.moderation_note, p.moderated_at,
            mu.full_name AS moderated_by_name, p.featured_image, ${VIDEOS_SQL} AS videos,
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
    // A video's cover frame (featured_image of a video-only listing) is not
    // a photo: it is left out so saving the gallery never turns it into one.
    photos: [...new Set([row.featured_image, ...(row.gallery || [])].filter((src) => src && !String(src).includes('noimage') && !isVideoPoster(src)))],
    videos: listingVideos(row),
  };
}
