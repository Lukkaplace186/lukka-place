import 'server-only';
import { getPool } from './db';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';
import { COMMUNE_EXPR, marketRentsSql } from './marketGuide';
import { RECENT_DAYS, RECENT_WEIGHT, RESIDENTIAL_KINDS } from './marketObservationRules';

/**
 * The Lukka Index (/indice-lukka): the median asking rent per commune, from
 * Lukka Place's public listings AND the asking prices seen elsewhere
 * (market_observations), with the price guide's rules (lib/marketGuide.js):
 * long-term rentals, 1–5 bedrooms, unfurnished, rent per month, one advert
 * seen on several sources counted once, adverts of the last RECENT_DAYS
 * weighing RECENT_WEIGHT in the figures (never in the count). The guide works
 * per commune × bedrooms; the index pools the bedroom counts of a commune
 * (the de-duplication still keys on the bedrooms, so a 2- and a 3-bedroom at
 * the same price stay two adverts).
 *
 * **As of a day.** The same SQL is run as of today and as of one month
 * earlier, so the change compares two figures computed the same way:
 *  - an observation counts at D when it was posted (else first seen) on or
 *    before D, in the MARKET_WINDOW_DAYS before D, and seen online in the
 *    STILL_LISTED_DAYS before D;
 *  - a Lukka listing counts at D when it was approved (`approve_status = 1`),
 *    created and moderated by D, and public at D: still public today, or
 *    archived / closed after D. A listing suspended (status 0) without an
 *    archive date is left out of past days — when it went offline is unknown.
 *    Its price at D is the last `property_price_history` entry on or before D,
 *    else its current price.
 * Exclusions made since D apply to D as well: a correction corrects the past.
 *
 * External collection began on 4 November 2026 (INDEX_COMPARABLE_FROM). An
 * earlier day could only be rebuilt from adverts that were still online after
 * that, so no change is computed against a day before it.
 *
 * $1 as-of instant, $2 residential kinds, $3 minimum sample.
 */

/** First day the external sources were collected (docs/claude/market-data.md). */
export const INDEX_COMPARABLE_FROM = '2026-11-04';
const COMPARABLE_FROM_INSTANT = new Date(`${INDEX_COMPARABLE_FROM}T00:00:00+01:00`);
/** The method page's date: blended index from this day (owner request, 2026-11-11). */
export const INDEX_METHOD_SINCE = '2026-11-11';

const AS_OF = '$1::timestamptz';

/** Lukka Place's long-term rentals as they stood at $1. */
export const LUKKA_RENTS_AS_OF_SQL = `
  SELECT ${COMMUNE_EXPR} AS commune, p.beds::int AS beds,
         (CASE WHEN p.price_period = 'an' THEN px.price / 12.0 ELSE px.price END)::numeric AS amount,
         'lukka'::text AS src,
         (GREATEST(p.created_at, COALESCE((to_jsonb(p) ->> 'moderated_at')::timestamptz, p.created_at))
            >= ${AS_OF} - INTERVAL '${RECENT_DAYS} days') AS recent
    FROM properties p
    CROSS JOIN LATERAL (
      SELECT COALESCE((
        SELECT h.price FROM property_price_history h
         WHERE h.property_id = p.id AND h.changed_at <= ${AS_OF}
           AND (h.purpose IS NULL OR h.purpose = p.purpose)
         ORDER BY h.changed_at DESC, h.id DESC LIMIT 1
      ), p.price) AS price
    ) px
   WHERE p.approve_status = 1
     AND p.created_at <= ${AS_OF}
     AND COALESCE((to_jsonb(p) ->> 'moderated_at')::timestamptz, p.created_at) <= ${AS_OF}
     AND (p.status = 1
          OR (to_jsonb(p) ->> 'archived_at')::timestamptz > ${AS_OF}
          OR (to_jsonb(p) ->> 'sold_at')::timestamptz > ${AS_OF})
     AND p.purpose = 'rent' AND px.price > 0
     AND COALESCE(p.price_period, '') NOT IN ('jour', 'semaine')
     AND COALESCE((to_jsonb(p) ->> 'furnished')::boolean, false) = false
     AND p.beds BETWEEN 1 AND 5
     AND ${NOT_TEST_LISTING_SQL}
`;

export const MARKET_RENTS_AS_OF_SQL = marketRentsSql(AS_OF);

/**
 * One row per commune with at least $3 adverts after de-duplication:
 * listings (the real count), lukka_listings, median / p25 / p75 (weighted),
 * sources (per-source counts BEFORE de-duplication, so named, never summed).
 */
