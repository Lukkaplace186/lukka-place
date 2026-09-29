import 'server-only';
import { getPool } from './db';
import { MIN_SAMPLE } from './marketBenchmarks';

/**
 * The monthly market record (engine services/marketSnapshot.js), read back for
 * /admin/market-data's "Évolution" and the printable commune report.
 *
 * Medians are shown only at MIN_SAMPLE or more (the same bar as the closed
 * benchmarks); below it the row keeps its count and prints "—". A missing
 * table (migration not run) is an empty series, never an error.
 */

const MISSING = new Set(['42P01', '42703']);

export const SERIES_SQL = `
  SELECT s.month, s.active_count, s.new_count, s.median_ask, s.ask_sample, s.median_ask_per_sqm, s.sqm_sample,
         s.price_cut_count, s.closed_count, s.median_achieved, s.median_gap_pct, s.achieved_sample,
         s.median_days_to_close, s.withdrawn_count,
         d.leads, d.searches, d.zero_result_searches
    FROM market_snapshots_monthly s
    LEFT JOIN (
      SELECT month, SUM(leads)::int AS leads, SUM(searches)::int AS searches, SUM(zero_result_searches)::int AS zero_result_searches
        FROM market_demand_monthly
       WHERE commune = $1 AND purpose IN ($2, 'any')
       GROUP BY month
    ) d ON d.month = s.month
   WHERE s.commune = $1 AND s.purpose = $2 AND s.category_id = -1 AND s.beds_bucket = 'all'
   ORDER BY s.month DESC
   LIMIT $3
`;

const suppress = (value, sample) => (value != null && Number(sample) >= MIN_SAMPLE ? Math.round(Number(value)) : null);

/** Pure: one snapshot row as the page shows it — medians only above the minimum sample. */
export function toSeriesRow(row) {
  return {
    month: row.month instanceof Date ? row.month.toISOString().slice(0, 7) : String(row.month).slice(0, 7),
    active: Number(row.active_count) || 0,
    added: Number(row.new_count) || 0,
    medianAsk: suppress(row.median_ask, row.ask_sample),
    askSample: Number(row.ask_sample) || 0,
    medianPerSqm: suppress(row.median_ask_per_sqm, row.sqm_sample),
    priceCuts: Number(row.price_cut_count) || 0,
    closed: Number(row.closed_count) || 0,
    medianAchieved: suppress(row.median_achieved, row.achieved_sample),
    medianGapPct: row.median_gap_pct != null && Number(row.achieved_sample) >= MIN_SAMPLE ? Math.round(Number(row.median_gap_pct) * 10) / 10 : null,
    medianDaysToClose: row.median_days_to_close != null && Number(row.closed_count) >= MIN_SAMPLE ? Math.round(Number(row.median_days_to_close)) : null,
    withdrawn: Number(row.withdrawn_count) || 0,
    leads: row.leads == null ? null : Number(row.leads),
    searches: row.searches == null ? null : Number(row.searches),
    zeroResultSearches: row.zero_result_searches == null ? null : Number(row.zero_result_searches),
  };
}

/** Newest month first. `{ rows: [], available: false }` before the migration. */
export async function getMarketSeries({ commune, purpose = 'rent', months = 12 }) {
  if (!commune) return { rows: [], available: true };
  try {
    const { rows } = await getPool().query(SERIES_SQL, [commune, purpose, Math.min(Math.max(Number(months) || 12, 1), 36)]);
    return { rows: rows.map(toSeriesRow), available: true };
  } catch (err) {
    if (MISSING.has(err?.code)) return { rows: [], available: false };
    throw err;
  }
}

/**
 * "What people look for and do not find": the last N days of /listings
 * searches that matched nothing, grouped by commune × purpose × bedrooms ×
 * budget band. Live, from search_events — the demand a developer can build
 * for. Counted once per visitor so one person retrying is not ten people.
 */
export const UNMET_DEMAND_SQL = `
  SELECT COALESCE(c.commune, 'Kinshasa') AS commune,
         COALESCE(s.purpose, 'any') AS purpose,
         s.beds_min,
         CASE
           WHEN s.price_max IS NULL THEN NULL
           WHEN s.purpose = 'sale' THEN width_bucket(s.price_max, ARRAY[25000, 50000, 100000, 150000, 250000, 500000]::numeric[])
           ELSE width_bucket(s.price_max, ARRAY[200, 400, 600, 800, 1000, 1500, 2000]::numeric[])
         END AS budget_band,
         MAX(s.price_max) AS budget_max,
         count(DISTINCT COALESCE(s.visitor_id, s.id::text))::int AS people,
         count(*)::int AS searches
    FROM search_events s
    LEFT JOIN LATERAL unnest(CASE WHEN cardinality(s.communes) > 0 THEN s.communes ELSE ARRAY[NULL::text] END) AS c(commune) ON true
   WHERE s.result_count = 0 AND s.created_at >= NOW() - ($1 || ' days')::interval
   GROUP BY 1, 2, 3, 4
   ORDER BY people DESC, searches DESC
   LIMIT $2
`;

export async function getUnmetDemand({ days = 30, limit = 20 } = {}) {
  try {
    const { rows } = await getPool().query(UNMET_DEMAND_SQL, [String(days), limit]);
    return {
      available: true,
      rows: rows.map((row) => ({
        commune: row.commune,
        purpose: row.purpose,
        bedsMin: row.beds_min == null ? null : Number(row.beds_min),
        budgetMax: row.budget_max == null ? null : Number(row.budget_max),
        people: Number(row.people),
        searches: Number(row.searches),
      })),
    };
  } catch (err) {
    if (MISSING.has(err?.code)) return { available: false, rows: [] };
    throw err;
  }
}
