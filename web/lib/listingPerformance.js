import 'server-only';
import { getPool } from './db';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';
import { getMandateCounts } from './marketing/mandateReport';

/**
 * One listing's funnel — what the agent's listing page
 * (app/compte/agent/biens/[id]/page.js) and the landlord's live report
 * (app/(site)/rapport/[token]/page.js) both show, from the same reads so the
 * two can never disagree.
 *
 *   vues → personnes → ont regardé les photos → les ont toutes vues
 *        → WhatsApp / appels / favoris / partages → demandes de visite
 *
 * Views, WhatsApp taps, saves and visit requests come from
 * lib/marketing/mandateReport.js (rollup while fresh, raw events otherwise,
 * visit requests from the engine). Everything the 2026-09-29 tracking added —
 * calls, photos, shares, different people — is read from the raw event tables,
 * which are indexed on (event, listing_id, created_at) and (listing_id,
 * created_at); a column that does not exist yet (the engagement migration)
 * makes that figure `null`, "non disponible", never 0.
 *
 * Those newer figures only exist from TRACKING_STARTED_AT. A window reaching
 * back before it is not "0 calls in August"; the pages say from when each
 * figure is measured.
 */

/** When calls, photo browsing, shares and visitor ids started being recorded. */
export const TRACKING_STARTED_AT = '2026-09-29';

/**
 * Window lengths for the agent page's range select — the same keys as the
 * overview chart (lib/analytics.js VIEW_RANGES), so one `?range=` drives both
 * the funnel and the chart beside it.
 */
export const PERFORMANCE_RANGES = { '7d': 7, '30d': 30, '12m': 365 };
export const DEFAULT_RANGE = '7d';

/** Comparables below this are not summarised (same bar as marketBenchmarks' MIN_SAMPLE). */
export const MARKET_MIN_SAMPLE = 5;

const DAY_MS = 86_400_000;
const MISSING = new Set(['42703', '42P01']);

/**
 * `days` whole UTC days ending today, and the same length before it — the
 * boundaries listing_stats_daily is rolled up on.
 */
export function performanceWindow(days, now = new Date()) {
  const span = Number.isInteger(days) && days > 0 ? days : 7;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(today + DAY_MS);
  const from = new Date(today - (span - 1) * DAY_MS);
  const previousFrom = new Date(from.getTime() - span * DAY_MS);
  return { previousFrom, from, end, lastDay: new Date(today), days: span };
}

/** Since the listing was published: one window, nothing before it to compare with. */
export function lifetimeWindow(publishedAt, now = new Date()) {
  const start = publishedAt ? new Date(publishedAt) : null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(today + DAY_MS);
  const fromDay = start && !Number.isNaN(start.getTime())
    ? Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
    : Date.UTC(2020, 0, 1);
  const from = new Date(fromDay);
  return { previousFrom: from, from, end, lastDay: new Date(today) };
}

export const ENGAGEMENT_SQL = `
  SELECT
    count(*) FILTER (WHERE event = 'call_click' AND created_at >= $3)::int  AS calls,
    count(*) FILTER (WHERE event = 'call_click' AND created_at < $3)::int   AS prev_calls,
    count(*) FILTER (WHERE event = 'share_click' AND created_at >= $3)::int AS shares,
    count(*) FILTER (WHERE event = 'share_click' AND created_at < $3)::int  AS prev_shares,
    count(DISTINCT visitor_id) FILTER (WHERE event = 'gallery_open' AND created_at >= $3)::int     AS gallery_people,
    count(DISTINCT visitor_id) FILTER (WHERE event = 'gallery_open' AND created_at < $3)::int      AS prev_gallery_people,
    count(DISTINCT visitor_id) FILTER (WHERE event = 'gallery_complete' AND created_at >= $3)::int AS gallery_complete_people,
    count(DISTINCT visitor_id) FILTER (WHERE event = 'gallery_complete' AND created_at < $3)::int  AS prev_gallery_complete_people
  FROM listing_events
  WHERE listing_id = $1 AND created_at >= $2 AND created_at < $4
    AND event IN ('call_click', 'share_click', 'gallery_open', 'gallery_complete')
`;

export const PEOPLE_SQL = `
  SELECT count(DISTINCT visitor_id) FILTER (WHERE created_at >= $3)::int AS people,
         count(DISTINCT visitor_id) FILTER (WHERE created_at < $3)::int  AS prev_people
    FROM page_views
   WHERE listing_id = $1 AND created_at >= $2 AND created_at < $4
`;

const NEW_METRICS = ['people', 'galleryPeople', 'galleryCompletePeople', 'calls', 'shares'];

function nulls() {
  return Object.fromEntries(NEW_METRICS.map((key) => [key, null]));
}

async function engagementCounts(listingId, window) {
  const pool = getPool();
  const params = [Number(listingId), window.previousFrom.toISOString(), window.from.toISOString(), window.end.toISOString()];
  const current = nulls();
  const previous = nulls();

  const [events, people] = await Promise.allSettled([
    pool.query(ENGAGEMENT_SQL, params),
    pool.query(PEOPLE_SQL, params),
  ]);
  if (events.status === 'fulfilled') {
    const row = events.value.rows[0] || {};
    Object.assign(current, { calls: row.calls ?? 0, shares: row.shares ?? 0, galleryPeople: row.gallery_people ?? 0, galleryCompletePeople: row.gallery_complete_people ?? 0 });
    Object.assign(previous, { calls: row.prev_calls ?? 0, shares: row.prev_shares ?? 0, galleryPeople: row.prev_gallery_people ?? 0, galleryCompletePeople: row.prev_gallery_complete_people ?? 0 });
  } else if (!MISSING.has(events.reason?.code)) {
    console.error(`[performance] engagement counts for #${listingId}: ${events.reason?.message}`);
  }
  if (people.status === 'fulfilled') {
    current.people = people.value.rows[0]?.people ?? 0;
    previous.people = people.value.rows[0]?.prev_people ?? 0;
  } else if (!MISSING.has(people.reason?.code)) {
    console.error(`[performance] people count for #${listingId}: ${people.reason?.message}`);
  }
  return { current, previous };
}

