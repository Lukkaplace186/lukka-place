import 'server-only';
import { getPool } from './db';

/**
 * Asking-price statistics over PUBLISHED listings — /admin/market-data's top
 * section. The closed-transaction figures further down that page answer "what
 * did deals close at"; this answers "what is the market asking today", which
 * exists for every live listing rather than for the handful of recorded closes.
 *
 * - **The public gate, `p.status = 1 AND p.approve_status = 1`**, because this
 *   describes the supply a visitor can see. (lib/marketBenchmarks.js
 *   deliberately uses `approve_status = 1` alone — it needs sold rows. This
 *   module must not: a sold or pending listing is not on the market.)
 * - **Rent is per month**, normalised exactly as the storefront renders it
 *   (lib/format.js): `price_period = 'an'` is divided by 12, anything else is
 *   already monthly. Rent and sale are never mixed into one figure.
 * - **`price > 0` only.** A zero or missing price is "prix sur demande" on the
 *   site; averaging it in as $0 would drag every commune down. Those listings
 *   are counted separately so the exclusion is visible.
 * - `price` is the canonical USD figure on every row (a CDF listing keeps its
 *   authored francs in `price_original`), so no conversion happens here.
 * - Communes come from the data (property_amenities), never a fixed list.
 */

export const MARKET_PURPOSES = ['rent', 'sale'];

/** Below this a commune's figures are shown but flagged as a small sample. */
export const LOW_SAMPLE = 5;

/**
 * Histogram edges, in USD (per month for rent). Presentation only — each
 * bucket is a real COUNT between two edges; the last bucket is open-ended.
 */
export const PRICE_BUCKETS = {
  rent: [0, 200, 400, 600, 800, 1000, 1500, 2000, 3000, 5000],
  sale: [0, 25000, 50000, 100000, 150000, 250000, 500000, 1000000],
};

const COMMUNE_EXPR = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

const PUBLISHED_CTE = `
  WITH published AS (
    SELECT
      ${COMMUNE_EXPR} AS commune,
      CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount
    FROM properties p
    WHERE p.status = 1 AND p.approve_status = 1
      AND p.purpose = $1
      AND p.price > 0
  )
`;

export const PRICE_BY_COMMUNE_SQL = `
  ${PUBLISHED_CTE}
  SELECT commune,
         COUNT(*)::int AS listings,
         AVG(amount)::float AS avg_price,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median_price,
         MIN(amount)::float AS min_price,
         MAX(amount)::float AS max_price
    FROM published
   GROUP BY commune
   ORDER BY listings DESC, commune NULLS LAST
`;

export const PRICE_OVERALL_SQL = `
  ${PUBLISHED_CTE}
  SELECT COUNT(*)::int AS listings,
         AVG(amount)::float AS avg_price,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median_price
    FROM published
   WHERE ($2::text IS NULL OR commune = $2)
`;

export const PRICE_HISTOGRAM_SQL = `
  ${PUBLISHED_CTE}
  SELECT width_bucket(amount, $3::float8[]) AS bucket, COUNT(*)::int AS listings
    FROM published
   WHERE ($2::text IS NULL OR commune = $2)
   GROUP BY bucket
   ORDER BY bucket
`;

/** Listings on the market in each purpose, and how many carry no usable price. */
export const PURPOSE_COUNTS_SQL = `
  SELECT p.purpose,
         COUNT(*)::int AS listings,
         COUNT(*) FILTER (WHERE p.price IS NULL OR p.price <= 0)::int AS unpriced
    FROM properties p
   WHERE p.status = 1 AND p.approve_status = 1
   GROUP BY p.purpose
`;

/**
 * @param {{purpose?: 'rent'|'sale', commune?: string|null}} [options] `commune`
 *   narrows the overall figures and the histogram; the by-commune table always
 *   shows every commune, so the bar being inspected stays in context.
 */
export async function getPublishedPriceStats({ purpose = 'rent', commune = null } = {}) {
  const resolvedPurpose = MARKET_PURPOSES.includes(purpose) ? purpose : 'rent';
  const edges = PRICE_BUCKETS[resolvedPurpose];
  const pool = getPool();
  const [byCommune, overall, histogram, purposes] = await Promise.all([
    pool.query(PRICE_BY_COMMUNE_SQL, [resolvedPurpose]),
    pool.query(PRICE_OVERALL_SQL, [resolvedPurpose, commune || null]),
    pool.query(PRICE_HISTOGRAM_SQL, [resolvedPurpose, commune || null, edges]),
    pool.query(PURPOSE_COUNTS_SQL),
  ]);

  const counts = new Map(histogram.rows.map((row) => [Number(row.bucket), row.listings]));
  // width_bucket returns i for edges[i-1] <= amount < edges[i], and
  // edges.length for anything at or above the last edge.
  const buckets = edges.map((from, index) => ({
    from,
    to: index + 1 < edges.length ? edges[index + 1] : null,
    listings: counts.get(index + 1) || 0,
  }));

  return {
    purpose: resolvedPurpose,
    commune: commune || null,
    communes: byCommune.rows.map((row) => ({
      commune: row.commune || null,
      listings: row.listings,
      avgPrice: row.avg_price,
      medianPrice: row.median_price,
      minPrice: row.min_price,
      maxPrice: row.max_price,
      lowSample: row.listings < LOW_SAMPLE,
    })),
    overall: overall.rows[0] || { listings: 0, avg_price: null, median_price: null },
    buckets,
    purposes: Object.fromEntries(purposes.rows.map((row) => [row.purpose, { listings: row.listings, unpriced: row.unpriced }])),
  };
}
