'use strict';

/**
 * services/marketSnapshot.js — the monthly market record.
 *
 * On the 1st of each month (Kinshasa), the month that just ended is written to
 * `market_snapshots_monthly` (supply: stock, new listings, asking prices,
 * price cuts, closes and achieved prices, days to close, withdrawals) and
 * `market_demand_monthly` (customer requests and /listings searches, including
 * the ones that found nothing), by commune × purpose × type × bedrooms.
 * migrations/20260929_market_history.sql.
 *
 * WHY SNAPSHOTS
 * Every live figure changes the moment a listing changes. A bank that was told
 * "median rent in Limete: 650 $" in March needs March's answer to stay 650 $,
 * and a series needs one point per month computed the same way each time.
 * Rows are inserted with ON CONFLICT DO NOTHING: a month, once written, is
 * never rewritten. Re-running for a month already recorded changes nothing.
 *
 * WHAT A ROW SAYS, EXACTLY
 * - Stock and asking prices are the state when the job runs — the first hours
 *   of the next month — i.e. the month-end stock. Asking prices are live,
 *   published, active listings (the public gate), rent per month.
 * - Closes are `sold_at` inside the month, with the agent's own recorded
 *   price; a close with no price is counted but has no achieved figure.
 *   Withdrawals are listings archived inside the month without a close — not
 *   transactions, and never mixed with them.
 * - Price cuts come from property_price_history, so they exist only from the
 *   day that history started.
 * - Listings of test agents (`agents.is_test`) are excluded everywhere.
 * - Medians are stored with their sample size; suppression below the minimum
 *   sample is the reader's job, so the threshold can change without losing
 *   history.
 */

const postgres = require('./postgres');
const { db } = require('./db');

const JOB_NAME = 'market-snapshot';
const CONTENT_LANGUAGE_ID = 20;
const RUN_HOUR_KINSHASA = 3;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

const BEDS_BUCKET_SQL = (column) =>
  `CASE WHEN ${column} IS NULL THEN 'na' WHEN ${column} >= 4 THEN '4+' ELSE ${column}::int::text END`;

/** The month before `now`'s Kinshasa month, as { month: 'YYYY-MM-01', start, end } (UTC instants of Kinshasa midnights). */
function previousMonth(now = new Date()) {
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth(); // current Kinshasa month, 0-based
  const startY = month === 0 ? year - 1 : year;
  const startM = month === 0 ? 12 : month; // 1-based previous month
  return monthBounds(`${startY}-${String(startM).padStart(2, '0')}`);
}

/** '2026-09' -> the Kinshasa-local month's bounds. */
function monthBounds(yyyyMm) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm));
  if (!match) throw new Error(`month must be YYYY-MM, got '${yyyyMm}'`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return {
    month: `${match[1]}-${match[2]}-01`,
    start: new Date(`${match[1]}-${match[2]}-01T00:00:00+01:00`).toISOString(),
    end: new Date(`${next}-01T00:00:00+01:00`).toISOString(),
  };
}

const COMMUNE_EXPR = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

/**
 * $1 month (date), $2 start, $3 end. One row per commune × purpose × type ×
 * bedrooms bucket that had any listing, new, close or withdrawal.
 */