/**
 * The whole funnel for one listing over a window. Callers must have
 * established ownership (the agent page) or a valid report link (the owner's
 * page) — this takes a listing id and trusts it.
 *
 * @returns {Promise<{current: object, previous: object}>} each
 *   `{views, people, galleryPeople, galleryCompletePeople, whatsappClicks, calls, saves, shares, visitRequests}`,
 *   numbers or null (unknown).
 */
export async function getListingFunnel(listingId, window) {
  const [base, engagement] = await Promise.all([
    getMandateCounts(listingId, window),
    engagementCounts(listingId, window),
  ]);
  return {
    current: { ...base.current, ...engagement.current },
    previous: { ...base.previous, ...engagement.previous },
  };
}

// ---------------------------------------------------------------------------
// The listing's own facts, and where its price sits
// ---------------------------------------------------------------------------

const CONTENT_LANGUAGE_ID = 20;

export const PERFORMANCE_LISTING_SQL = `
  SELECT p.id, p.agent_id, p.price, p.purpose, p.price_period, p.beds, p.category_id, p.featured_image,
         p.status, p.approve_status, p.listing_status, p.archived_at, p.sold_at, p.sold_price,
         p.created_at, p.reference,
         NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz AS availability_confirmed_at,
         pc.title,
         (SELECT ac.name FROM property_amenities pa
            JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
           WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 LIMIT 1) AS commune
    FROM properties p
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
   WHERE p.id = $1
`;

/** The listing, any status. Ownership / link checks are the caller's. */
export async function getPerformanceListing(listingId) {
  const id = Number.parseInt(listingId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { rows } = await getPool().query(PERFORMANCE_LISTING_SQL, [id]);
  return rows[0] || null;
}

/**
 * Days between publication and now — or, off the market, the day it left.
 * `created_at` is what the storefront prints as "Publiée le", so both say the
 * same thing. null without a date.
 */
export function daysOnMarket(listing, now = new Date()) {
  const start = listing?.created_at ? new Date(listing.created_at) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const endValue = listing.listing_status === 'closed' && listing.sold_at ? new Date(listing.sold_at) : now;
  return Math.max(0, Math.floor((endValue.getTime() - start.getTime()) / DAY_MS));
}

/** Monthly rent / sale price, the way every market figure here is normalised. */
export function comparableAmount(listing) {
  const price = Number(listing?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return listing.purpose === 'rent' && listing.price_period === 'an' ? price / 12 : price;
}

/**
 * Medians of comparable PUBLIC listings (same purpose and commune; then the
 * same type; then the same bedrooms), the listing itself excluded. Each level
 * carries its sample size so the page picks the narrowest one that reaches
 * MARKET_MIN_SAMPLE.
 */
export const MARKET_POSITION_SQL = `
  WITH comps AS (
    SELECT CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount,
           p.category_id, p.beds
      FROM properties p
     WHERE p.status = 1 AND p.approve_status = 1 AND p.price > 0
       AND p.purpose = $1 AND p.id <> $2
       AND ${NOT_TEST_LISTING_SQL}
       AND EXISTS (SELECT 1 FROM property_amenities pa
                     JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
                    WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44 AND ac.name = $3)
  )
  SELECT
    count(*)::int AS commune_n,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS commune_median,
    count(*) FILTER (WHERE category_id = $4)::int AS type_n,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) FILTER (WHERE category_id = $4)::float AS type_median,
    count(*) FILTER (WHERE category_id = $4 AND beds = $5)::int AS beds_n,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) FILTER (WHERE category_id = $4 AND beds = $5)::float AS beds_median
  FROM comps
`;

/**
 * Pure: the narrowest comparison level with enough listings, and how this
 * listing's price sits against it. `null` median when no level reaches the
 * minimum — the page then says how many comparables exist, never a figure.
 */
export function pickMarketPosition(row, amount) {
  if (!row) return null;
  const levels = [
    { scope: 'beds', n: row.beds_n, median: row.beds_median },
    { scope: 'type', n: row.type_n, median: row.type_median },
    { scope: 'commune', n: row.commune_n, median: row.commune_median },
  ];
  const level = levels.find((l) => Number(l.n) >= MARKET_MIN_SAMPLE && Number(l.median) > 0);
  if (!level) return { scope: null, n: Number(row.commune_n) || 0, median: null, differencePct: null };
  const median = Math.round(Number(level.median));
  const differencePct = amount != null && median > 0 ? Math.round(((amount - median) / median) * 100) : null;
  return { scope: level.scope, n: Number(level.n), median, differencePct };
}

/** Where this listing's asking price sits among comparable live listings, or null without a commune/price. */
export async function getMarketPosition(listing) {
  const amount = comparableAmount(listing);
  if (!listing?.commune || amount == null || !['rent', 'sale'].includes(listing.purpose)) return null;
  const { rows } = await getPool().query(MARKET_POSITION_SQL, [
    listing.purpose, Number(listing.id), listing.commune,
    listing.category_id == null ? null : Number(listing.category_id),
    listing.beds == null ? null : Number(listing.beds),
  ]);
  return pickMarketPosition(rows[0], amount);
}