export const LUKKA_INDEX_SQL = `
  WITH all_rows AS (
    ${LUKKA_RENTS_AS_OF_SQL}
    UNION ALL
    ${MARKET_RENTS_AS_OF_SQL}
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
    SELECT commune, SUM(n)::int AS listings, SUM(lukka_n)::int AS lukka_listings
      FROM points GROUP BY commune
    HAVING SUM(n) >= $3
  ),
  weighted AS (
    SELECT commune, amt FROM points,
           generate_series(1, (points.n - points.r) + points.r * ${RECENT_WEIGHT})
  ),
  stats AS (
    SELECT w.commune,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY w.amt)::float AS median,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY w.amt)::float AS p25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY w.amt)::float AS p75
      FROM weighted w JOIN counted c ON c.commune = w.commune
     GROUP BY w.commune
  ),
  sources AS (
    SELECT commune, jsonb_object_agg(src, n) AS sources
      FROM (SELECT commune, src, SUM(n)::int AS n FROM per_src WHERE src <> 'lukka' GROUP BY commune, src) s
     GROUP BY commune
  )
  SELECT c.commune, c.listings, c.lukka_listings, s.median, s.p25, s.p75,
         COALESCE(src.sources, '{}'::jsonb) AS sources
    FROM counted c
    JOIN stats s ON s.commune = c.commune
    LEFT JOIN sources src ON src.commune = c.commune
`;

/** `date` minus one calendar month (31 March → 28/29 February, as Postgres does). */
export function oneMonthBefore(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** One calendar month after a 'YYYY-MM-DD' day: the first day a change can be shown. */
export function firstChangeDay(day = INDEX_COMPARABLE_FROM) {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(d, last));
  return next.toISOString().slice(0, 10);
}

/** The Kinshasa calendar day of an instant, 'YYYY-MM-DD'. */
export const kinshasaDate = (instant) => new Date(instant.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

/** Whether a change can be computed against `previous` (see INDEX_COMPARABLE_FROM). */
export const isComparableDay = (previous) => previous.getTime() >= COMPARABLE_FROM_INSTANT.getTime();

/** Change in % to one decimal, or null when either side is missing or below the sample. */
export function indexChange(current, previous, minSample) {
  if (!current || !previous) return null;
  if (current.listings < minSample || previous.listings < minSample) return null;
  if (!(previous.median > 0) || current.median == null) return null;
  return Math.round(((current.median - previous.median) / previous.median) * 1000) / 10;
}

const MISSING = new Set(['42P01', '42703']);

/**
 * `{ asOf, previousAsOf, comparable, communes, sources, listings, lukkaListings }`
 * or null when there is nothing to publish. Never throws.
 */
export async function getLukkaIndex({ minSample, now = new Date(), pool = getPool() } = {}) {
  try {
    const previousInstant = oneMonthBefore(now);
    const comparable = isComparableDay(previousInstant);
    const [current, previous] = await Promise.all([
      pool.query(LUKKA_INDEX_SQL, [now.toISOString(), RESIDENTIAL_KINDS, minSample]),
      comparable
        ? pool.query(LUKKA_INDEX_SQL, [previousInstant.toISOString(), RESIDENTIAL_KINDS, minSample])
        : Promise.resolve({ rows: [] }),
    ]);
    if (!current.rows.length) return null;
    const before = new Map(previous.rows.map((row) => [row.commune, row]));
    const sources = {};
    const communes = current.rows
      .map((row) => {
        for (const [source, n] of Object.entries(row.sources || {})) sources[source] = (sources[source] || 0) + n;
        const old = before.get(row.commune);
        const changePct = indexChange(row, old, minSample);
        return {
          commune: row.commune,
          median: Math.round(row.median),
          p25: Math.round(row.p25),
          p75: Math.round(row.p75),
          listings: row.listings,
          lukkaListings: row.lukka_listings,
          sources: row.sources || {},
          previous: changePct == null ? null : Math.round(old.median),
          changePct,
        };
      })
      .sort((a, b) => b.median - a.median || a.commune.localeCompare(b.commune));
    return {
      asOf: kinshasaDate(now),
      previousAsOf: kinshasaDate(previousInstant),
      comparable,
      comparableFrom: INDEX_COMPARABLE_FROM,
      firstChange: firstChangeDay(),
      communes,
      sources,
      listings: communes.reduce((sum, row) => sum + row.listings, 0),
      lukkaListings: communes.reduce((sum, row) => sum + row.lukkaListings, 0),
    };
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[lukka-index] ${err.message}`);
    return null;
  }
}
