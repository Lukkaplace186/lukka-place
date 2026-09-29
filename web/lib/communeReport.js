import 'server-only';
import { getPool } from './db';
import { MIN_SAMPLE } from './marketBenchmarks';
import { AREA_M2_SQL as AREA_SQL, NOT_TEST_LISTING_SQL } from './marketExclusions';
import { getMarketSeries } from './marketSnapshots';
import { getDemandReport } from './adminApi';
import { bedsBucket, summariseSupplyRow, suppressed } from './communeReportRules';

/**
 * The printable commune market report (/admin/market-data/rapport/[commune]) —
 * the document the team hands a bank or a developer. Every figure is read
 * from what the platform recorded, with its sample size:
 *
 *  - SUPPLY NOW: live public listings in the commune, by type × bedrooms,
 *    median / quartiles of the asking price (rent per month), median $/m²
 *    where the area is a plain number, median age of the listings;
 *  - EVOLUTION: the monthly snapshots (services/marketSnapshot.js);
 *  - CLOSES: listings recorded let/sold in the last 24 months — achieved
 *    median, gap to the asking price, days to close;
 *  - DEMAND: 90 days of /listings searches naming the commune (distinct
 *    visitors, how many found nothing) and customer requests (engine).
 *
 * MIN_SAMPLE (5) suppresses every median below it: the count is kept, the
 * figure is "—". Test agents' listings are excluded everywhere.
 */

const CATEGORY_LANGUAGE_ID = 26;

const COMMUNE_OF_P = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

const AMOUNT_SQL = `CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END`;

/** $1 purpose, $2 commune. */
export const SUPPLY_SQL = `
  WITH live AS (
    SELECT COALESCE(catc.name, 'Autre') AS type,
           CASE WHEN p.beds IS NULL THEN 'na' WHEN p.beds >= 4 THEN '4+' ELSE p.beds::text END AS beds_bucket,
           CASE WHEN p.price > 0 THEN ${AMOUNT_SQL} END AS amount,
           ${AREA_SQL} AS area,
           (CURRENT_DATE - p.created_at::date) AS age_days
      FROM properties p
      LEFT JOIN property_category_contents catc ON catc.category_id = p.category_id AND catc.language_id = ${CATEGORY_LANGUAGE_ID}
     WHERE p.status = 1 AND p.approve_status = 1
       AND COALESCE(p.listing_status, 'active') = 'active'
       AND p.purpose = $1 AND ${COMMUNE_OF_P} = $2
       AND ${NOT_TEST_LISTING_SQL}
  )
  SELECT type, beds_bucket,
         GROUPING(type, beds_bucket) AS level,
         count(*)::int AS listings,
         count(amount)::int AS priced,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount)::float AS p25,
         PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY amount)::float AS median,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount)::float AS p75,
         PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY amount / area) FILTER (WHERE amount > 0 AND area > 0)::float AS median_per_sqm,
         count(*) FILTER (WHERE amount > 0 AND area > 0)::int AS sqm_sample,
         PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY age_days)::float AS median_age_days
    FROM live
   GROUP BY GROUPING SETS ((type, beds_bucket), (type), ())
   ORDER BY level DESC, type, beds_bucket
`;

/** $1 purpose, $2 commune. Closes recorded in the last 24 months. */
export const CLOSES_SQL = `
  SELECT count(*)::int AS closed,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
           CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.sold_price / 12.0 ELSE p.sold_price END)::float AS median_achieved,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (p.sold_price - p.price) / p.price * 100)
           FILTER (WHERE p.price > 0)::float AS median_gap_pct,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (p.sold_at - p.created_at::date))::float AS median_days
    FROM properties p
   WHERE p.approve_status = 1 AND p.listing_status = 'closed' AND p.sold_price > 0 AND p.sold_at IS NOT NULL
     AND p.sold_at >= CURRENT_DATE - 730
     AND p.purpose = $1 AND ${COMMUNE_OF_P} = $2
     AND ${NOT_TEST_LISTING_SQL}
`;

