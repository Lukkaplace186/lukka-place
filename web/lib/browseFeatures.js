import 'server-only';
import { getPool } from './db';
import { getListings, getListingsByIds } from './listings';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';
import { COMMUNE_EXPR } from './marketStats';
import { communeSlug } from './seoPages';
import { ALL_CITIES } from './cities';

/**
 * Things to browse for fun (growth plan items 27–31): the listing of the day,
 * "Combien coûte… ?" price pages, themed collections, the video feed and the
 * monthly Lukka Index. Every figure is computed from public listings (the
 * `status = 1 AND approve_status = 1` gate) or from the monthly market
 * snapshots; a page with too little behind it does not exist rather than
 * printing a thin number. Reads never throw: an empty answer hides the
 * section.
 */

const MISSING = new Set(['42P01', '42703']);
/** Below this, no median is published — the market-data rule (lib/marketBenchmarks.js). */
export const MIN_PRICE_SAMPLE = 5;

const kinshasaDay = (now = new Date()) => new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 27. Bien du jour
// ---------------------------------------------------------------------------

/**
 * A live listing with at least 3 photos, chosen the same way all day: the
 * team's pick for the day when there is one and it is still public, else a
 * deterministic draw (md5 of the day and the id) among listings published in
 * the last 120 days, else among all.
 */
export const AUTO_PICK_SQL = `
  SELECT p.id
    FROM properties p
   WHERE p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') = 'active'
     AND p.development_id IS NULL
     AND (SELECT COUNT(*) FROM property_slider_images psi WHERE psi.property_id = p.id) >= 3
     AND ${NOT_TEST_LISTING_SQL}
     AND ($2::boolean = false OR p.created_at >= NOW() - INTERVAL '120 days')
   ORDER BY md5($1 || ':' || p.id::text)
   LIMIT 1
`;

/** @returns {Promise<{day: string, listing: object, picked: boolean}|null>} */
export async function getListingOfTheDay({ now = new Date() } = {}) {
  const day = kinshasaDay(now);
  const pool = getPool();
  try {
    let picked = null;
    try {
      const { rows } = await pool.query('SELECT property_id FROM featured_listing_days WHERE day = $1::date', [day]);
      picked = rows[0]?.property_id ?? null;
    } catch (err) {
      if (!MISSING.has(err?.code)) throw err;
    }
    if (picked) {
      const [listing] = await getListingsByIds([picked]);
      if (listing) return { day, listing, picked: true };
    }
    for (const recent of [true, false]) {
      const { rows } = await pool.query(AUTO_PICK_SQL, [day, recent]);
      if (rows[0]) {
        const [listing] = await getListingsByIds([rows[0].id]);
        if (listing) return { day, listing, picked: false };
      }
    }
    return null;
  } catch (err) {
    console.error(`[bien-du-jour] ${err.message}`);
    return null;
  }
}

/** The team's pick for a day (replaces any earlier pick for that day). */
export async function setListingOfTheDay({ day, propertyId, by }) {
  const [listing] = await getListingsByIds([propertyId]);
  if (!listing) return false;
  await getPool().query(
    `INSERT INTO featured_listing_days (day, property_id, picked_by) VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET property_id = EXCLUDED.property_id, picked_by = EXCLUDED.picked_by, created_at = NOW()`,
    [day, propertyId, by],
  );
  return true;
}

// ---------------------------------------------------------------------------
// 28. "Combien coûte un 2 chambres à Gombe ?"
// ---------------------------------------------------------------------------

/**
 * Monthly asking rents of public LONG-TERM rentals per commune and bedroom
 * count (1–5), with the quartiles. Yearly rents ÷ 12, short-term rents left
 * out, `price > 0` only, test agencies out — exactly lib/marketStats.js's
 * rules. Only groups with MIN_PRICE_SAMPLE listings are returned.
 */
