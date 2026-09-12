import 'server-only';
import { getPool } from './db';

/**
 * Internal benchmark pricing, built from real closed transactions.
 *
 * WHAT MAKES THIS WORTH ANYTHING
 * No public source has achieved prices for Kinshasa. `properties.sold_price`
 * against `properties.price` is the one thing this product holds that nobody
 * else does, and it exists because the WhatsApp decline survey asks the agent
 * what a property actually closed at (services/viewingNotifications.js) and
 * the dashboard's "marquer comme vendu" requires a figure and a date.
 *
 * BUILT ON lib/dataExport.js, NOT FORKED FROM IT
 * That module already defines what a closed transaction is, which rows count
 * (`approve_status = 1` only — filtering on `status` would drop every sold
 * listing, which is the entire dataset here), and how days-on-market is
 * derived. A second definition of "a closed deal" would drift from the one
 * the exported CSV states, and a bank holding both would find them
 * disagreeing. The SQL below repeats those conventions deliberately and they
 * must be changed together.
 *
 * THREE HONESTY RULES, and they are the reason to trust the number:
 *
 *  1. **A cell below MIN_SAMPLE is suppressed, not shown small.** A "median"
 *     of two sales is not a median, it is two sales. Suppressed cells report
 *     their real count so the reader can see the data is coming rather than
 *     absent.
 *  2. **Communes are derived from the data, never hardcoded.** Gombe,
 *     Ngaliema and Lingwala are where volume is expected, not a fixed list;
 *     hardcoding them would render empty rows for communes that have never
 *     transacted and hide the first sale in one that has.
 *  3. **Nothing is imputed.** A missing `sold_price` excludes that listing
 *     from the achieved-price figures rather than being filled with the
 *     asking price, which would make the negotiation gap look like zero — the
 *     exact number this dataset exists to measure.
 *
 * At the time of writing there are very few closed transactions in
 * production, so most of this table is legitimately empty. That is the honest
 * state of the market record, not a bug to paper over, and it fills in on its
 * own as agents answer the survey.
 */

/**
 * Below this, a median is not reported.
 *
 * Five is a judgement call, and a deliberately conservative one: this figure
 * is meant to be quotable to a bank, and the cost of publishing a wrong
 * median is much higher than the cost of publishing "pas encore assez de
 * données".
 */
export const MIN_SAMPLE = 5;

/**
 * `approve_status = 1` ONLY — the same deliberate departure from the public
 * `status = 1 AND approve_status = 1` gate that lib/dataExport.js makes, and
 * for the same reason: closing a transaction sets `status = 0`, so filtering
 * on it would drop every row that carries a sold price.
 */
const BENCHMARK_SQL = `
  WITH closed AS (
    SELECT
      (
        SELECT ac.name FROM property_amenities pa
        JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
        WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
        LIMIT 1
      )                                              AS commune,
      p.purpose,
      catc.name                                      AS property_type,
      p.price                                        AS asking_price,
      p.sold_price,
      CASE WHEN p.price > 0
           THEN ((p.sold_price - p.price) / p.price) * 100 END AS price_delta_pct,
      GREATEST(0, EXTRACT(DAY FROM (
        COALESCE(p.sold_at::timestamp, p.updated_at) - p.created_at
      ))::int)                                       AS days_on_market
    FROM properties p
    LEFT JOIN property_categories cat ON cat.id = p.category_id
    LEFT JOIN property_category_contents catc
      ON catc.category_id = cat.id AND catc.language_id = 26
    WHERE p.approve_status = 1
      AND p.listing_status = 'closed'
      -- No imputation: a close with no recorded figure cannot contribute to
      -- an achieved-price median, and must not be stood in for by the asking
      -- price.
      AND p.sold_price IS NOT NULL
      AND p.price IS NOT NULL
  )
  SELECT
    commune,
    purpose,
    property_type,
    COUNT(*)::int                                                    AS sample,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY asking_price)        AS median_asking,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sold_price)          AS median_achieved,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_delta_pct)     AS median_delta_pct,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_on_market)      AS median_days_on_market
  FROM closed
  WHERE commune IS NOT NULL
  GROUP BY commune, purpose, property_type
  ORDER BY commune, purpose, property_type
`;

/**
 * One row per commune × purpose × property_type that has at least one
 * recorded closed transaction.
 *
 * Rows below MIN_SAMPLE come back with `suppressed: true` and every median
 * nulled — the count survives, because "3 sales so far" is useful and honest
 * where a median of 3 sales is not.
 *
 * @returns {Promise<Array<{
 *   commune: string, purpose: string, propertyType: string|null, sample: number,
 *   suppressed: boolean, medianAsking: number|null, medianAchieved: number|null,
 *   medianDeltaPct: number|null, medianDaysOnMarket: number|null }>>}
 */
export async function getMarketBenchmarks() {
  const pool = getPool();
  const { rows } = await pool.query(BENCHMARK_SQL);
  return rows.map(summariseRow);
}

/**
 * The suppression rule, split out so it can be tested without a database and
 * so there is exactly one place that decides what "not enough data" means.
 */
export function summariseRow(row) {
  const sample = Number(row.sample) || 0;
  const suppressed = sample < MIN_SAMPLE;
  const num = (value) => (value == null ? null : Number(value));
  return {
    commune: row.commune,
    purpose: row.purpose,
    propertyType: row.property_type ?? null,
    sample,
    suppressed,
    medianAsking: suppressed ? null : num(row.median_asking),
    medianAchieved: suppressed ? null : num(row.median_achieved),
    medianDeltaPct: suppressed ? null : num(row.median_delta_pct),
    medianDaysOnMarket: suppressed ? null : num(row.median_days_on_market),
  };
}

/**
 * The communes that actually appear, in the order the rows arrived.
 *
 * Derived, never hardcoded — see honesty rule 2. A commune with only
 * suppressed rows still appears, because "Gombe: 3 ventes, pas encore assez
 * pour une médiane" is a truer thing to show than an absent row that reads as
 * "no activity".
 */
export function communesRepresented(rows) {
  return [...new Set(rows.map((r) => r.commune).filter(Boolean))];
}

/**
 * Totals across the whole table, for the page header.
 *
 * `reportable` is the count of cells that cleared MIN_SAMPLE — the honest
 * headline for how much of this dataset can actually be quoted yet.
 */
export function benchmarkTotals(rows) {
  return {
    transactions: rows.reduce((sum, r) => sum + r.sample, 0),
    cells: rows.length,
    reportable: rows.filter((r) => !r.suppressed).length,
    communes: communesRepresented(rows).length,
  };
}