/** $1 purpose, $2 commune. The last 90 days of /listings searches naming it. */
export const SEARCH_DEMAND_SQL = `
  SELECT CASE WHEN s.beds_min IS NULL THEN 'na' WHEN s.beds_min >= 4 THEN '4+' ELSE s.beds_min::text END AS beds_bucket,
         count(DISTINCT COALESCE(s.visitor_id, s.id::text))::int AS people,
         count(*)::int AS searches,
         count(DISTINCT COALESCE(s.visitor_id, s.id::text)) FILTER (WHERE s.result_count = 0)::int AS people_unserved,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.price_max) FILTER (WHERE s.price_max > 0)::float AS median_budget,
         count(*) FILTER (WHERE s.price_max > 0)::int AS budget_sample
    FROM search_events s
   WHERE s.created_at >= NOW() - interval '90 days'
     AND $2 = ANY(s.communes)
     AND (s.purpose IS NULL OR s.purpose = $1)
   GROUP BY ROLLUP (1)
`;

const MISSING = new Set(['42P01', '42703']);

export async function getCommuneReport({ commune, purpose = 'rent' }) {
  const pool = getPool();
  const [supply, closes, searches, series, requests] = await Promise.all([
    pool.query(SUPPLY_SQL, [purpose, commune]),
    pool.query(CLOSES_SQL, [purpose, commune]),
    pool.query(SEARCH_DEMAND_SQL, [purpose, commune]).catch((err) => (MISSING.has(err?.code) ? null : Promise.reject(err))),
    getMarketSeries({ commune, purpose, months: 12 }),
    getDemandReport({ days: 90, limit: 200 }).catch(() => null),
  ]);

  const rows = supply.rows.map(summariseSupplyRow);
  const close = closes.rows[0] || {};
  const closed = Number(close.closed) || 0;

  const searchRows = searches ? searches.rows : null;
  const searchTotal = searchRows?.find((r) => r.beds_bucket === null) || null;

  const tx = purpose === 'sale' ? 'sale' : 'rent';
  const requestCells = requests
    ? requests.cells.filter((c) => c.commune === commune && (c.transaction_type == null || c.transaction_type === tx))
    : null;

  return {
    commune,
    purpose,
    generatedAt: new Date(),
    supply: {
      total: rows.find((r) => r.level === 3) || null,
      byType: rows.filter((r) => r.level === 1),
      byTypeBeds: rows.filter((r) => r.level === 0),
    },
    series,
    closes: {
      closed,
      medianAchieved: suppressed(close.median_achieved, closed),
      medianGapPct: closed >= MIN_SAMPLE && close.median_gap_pct != null ? Math.round(Number(close.median_gap_pct) * 10) / 10 : null,
      medianDays: suppressed(close.median_days, closed),
    },
    demand: {
      searchesAvailable: searchRows != null,
      searches: searchTotal
        ? {
            people: Number(searchTotal.people),
            searches: Number(searchTotal.searches),
            unserved: Number(searchTotal.people_unserved),
            medianBudget: suppressed(searchTotal.median_budget, searchTotal.budget_sample),
          }
        : { people: 0, searches: 0, unserved: 0, medianBudget: null },
      searchesByBeds: (searchRows || [])
        .filter((r) => r.beds_bucket !== null)
        .map((r) => ({
          beds: r.beds_bucket,
          people: Number(r.people),
          unserved: Number(r.people_unserved),
          medianBudget: suppressed(r.median_budget, r.budget_sample),
        }))
        .sort((a, b) => bedsBucket.order(a.beds) - bedsBucket.order(b.beds)),
      // Distinct customers per commune, rent and purchase together: the engine
      // counts people once per commune, and summing its per-cell counts would
      // count a customer who asked twice in two cells twice.
      requestsAvailable: requests != null,
      requestCustomers: requests ? Number(requests.communes.find((c) => c.commune === commune)?.customers) || 0 : null,
      requestCount: requestCells ? requestCells.reduce((n, c) => n + c.requests, 0) : null,
    },
  };
}