export const PRICE_GUIDES_SQL = `
  WITH rents AS (
    SELECT ${COMMUNE_EXPR} AS commune, p.beds,
           CASE WHEN p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount
      FROM properties p
     WHERE p.status = 1 AND p.approve_status = 1
       AND p.purpose = 'rent' AND p.price > 0
       AND COALESCE(p.price_period, '') NOT IN ('jour', 'semaine')
       AND p.beds BETWEEN 1 AND 5
       AND ${NOT_TEST_LISTING_SQL}
  )
  SELECT commune, beds::int AS beds, COUNT(*)::int AS listings,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount)::float AS p25,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount)::float AS p75
    FROM rents
   WHERE commune IS NOT NULL
   GROUP BY commune, beds
  HAVING COUNT(*) >= $1
   ORDER BY COUNT(*) DESC, commune, beds
`;

/** `2-chambres-gombe` ↔ { beds: 2, commune: 'Gombe' }. */
export function priceGuideSlug({ beds, commune }) {
  return `${beds}-chambre${beds > 1 ? 's' : ''}-${communeSlug(commune)}`;
}

/** The page's question: one bedroom reads in the singular. */
export function priceQuestion(t, { beds, commune }) {
  return beds === 1
    ? t('home.prices.questionOne', { commune })
    : t('home.prices.question', { beds, commune });
}

export async function getPriceGuides() {
  try {
    const { rows } = await getPool().query(PRICE_GUIDES_SQL, [MIN_PRICE_SAMPLE]);
    return rows.map((row) => ({
      commune: row.commune,
      beds: row.beds,
      listings: row.listings,
      median: Math.round(row.median),
      p25: Math.round(row.p25),
      p75: Math.round(row.p75),
      slug: priceGuideSlug(row),
    }));
  } catch (err) {
    console.error(`[price-guides] ${err.message}`);
    return [];
  }
}

export async function getPriceGuide(slug) {
  const guides = await getPriceGuides();
  return guides.find((guide) => guide.slug === slug) || null;
}

// ---------------------------------------------------------------------------
// 29. Themed collections
// ---------------------------------------------------------------------------

/**
 * Each collection is a real search (the same getListings every page uses),
 * so a collection and its "voir tout" link agree. Nationwide. A collection
 * with fewer than MIN_COLLECTION listings is not shown.
 */
export const MIN_COLLECTION = 3;

export const COLLECTIONS = [
  { slug: 'villas', titleKey: 'home.collections.villas', filters: { propertyType: 'villa' }, href: '/listings?property_type=villa&ville=toutes' },
  { slug: 'moins-de-300', titleKey: 'home.collections.under300', filters: { transactionType: 'location', priceMax: 300, leaseTerm: 'long' }, href: '/listings?transaction_type=location&price_max=300&lease_term=long&ville=toutes' },
  { slug: 'avec-piscine', titleKey: 'home.collections.pool', filters: { amenities: ['pool'] }, href: '/listings?amenities=pool&ville=toutes' },
  { slug: 'courte-duree', titleKey: 'home.collections.shortStay', filters: { leaseTerm: 'short' }, href: '/listings?lease_term=short&ville=toutes' },
  { slug: 'nouveaux', titleKey: 'home.collections.fresh', filters: { sort: 'newest' }, freshOnly: true, href: '/listings?sort=newest&ville=toutes' },
];

export function findCollection(slug) {
  return COLLECTIONS.find((collection) => collection.slug === slug) || null;
}

/** @returns {Promise<{total: number, listings: object[]}>} */
export async function getCollectionListings(collection, { limit = 24 } = {}) {
  try {
    const result = await getListings({ ...collection.filters, ville: ALL_CITIES, limit: collection.freshOnly ? 48 : limit });
    let listings = result.data || [];
    if (collection.freshOnly) listings = listings.filter((listing) => listing.is_fresh).slice(0, limit);
    return { total: collection.freshOnly ? listings.length : Number(result.total || 0), listings };
  } catch (err) {
    console.error(`[collections] ${collection.slug}: ${err.message}`);
    return { total: 0, listings: [] };
  }
}

