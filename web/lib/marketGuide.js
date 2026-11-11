import 'server-only';
import { getPool } from './db';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';
import {
  MARKET_WINDOW_DAYS,
  RECENT_DAYS,
  RECENT_WEIGHT,
  RESIDENTIAL_KINDS,
  STILL_LISTED_DAYS,
} from './marketObservationRules';

/**
 * The price guide ("Combien coûte… ?", /combien-coute) and the admin commune
 * comparison, from TWO kinds of asking price:
 *
 *  - **Lukka Place listings**: live long-term rentals under the public gate
 *    (`status = 1 AND approve_status = 1`), as before.
 *  - **Market observations** (`market_observations`, engine
 *    services/marketObservations.js): adverts seen in 2026 on SmartImmo,
 *    IMCongo, Immo24, Alain Realty, our WhatsApp group captures, and posts a
 *    team member read on Facebook or Zwandako. Facts only; no observation is
 *    ever shown as a listing.
 *
 * Same rules on both sides: rent per month (yearly ÷ 12), no day/week rates,
 * no furnished homes (a different, expat market that doubles a median —
 * Immo24's furnished one-bedroom in Gombe asks 2,500 $), 1–5 bedrooms, a
 * commune. Observations also need a home kind (RESIDENTIAL_KINDS), an advert
 * from the last MARKET_WINDOW_DAYS still online in the last STILL_LISTED_DAYS,
 * and no exclusion.
 *
 * **Never counted twice:**
 *  - a group capture published on Lukka Place carries its `property_id`; while
 *    that listing is public it is counted as a Lukka listing, and when it was
 *    rejected or deleted it is not counted at all;
 *  - the same flat posted on several sites: within a commune × bedrooms, one
 *    rounded price seen at several sources counts as many times as the source
 *    that shows it most (MAX of the per-source counts), never their sum. Two
 *    different flats at exactly the same price on two sites are therefore
 *    counted once — the conservative error.
 *
 * **Recent adverts weigh more** (owner, 2026-11-05): in the median and the
 * p25–p75 range, a row posted in the last RECENT_DAYS counts RECENT_WEIGHT
 * times (`recent` on each row, carried through the de-duplication as the
 * recent share of a point). `listings` stays the real count — the weight
 * moves the figure, never the number of adverts we say it rests on.
 */

export const COMMUNE_EXPR = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
  LIMIT 1
)`;

/** Lukka Place's own live long-term rentals, one row each. */
export const LUKKA_RENTS_SQL = `
  SELECT ${COMMUNE_EXPR} AS commune, p.beds::int AS beds,
         (CASE WHEN p.price_period = 'an' THEN p.price / 12.0 ELSE p.price END)::numeric AS amount,
         'lukka'::text AS src,
         (GREATEST(p.created_at, COALESCE((to_jsonb(p) ->> 'moderated_at')::timestamptz, p.created_at))
            >= NOW() - INTERVAL '${RECENT_DAYS} days') AS recent
    FROM properties p
   WHERE p.status = 1 AND p.approve_status = 1
     AND p.purpose = 'rent' AND p.price > 0
     AND COALESCE(p.price_period, '') NOT IN ('jour', 'semaine')
     AND COALESCE((to_jsonb(p) ->> 'furnished')::boolean, false) = false
     AND p.beds BETWEEN 1 AND 5
     AND ${NOT_TEST_LISTING_SQL}
`;

/**
 * Market observations that count, one row each. $2 = residential kinds.
 * `asOf` is the SQL instant the rules are read at: NOW() for the guide, a bound
 * parameter when the Lukka Index recomputes the figure as of an earlier day
 * (lib/lukkaIndex.js) — one text, so the two can never apply different rules.
 */
export function marketRentsSql(asOf = 'NOW()') {
  return `
  SELECT o.commune, o.beds::int AS beds, o.monthly_usd::numeric AS amount, o.source AS src,
         (COALESCE(o.posted_at, o.first_seen_at) >= ${asOf} - INTERVAL '${RECENT_DAYS} days') AS recent
    FROM market_observations o
   WHERE o.excluded_reason IS NULL
     AND o.purpose = 'rent'
     AND o.monthly_usd > 0
     AND o.furnished IS NOT TRUE
     AND o.property_kind = ANY($2::text[])
     AND o.beds BETWEEN 1 AND 5
     AND o.commune IS NOT NULL
     AND COALESCE(o.posted_at, o.first_seen_at) >= ${asOf} - INTERVAL '${MARKET_WINDOW_DAYS} days'
     AND COALESCE(o.posted_at, o.first_seen_at) <= ${asOf}
     AND o.last_seen_at >= ${asOf} - INTERVAL '${STILL_LISTED_DAYS} days'
     AND NOT EXISTS (
       SELECT 1 FROM properties lp
        WHERE lp.id = o.property_id
          AND ((lp.status = 1 AND lp.approve_status = 1)
               OR lp.approve_status = 2
               OR (to_jsonb(lp) ->> 'deleted_at') IS NOT NULL)
     )