const SUPPLY_SQL = `
  WITH base AS (
    SELECT p.id, p.purpose, COALESCE(p.category_id, 0)::int AS category_id,
           ${BEDS_BUCKET_SQL('p.beds')} AS beds_bucket,
           ${COMMUNE_EXPR} AS commune,
           CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END AS ask,
           CASE WHEN p.purpose = 'rent' AND p.price_period = 'an' THEN p.sold_price / 12.0 ELSE p.sold_price END AS achieved,
           NULLIF(regexp_replace(COALESCE(p.area::text, ''), '[^0-9.]', '', 'g'), '')::numeric AS area,
           p.price, p.status, p.approve_status, p.listing_status, p.created_at, p.sold_at, p.archived_at
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.approve_status = 1 AND p.purpose IN ('rent', 'sale')
       AND NOT COALESCE(a.is_test, false)
  ),
  flagged AS (
    SELECT b.*,
           (b.status = 1 AND COALESCE(b.listing_status, 'active') = 'active' AND b.created_at < $3::timestamptz) AS active,
           (b.created_at >= $2::timestamptz AND b.created_at < $3::timestamptz) AS is_new,
           (b.listing_status = 'closed' AND b.sold_at >= ($2::timestamptz AT TIME ZONE 'Africa/Kinshasa')::date
                                          AND b.sold_at <  ($3::timestamptz AT TIME ZONE 'Africa/Kinshasa')::date) AS closed_in_month,
           (b.archived_at >= $2::timestamptz AND b.archived_at < $3::timestamptz
              AND b.listing_status IS DISTINCT FROM 'closed') AS withdrawn_in_month,
           EXISTS (
             SELECT 1 FROM (
               SELECT h.price, h.changed_at, lag(h.price) OVER (ORDER BY h.changed_at, h.id) AS previous
                 FROM property_price_history h WHERE h.property_id = b.id
             ) steps
              WHERE steps.changed_at >= $2::timestamptz AND steps.changed_at < $3::timestamptz
                AND steps.previous IS NOT NULL AND steps.price < steps.previous
           ) AS price_cut
      FROM base b
     WHERE b.commune IS NOT NULL
  )
  INSERT INTO market_snapshots_monthly (
    month, commune, purpose, category_id, beds_bucket,
    active_count, new_count, median_ask, p25_ask, p75_ask, ask_sample,
    median_ask_per_sqm, sqm_sample, price_cut_count,
    closed_count, median_achieved, median_gap_pct, achieved_sample, median_days_to_close, withdrawn_count
  )
  SELECT $1::date, commune, purpose,
         CASE WHEN GROUPING(category_id) = 1 THEN -1 ELSE category_id END,
         CASE WHEN GROUPING(beds_bucket) = 1 THEN 'all' ELSE beds_bucket END,
         count(*) FILTER (WHERE active)::int,
         count(*) FILTER (WHERE is_new)::int,
         PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY ask) FILTER (WHERE active AND ask > 0),
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ask) FILTER (WHERE active AND ask > 0),
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ask) FILTER (WHERE active AND ask > 0),
         count(*) FILTER (WHERE active AND ask > 0)::int,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ask / area) FILTER (WHERE active AND ask > 0 AND area > 0),
         count(*) FILTER (WHERE active AND ask > 0 AND area > 0)::int,
         count(*) FILTER (WHERE active AND price_cut)::int,
         count(*) FILTER (WHERE closed_in_month)::int,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY achieved) FILTER (WHERE closed_in_month AND achieved > 0),
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (achieved - ask) / ask * 100)
           FILTER (WHERE closed_in_month AND achieved > 0 AND ask > 0),
         count(*) FILTER (WHERE closed_in_month AND achieved > 0)::int,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (sold_at - (created_at AT TIME ZONE 'Africa/Kinshasa')::date))
           FILTER (WHERE closed_in_month),
         count(*) FILTER (WHERE withdrawn_in_month)::int
    FROM flagged
   -- Each type × bedrooms cell, plus one "every type, every size" row per
   -- commune and purpose (category_id -1, beds 'all'): a median cannot be
   -- rebuilt from the cells' medians afterwards, so the total is computed here.
   GROUP BY GROUPING SETS ((commune, purpose, category_id, beds_bucket), (commune, purpose))
  HAVING count(*) FILTER (WHERE active OR is_new OR closed_in_month OR withdrawn_in_month) > 0
  ON CONFLICT DO NOTHING
`;

/** $1 start, $2 end. Searches per commune named (an unnamed commune is "Kinshasa" as a whole). */
const SEARCH_DEMAND_SQL = `
  SELECT COALESCE(c.commune, 'Kinshasa') AS commune,
         COALESCE(s.purpose, 'any') AS purpose,
         ${BEDS_BUCKET_SQL('s.beds_min')} AS beds_bucket,
         count(*)::int AS searches,
         count(*) FILTER (WHERE s.result_count = 0)::int AS zero_result
    FROM search_events s
    LEFT JOIN LATERAL unnest(CASE WHEN cardinality(s.communes) > 0 THEN s.communes ELSE ARRAY[NULL::text] END) AS c(commune) ON true
   WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
   GROUP BY 1, 2, 3
`;

const PURPOSE_OF_TRANSACTION = { location: 'rent', vente: 'sale', rent: 'rent', sale: 'sale' };

function bedsBucket(value) {
  if (value == null || value === '') return 'na';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'na';
  return n >= 4 ? '4+' : String(Math.max(0, Math.trunc(n)));
}