/** Every collection with its count and cover photo, those with enough listings only. */
export async function getCollectionTiles() {
  const results = await Promise.all(COLLECTIONS.map(async (collection) => {
    const { total, listings } = await getCollectionListings(collection, { limit: 1 });
    return { ...collection, total, cover: listings[0] || null };
  }));
  return results.filter((tile) => tile.total >= MIN_COLLECTION);
}

// ---------------------------------------------------------------------------
// 30. Video feed
// ---------------------------------------------------------------------------

/** The feed exists only from this many listings with a video. */
export const MIN_VIDEO_LISTINGS = 3;

export const VIDEO_LISTINGS_SQL = `
  SELECT p.id, to_jsonb(p) -> 'videos' AS videos
    FROM properties p
   WHERE p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') = 'active'
     AND jsonb_typeof(to_jsonb(p) -> 'videos') = 'array'
     AND jsonb_array_length(to_jsonb(p) -> 'videos') > 0
     AND ${NOT_TEST_LISTING_SQL}
   ORDER BY p.created_at DESC
   LIMIT $1
`;

/** @returns {Promise<object[]>} public listings with a video, newest first (full rows). */
export async function getVideoListings({ limit = 30 } = {}) {
  try {
    const { rows } = await getPool().query(VIDEO_LISTINGS_SQL, [limit]);
    if (rows.length < MIN_VIDEO_LISTINGS) return [];
    const listings = await getListingsByIds(rows.map((row) => row.id));
    const byId = new Map(rows.map((row, index) => [Number(row.id), { index, videos: row.videos }]));
    // The card readers do not select `videos`; this query did.
    return listings
      .map((listing) => ({ ...listing, videos: byId.get(Number(listing.id))?.videos ?? null }))
      .sort((a, b) => byId.get(Number(a.id)).index - byId.get(Number(b.id)).index);
  } catch (err) {
    console.error(`[video-feed] ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 31. Lukka Index
// ---------------------------------------------------------------------------

/**
 * Median asking rent per commune for the latest snapshot month and the one
 * before (market_snapshots_monthly, written once a month by the engine and
 * never rewritten). A commune is listed only when the latest month has
 * MIN_PRICE_SAMPLE asks; a change is only computed when the earlier month had
 * as many too.
 */
export const LUKKA_INDEX_SQL = `
  WITH months AS (
    SELECT DISTINCT month FROM market_snapshots_monthly
     WHERE purpose = 'rent' AND category_id = -1 AND beds_bucket = 'all'
     ORDER BY month DESC LIMIT 2
  )
  SELECT to_char(s.month, 'YYYY-MM-DD') AS month, s.commune, s.median_ask::float AS median, s.ask_sample, s.active_count
    FROM market_snapshots_monthly s
    JOIN months m ON m.month = s.month
   WHERE s.purpose = 'rent' AND s.category_id = -1 AND s.beds_bucket = 'all'
`;

export async function getLukkaIndex() {
  try {
    const { rows } = await getPool().query(LUKKA_INDEX_SQL);
    const months = [...new Set(rows.map((row) => row.month))].sort().reverse();
    if (!months.length) return null;
    const [latest, previous] = months;
    const before = new Map(rows.filter((row) => row.month === previous).map((row) => [row.commune, row]));
    const communes = rows
      .filter((row) => row.month === latest && row.ask_sample >= MIN_PRICE_SAMPLE && row.median != null)
      .map((row) => {
        const old = before.get(row.commune);
        const comparable = old && old.ask_sample >= MIN_PRICE_SAMPLE && old.median > 0;
        return {
          commune: row.commune,
          median: Math.round(row.median),
          sample: row.ask_sample,
          previous: comparable ? Math.round(old.median) : null,
          changePct: comparable ? Math.round(((row.median - old.median) / old.median) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.median - a.median);
    return { month: latest, previousMonth: previous || null, communes };
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[lukka-index] ${err.message}`);
    return null;
  }
}

export { kinshasaDay };
