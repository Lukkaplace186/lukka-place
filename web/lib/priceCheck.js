import 'server-only';
import { getPool } from './db';
import { MIN_SAMPLE } from './marketBenchmarks';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';

/**
 * "Is this price right for this commune?" — the developer price check on
 * /admin/market-data/prix, run by the sales team for a developer or a bank.
 *
 * Built from what we hold, nothing estimated:
 *  - comparable LIVE listings (same purpose and commune, then the same type,
 *    then the same bedrooms — the narrowest level with MIN_SAMPLE listings
 *    wins), where the price sits among them (percentile) and against the
 *    median, per m² when both sides have an area;
 *  - recorded CLOSES in the commune for that type: achieved median and days to
 *    close, only at MIN_SAMPLE or more;
 *  - DEMAND: distinct visitors whose /listings search in the last 90 days
 *    named the commune and allowed this price (budget at or above it, or no
 *    budget) — and how many of those searches found nothing.
 *
 * Every figure comes with its sample size; below the minimum the page says
 * "pas assez de données" instead of a number. Test agents are excluded.
 */

const COMMUNE_OF_P = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

/** $1 purpose, $2 commune, $3 category_id, $4 beds, $5 price (monthly for rent). */
export const COMPARABLES_SQL = `
  WITH comps AS (
    SELECT CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS amount,
           NULLIF(regexp_replace(COALESCE(p.area::text, ''), '[^0-9.]', '', 'g'), '')::numeric AS area,
           p.category_id, p.beds
      FROM properties p
     WHERE p.status = 1 AND p.approve_status = 1 AND p.price > 0
       AND COALESCE(p.listing_status, 'active') = 'active'
       AND p.purpose = $1 AND ${COMMUNE_OF_P} = $2
       AND ${NOT_TEST_LISTING_SQL}
  ),
  levels AS (
    SELECT 'beds' AS scope, * FROM comps WHERE category_id = $3 AND beds = $4
    UNION ALL SELECT 'type', * FROM comps WHERE category_id = $3
    UNION ALL SELECT 'commune', * FROM comps
  )
  SELECT scope,
         count(*)::int AS n,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median,
         count(*) FILTER (WHERE amount < $5)::int AS below,
         count(*) FILTER (WHERE amount = $5)::int AS equal,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount / area) FILTER (WHERE area > 0)::float AS median_per_sqm,
         count(*) FILTER (WHERE area > 0)::int AS sqm_n
    FROM levels
   GROUP BY scope
`;

/** $1 purpose, $2 commune, $3 category_id. Closes in the last 24 months. */
export const CLOSES_SQL = `
  SELECT count(*)::int AS n,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
           CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.sold_price / 12.0 ELSE p.sold_price END)::float AS median_achieved,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (p.sold_at - p.created_at::date))::float AS median_days
    FROM properties p
   WHERE p.approve_status = 1 AND p.listing_status = 'closed' AND p.sold_price > 0
     AND p.sold_at >= CURRENT_DATE - 730
     AND p.purpose = $1 AND ${COMMUNE_OF_P} = $2
     AND ($3::int IS NULL OR p.category_id = $3)
     AND ${NOT_TEST_LISTING_SQL}
`;

/** $1 purpose, $2 commune, $3 price, $4 beds. */
export const DEMAND_SQL = `
  SELECT count(DISTINCT COALESCE(s.visitor_id, s.id::text))::int AS people,
         count(DISTINCT COALESCE(s.visitor_id, s.id::text)) FILTER (WHERE s.result_count = 0)::int AS people_unserved
    FROM search_events s
   WHERE s.created_at >= NOW() - interval '90 days'
     AND $2 = ANY(s.communes)
     AND (s.purpose IS NULL OR s.purpose = $1)
     AND (s.price_max IS NULL OR s.price_max >= $3)
     AND ($4::int IS NULL OR s.beds_min IS NULL OR s.beds_min <= $4)
`;

/**
 * Pure: the verdict for a price against the chosen comparison level.
 * @returns {{scope: string|null, n: number, median: number|null, percentile: number|null,
 *            differencePct: number|null, verdict: 'above'|'below'|'inline'|'thin', perSqm: number|null}}
 */
export function priceVerdict(levelRows, price, area = null) {
  const byScope = Object.fromEntries((levelRows || []).map((r) => [r.scope, r]));
  const level = ['beds', 'type', 'commune'].map((s) => byScope[s]).find((r) => r && Number(r.n) >= MIN_SAMPLE);
  const commune = byScope.commune;
  if (!level) {
    return { scope: null, n: Number(commune?.n) || 0, median: null, percentile: null, differencePct: null, verdict: 'thin', perSqm: null, medianPerSqm: null };
  }
  const n = Number(level.n);
  const median = Math.round(Number(level.median));
  const percentile = Math.round(((Number(level.below) + Number(level.equal) / 2) / n) * 100);
  const differencePct = median > 0 ? Math.round(((price - median) / median) * 100) : null;
  let verdict = 'inline';
  if (differencePct != null && differencePct > 15) verdict = 'above';
  else if (differencePct != null && differencePct < -15) verdict = 'below';
  const perSqm = area > 0 ? Math.round(price / area) : null;
  const medianPerSqm = Number(level.sqm_n) >= MIN_SAMPLE && level.median_per_sqm != null ? Math.round(Number(level.median_per_sqm)) : null;
  return { scope: level.scope, n, median, percentile, differencePct, verdict, perSqm, medianPerSqm };
}

/**
 * @param {{commune: string, purpose: 'rent'|'sale', categoryId?: number|null, beds?: number|null, area?: number|null, price: number}} input
 */
export async function runPriceCheck({ commune, purpose, categoryId = null, beds = null, area = null, price }) {
  const pool = getPool();
  const [levels, closes, demand] = await Promise.all([
    pool.query(COMPARABLES_SQL, [purpose, commune, categoryId, beds, price]),
    pool.query(CLOSES_SQL, [purpose, commune, categoryId]),
    pool.query(DEMAND_SQL, [purpose, commune, price, beds]).catch((err) => {
      if (err?.code === '42P01' || err?.code === '42703') return null;
      throw err;
    }),
  ]);
  const position = priceVerdict(levels.rows, price, area);
  const closeRow = closes.rows[0] || {};
  const closedN = Number(closeRow.n) || 0;
  return {
    ...position,
    closes: {
      n: closedN,
      medianAchieved: closedN >= MIN_SAMPLE && closeRow.median_achieved != null ? Math.round(Number(closeRow.median_achieved)) : null,
      medianDays: closedN >= MIN_SAMPLE && closeRow.median_days != null ? Math.round(Number(closeRow.median_days)) : null,
    },
    demand: demand ? { people: Number(demand.rows[0]?.people) || 0, unserved: Number(demand.rows[0]?.people_unserved) || 0 } : null,
  };
}