`;
}

export const MARKET_RENTS_SQL = marketRentsSql();

/**
 * The blended guide: every commune × bedrooms with at least $1 listings after
 * de-duplication. $1 min sample, $2 residential kinds. `weighted` repeats each
 * point once per older advert and RECENT_WEIGHT times per recent one — an
 * integer-weighted median without a custom aggregate.
 */
export const BLENDED_GUIDES_SQL = `
  WITH all_rows AS (
    ${LUKKA_RENTS_SQL}
    UNION ALL
    ${MARKET_RENTS_SQL}
  ),
  per_src AS (
    SELECT commune, beds, ROUND(amount)::int AS amt, src, COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE recent)::int AS r
      FROM all_rows WHERE commune IS NOT NULL
     GROUP BY commune, beds, ROUND(amount), src
  ),
  points AS (
    SELECT commune, beds, amt, MAX(n)::int AS n, LEAST(MAX(r), MAX(n))::int AS r,
           COALESCE(MAX(n) FILTER (WHERE src = 'lukka'), 0)::int AS lukka_n
      FROM per_src GROUP BY commune, beds, amt
  ),
  counted AS (
    SELECT commune, beds, SUM(n)::int AS listings FROM points GROUP BY commune, beds
    HAVING SUM(n) >= $1
  ),
  weighted AS (
    SELECT commune, beds, amt FROM points,
           generate_series(1, (points.n - points.r) + points.r * ${RECENT_WEIGHT})
  ),
  stats AS (
    SELECT w.commune, w.beds, c.listings,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.amt)::float AS median,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY w.amt)::float AS p25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY w.amt)::float AS p75
      FROM weighted w JOIN counted c ON c.commune = w.commune AND c.beds = w.beds
     GROUP BY w.commune, w.beds, c.listings
  ),
  lukka AS (
    SELECT commune, beds, SUM(lukka_n)::int AS lukka FROM points GROUP BY commune, beds
  ),
  sources AS (
    SELECT commune, beds, jsonb_object_agg(src, n) AS sources
      FROM (SELECT commune, beds, src, SUM(n)::int AS n FROM per_src WHERE src <> 'lukka' GROUP BY commune, beds, src) s
     GROUP BY commune, beds
  )
  SELECT s.commune, s.beds, s.listings, s.median, s.p25, s.p75,
         COALESCE(l.lukka, 0)::int AS lukka_listings,
         COALESCE(src.sources, '{}'::jsonb) AS sources
    FROM stats s
    LEFT JOIN lukka l ON l.commune = s.commune AND l.beds = s.beds
    LEFT JOIN sources src ON src.commune = s.commune AND src.beds = s.beds
   ORDER BY s.listings DESC, s.commune, s.beds
`;

/** Before the migration: Lukka listings only, the guide as it was. $1 min sample. */
export const LUKKA_ONLY_GUIDES_SQL = `
  WITH all_rows AS (${LUKKA_RENTS_SQL})
  SELECT commune, beds, COUNT(*)::int AS listings,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median,
         PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount)::float AS p25,
         PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount)::float AS p75,
         COUNT(*)::int AS lukka_listings, '{}'::jsonb AS sources
    FROM all_rows WHERE commune IS NOT NULL
   GROUP BY commune, beds
  HAVING COUNT(*) >= $1
   ORDER BY COUNT(*) DESC, commune, beds
`;

const isMissingTable = (err) => err?.code === '42P01' || err?.code === '42703';

/**
 * Guide rows `{ commune, beds, listings, median, p25, p75, lukkaListings, sources }`.
 * Falls back to Lukka listings only when the table is not there yet.
 */
export async function queryPriceGuides(minSample, { pool = getPool() } = {}) {
  try {
    const { rows } = await pool.query(BLENDED_GUIDES_SQL, [minSample, RESIDENTIAL_KINDS]);
    return rows;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    const { rows } = await pool.query(LUKKA_ONLY_GUIDES_SQL, [minSample]);
    return rows;
  }
}

// ---------------------------------------------------------------------------
// Admin: the commune comparison, the sources, the list
// ---------------------------------------------------------------------------

/**
 * Lukka Place vs the rest of the market, commune × bedrooms, each side on its
 * own (no de-duplication across the two — this compares them). $1 kinds.
 */
export const COMPARISON_SQL = `
  WITH lukka AS (${LUKKA_RENTS_SQL}),
  market AS (${MARKET_RENTS_SQL.replace('$2::text[]', '$1::text[]')}),
  l AS (
    SELECT commune, beds, COUNT(*)::int AS n,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median
      FROM lukka WHERE commune IS NOT NULL GROUP BY commune, beds
  ),
  m AS (
    SELECT commune, beds, COUNT(*)::int AS n,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount)::float AS median
      FROM market GROUP BY commune, beds
  )
  SELECT COALESCE(l.commune, m.commune) AS commune, COALESCE(l.beds, m.beds) AS beds,
         COALESCE(l.n, 0) AS lukka_n, l.median AS lukka_median,
         COALESCE(m.n, 0) AS market_n, m.median AS market_median
    FROM l FULL OUTER JOIN m ON m.commune = l.commune AND m.beds = l.beds
   ORDER BY COALESCE(l.n, 0) + COALESCE(m.n, 0) DESC, 1, 2