/** SQLite `YYYY-MM-DD HH:MM:SS` (UTC) bounds for an ISO range. */
function sqliteTime(iso) {
  return iso.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, '');
}

/**
 * Customer requests from this engine's SQLite: search requests only (no
 * property_id — a visit request names a listing, it is not a demand signal
 * for a commune), counted once in each commune the request names.
 */
function leadDemand(start, end) {
  const rows = db.prepare(
    `SELECT commune, communes, transaction_type, bedrooms FROM leads
      WHERE property_id IS NULL AND created_at >= ? AND created_at < ?`,
  ).all(sqliteTime(start), sqliteTime(end));
  const counts = new Map();
  for (const row of rows) {
    let communes = [];
    try {
      communes = row.communes ? JSON.parse(row.communes) : [];
    } catch {
      communes = [];
    }
    if (!Array.isArray(communes) || !communes.length) communes = row.commune ? [row.commune] : ['Kinshasa'];
    const purpose = PURPOSE_OF_TRANSACTION[row.transaction_type] || 'any';
    for (const commune of new Set(communes.filter(Boolean))) {
      const key = `${commune}|${purpose}|${bedsBucket(row.bedrooms)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Writes one month. Returns the rows written per table; 0 on a re-run.
 * @param {{month?: string, now?: Date, pool?: import('pg').Pool, dryRun?: boolean}} options  `month` 'YYYY-MM', default the previous month.
 */
async function runMarketSnapshot({ month = null, now = new Date(), pool = postgres.getPool(), dryRun = false } = {}) {
  const bounds = month ? monthBounds(month) : previousMonth(now);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '180s'");
    const supply = await client.query(SUPPLY_SQL, [bounds.month, bounds.start, bounds.end]);

    const demand = new Map();
    const add = (key, field, n) => {
      const entry = demand.get(key) || { leads: 0, searches: 0, zero: 0 };
      entry[field] += n;
      demand.set(key, entry);
    };
    for (const [key, n] of leadDemand(bounds.start, bounds.end)) add(key, 'leads', n);
    try {
      await client.query('SAVEPOINT searches');
      const { rows } = await client.query(SEARCH_DEMAND_SQL, [bounds.start, bounds.end]);
      for (const row of rows) {
        const key = `${row.commune}|${row.purpose}|${row.beds_bucket}`;
        add(key, 'searches', row.searches);
        add(key, 'zero', row.zero_result);
      }
    } catch (err) {
      if (err.code !== '42P01') throw err;
      await client.query('ROLLBACK TO SAVEPOINT searches'); // search_events not migrated yet
    }

    let demandRows = 0;
    for (const [key, entry] of demand) {
      const [commune, purpose, beds] = key.split('|');
      const { rowCount } = await client.query(
        `INSERT INTO market_demand_monthly (month, commune, purpose, beds_bucket, leads, searches, zero_result_searches)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [bounds.month, commune, purpose, beds, entry.leads, entry.searches, entry.zero],
      );
      demandRows += rowCount;
    }
    // A dry run computes and counts everything, then writes nothing.
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return { month: bounds.month, supplyRows: supply.rowCount, demandRows, dryRun };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The 1st of the month, 3h Kinshasa, once. */
function snapshotDue(now = new Date()) {
  if (!postgres.isConfigured()) return false;
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  if (local.getUTCDate() !== 1 || local.getUTCHours() !== RUN_HOUR_KINSHASA) return false;
  const last = require('./db').getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  const at = Date.parse(`${String(last.succeeded_at).replace(' ', 'T')}Z`);
  return !Number.isFinite(at) || now.getTime() - at >= MIN_GAP_MS;
}

const marketSnapshotJob = {
  name: JOB_NAME,
  shouldRun: snapshotDue,
  run: async () => {
    const result = await runMarketSnapshot();
    console.log(`[scheduler] ${JOB_NAME} ${result.month}: ${result.supplyRows} supply row(s), ${result.demandRows} demand row(s)`);
    return result;
  },
};

module.exports = {
  JOB_NAME,
  SUPPLY_SQL,
  SEARCH_DEMAND_SQL,
  monthBounds,
  previousMonth,
  bedsBucket,
  leadDemand,
  runMarketSnapshot,
  snapshotDue,
  marketSnapshotJob,
};