`;

export async function getMarketComparison({ pool = getPool() } = {}) {
  try {
    const { rows } = await pool.query(COMPARISON_SQL, [RESIDENTIAL_KINDS]);
    return { rows, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { rows: [], available: false };
    throw err;
  }
}

export const SOURCE_SUMMARY_SQL = `
  SELECT o.source,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE o.excluded_reason IS NULL)::int AS usable,
         COUNT(*) FILTER (WHERE o.excluded_reason IS NOT NULL)::int AS excluded,
         COUNT(*) FILTER (WHERE o.excluded_reason IS NULL AND o.purpose = 'rent'
                           AND o.last_seen_at >= NOW() - INTERVAL '${STILL_LISTED_DAYS} days')::int AS live_rents,
         MAX(o.last_seen_at) AS last_seen_at,
         r.last_run_at, r.last_ok_at, r.last_error
    FROM market_observations o
    LEFT JOIN market_source_runs r ON r.source = o.source
   GROUP BY o.source, r.last_run_at, r.last_ok_at, r.last_error
  UNION ALL
  SELECT r.source, 0, 0, 0, 0, NULL, r.last_run_at, r.last_ok_at, r.last_error
    FROM market_source_runs r
   WHERE NOT EXISTS (SELECT 1 FROM market_observations o WHERE o.source = r.source)
`;

export async function getSourceSummary({ pool = getPool() } = {}) {
  try {
    const { rows } = await pool.query(SOURCE_SUMMARY_SQL);
    return { rows, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { rows: [], available: false };
    throw err;
  }
}

export const LIST_SQL = `
  SELECT id, source, source_url, posted_at, first_seen_at, last_seen_at, purpose, property_kind, beds,
         furnished, price, currency, price_period, monthly_usd, commune, quartier, title, excluded_reason,
         property_id, recorded_by
    FROM market_observations
   WHERE ($1::text IS NULL OR source = $1)
     AND ($2::text IS NULL OR commune = $2)
     AND ($3::text IS NULL
          OR ($3 = 'excluded' AND excluded_reason IS NOT NULL)
          OR ($3 = 'counted' AND excluded_reason IS NULL))
   ORDER BY COALESCE(posted_at, first_seen_at) DESC, id DESC
   LIMIT $4 OFFSET $5
`;

export const COUNT_SQL = `
  SELECT COUNT(*)::int AS n FROM market_observations
   WHERE ($1::text IS NULL OR source = $1)
     AND ($2::text IS NULL OR commune = $2)
     AND ($3::text IS NULL
          OR ($3 = 'excluded' AND excluded_reason IS NOT NULL)
          OR ($3 = 'counted' AND excluded_reason IS NULL))
`;

export async function listObservations({ source = null, commune = null, state = null, limit = 50, offset = 0 } = {}, { pool = getPool() } = {}) {
  const params = [source, commune, state];
  try {
    const [list, count] = await Promise.all([
      pool.query(LIST_SQL, [...params, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)]),
      pool.query(COUNT_SQL, params),
    ]);
    return { rows: list.rows, total: count.rows[0]?.n ?? 0, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { rows: [], total: 0, available: false };
    throw err;
  }
}

export const INSERT_MANUAL_SQL = `
  INSERT INTO market_observations (
    source, source_ref, source_url, posted_at, purpose, property_kind, beds, furnished, price, currency,
    price_period, monthly_usd, price_usd, city, commune, quartier, title, recorded_by, first_seen_at, last_seen_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Kinshasa', $14, $15, $16, $17, NOW(), NOW())
  ON CONFLICT (source, source_ref) DO NOTHING
  RETURNING id
`;

/** @returns {Promise<{id: number}|{duplicate: true}>} */
export async function insertManualObservation(value, sourceRef, recordedBy, { pool = getPool() } = {}) {
  const { rows } = await pool.query(INSERT_MANUAL_SQL, [
    value.source, sourceRef, value.source_url, value.posted_at, value.purpose, value.property_kind, value.beds,
    value.furnished, value.price, value.currency, value.price_period, value.monthly_usd, value.price_usd,
    value.commune, value.quartier, value.title, recordedBy || null,
  ]);
  return rows[0] ? { id: rows[0].id } : { duplicate: true };
}

/**
 * Exclude ('manual:<code>', kept by the nightly refresh) or restore (NULL).
 * Restoring an automatic exclusion (price out of range…) is refused: the
 * figure itself is what is wrong, and the next refresh would set it again.
 */
export const SET_EXCLUSION_SQL = `
  UPDATE market_observations
     SET excluded_reason = $2, updated_at = NOW()
   WHERE id = $1
     AND ($2::text IS NOT NULL OR excluded_reason IS NULL OR excluded_reason LIKE 'manual:%')
  RETURNING id, excluded_reason
`;

export async function setObservationExclusion(id, reason, { pool = getPool() } = {}) {
  const { rows } = await pool.query(SET_EXCLUSION_SQL, [id, reason]);
  return rows[0] || null;
}
