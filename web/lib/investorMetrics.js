import 'server-only';
import { getPool } from './db';
import { peopleSql } from './analytics';
import { NOT_TEST_LISTING_SQL } from './marketExclusions';

/**
 * /admin/investisseurs — the platform's numbers as an investor would ask for
 * them: the funnel month by month, liquidity, supply, unmet demand,
 * retention, agent responsiveness, the price record and acquisition.
 *
 * Rules every figure here follows, because a data room reads them all:
 * - **People only** (lib/analytics.js `peopleSql`): no team, no agent on their
 *   own listing, no crawler, no prefetch. A row older than viewer_kind counts
 *   as a person unless its device was a bot.
 * - **No test agency** (`NOT_TEST_LISTING_SQL`, `agents.is_test`).
 * - **A median needs `MIN_SAMPLE` values** (5, the market pages' rule); below
 *   it the count is kept and the median is null — "3, pas encore assez".
 * - **A figure that was not measured yet is null, never 0**: visitor ids exist
 *   from 2026-09-29, search_events from the same migration, visit requests per
 *   listing from the engine's rollup. `getTrackingStarts` dates each one.
 * - Every optional column is read through to_jsonb(row), so nothing 42703s;
 *   a missing table (42P01) makes its section `null` (shown "non disponible").
 *
 * Months are UTC calendar months, the current one included (and partial).
 */

export const MIN_SAMPLE = 5;
export const INVESTOR_MONTHS = 12;
export const DEMAND_DAYS = 90;
export const RESPONSE_DAYS = 90;
/** An agent answered "fast" within this many seconds — the engine's SLA. */
export const FAST_RESPONSE_SECONDS = 15 * 60;

const NOT_TEST_AGENT_SQL = (alias) => `NOT COALESCE((to_jsonb(${alias}) ->> 'is_test')::boolean, false)`;
const NOT_DELETED_SQL = (alias) => `(to_jsonb(${alias}) ->> 'deleted_at') IS NULL`;
const LIVE_SQL = `p.status = 1 AND p.approve_status = 1 AND ${NOT_TEST_LISTING_SQL} AND ${NOT_DELETED_SQL('p')}`;
const VISITOR = (alias) => `(to_jsonb(${alias}) ->> 'visitor_id')`;

/** The last `$1` months, oldest first. */
const MONTHS_CTE = `
  m AS (
    SELECT generate_series(
      date_trunc('month', NOW()) - make_interval(months => $1::int - 1),
      date_trunc('month', NOW()),
      interval '1 month'
    ) AS month
  )`;
/** Inside month m, and not before launch (`$2`, NULL = no bound). */
const IN_MONTH = (column) =>
  `${column} >= m.month AND ${column} < m.month + interval '1 month' AND ($2::timestamptz IS NULL OR ${column} >= $2::timestamptz)`;

/** A lead on one listing: a person's WhatsApp tap or call tap. */
const LEADS_CTE = `
  leads AS (
    SELECT w.listing_id, w.created_at FROM whatsapp_clicks w
     WHERE w.listing_id IS NOT NULL AND ${peopleSql('w')}
    UNION ALL
    SELECT e.listing_id, e.created_at FROM listing_events e
     WHERE e.event = 'call_click' AND ${peopleSql('e')}
  )`;

export const FUNNEL_SQL = `
  WITH ${MONTHS_CTE}
  SELECT to_char(m.month, 'YYYY-MM') AS month,
         pv.page_views, pv.listing_views,
         CASE WHEN pv.identified > 0 THEN pv.visitors END AS visitors,
         wc.whatsapp, ev.calls,
         vr.visit_requests, vr.rollup_days,
         cl.closes
  FROM m
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS page_views,
           count(*) FILTER (WHERE v.path LIKE '/listings/%')::int AS listing_views,
           count(DISTINCT ${VISITOR('v')})::int AS visitors,
           count(${VISITOR('v')})::int AS identified
    FROM page_views v WHERE ${IN_MONTH('v.created_at')} AND ${peopleSql('v')}
  ) pv ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS whatsapp FROM whatsapp_clicks w
    WHERE ${IN_MONTH('w.created_at')} AND ${peopleSql('w')}
  ) wc ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS calls FROM listing_events e
    WHERE e.event = 'call_click' AND ${IN_MONTH('e.created_at')} AND ${peopleSql('e')}
  ) ev ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum((to_jsonb(s) ->> 'visit_requests')::int), 0)::int AS visit_requests,
           count(DISTINCT s.day)::int AS rollup_days
    FROM listing_stats_daily s
    WHERE s.day >= m.month::date AND s.day < (m.month + interval '1 month')::date
      AND ($2::timestamptz IS NULL OR s.day >= $2::date)
  ) vr ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS closes FROM properties p
    WHERE p.approve_status = 1 AND p.sold_at IS NOT NULL AND ${NOT_TEST_LISTING_SQL}
      AND p.sold_at >= m.month::date AND p.sold_at < (m.month + interval '1 month')::date
  ) cl ON true
  ORDER BY m.month`;

export const SEARCHES_BY_MONTH_SQL = `
  WITH ${MONTHS_CTE}
  SELECT to_char(m.month, 'YYYY-MM') AS month, s.searches, s.zero_results
  FROM m
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS searches, count(*) FILTER (WHERE x.result_count = 0)::int AS zero_results
    FROM search_events x WHERE ${IN_MONTH('x.created_at')} AND ${peopleSql('x')}
  ) s ON true
  ORDER BY m.month`;

export const SUPPLY_BY_MONTH_SQL = `
  WITH ${MONTHS_CTE}
  SELECT to_char(m.month, 'YYYY-MM') AS month,
    (SELECT count(*)::int FROM properties p
      WHERE p.approve_status = 1 AND ${NOT_TEST_LISTING_SQL} AND ${IN_MONTH('p.created_at')}) AS new_listings,
    (SELECT count(*)::int FROM properties p
      WHERE p.approve_status = 1 AND ${NOT_TEST_LISTING_SQL}
        AND p.created_at < m.month + interval '1 month') AS cumulative_listings,
    (SELECT count(*)::int FROM agents a
      WHERE ${NOT_TEST_AGENT_SQL('a')} AND ${NOT_DELETED_SQL('a')} AND ${IN_MONTH('a.created_at')}) AS new_agents,
    (SELECT count(*)::int FROM agents a
      WHERE ${NOT_TEST_AGENT_SQL('a')} AND ${NOT_DELETED_SQL('a')}
        AND a.phone_verified_at < m.month + interval '1 month') AS verified_agents
  FROM m ORDER BY m.month`;

export const SNAPSHOT_SQL = `
  SELECT
    (SELECT count(*)::int FROM properties p WHERE ${LIVE_SQL}) AS live_listings,
    (SELECT count(DISTINCT p.agent_id)::int FROM properties p WHERE ${LIVE_SQL}) AS agents_with_live,
    (SELECT count(*)::int FROM agents a
      WHERE a.status = 1 AND ${NOT_TEST_AGENT_SQL('a')} AND ${NOT_DELETED_SQL('a')}) AS active_agents,
    (SELECT count(*)::int FROM agents a
      WHERE a.status = 1 AND a.phone_verified_at IS NOT NULL
        AND ${NOT_TEST_AGENT_SQL('a')} AND ${NOT_DELETED_SQL('a')}) AS verified_agents,
    (SELECT count(DISTINCT p.city_id)::int FROM properties p WHERE ${LIVE_SQL}) AS cities,
    (SELECT count(DISTINCT pa.amenity_id)::int FROM property_amenities pa
       JOIN properties p ON p.id = pa.property_id
      WHERE ${LIVE_SQL} AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)) AS communes`;

/**
 * Of today's live listings: how many had a person's lead in the last 30 days
 * (WhatsApp tap, call tap, or a visit request in the engine's rollup), and
 * how many have been public at least 30 days (the fair denominator).
 */
export const LIQUIDITY_SQL = `
  WITH ${LEADS_CTE},
  live AS (
    SELECT p.id, COALESCE(p.moderated_at, p.created_at) AS since FROM properties p WHERE ${LIVE_SQL}
  ),
  flagged AS (
    SELECT live.id, live.since,
      (EXISTS (SELECT 1 FROM leads l WHERE l.listing_id = live.id AND l.created_at >= NOW() - interval '30 days')
       OR EXISTS (SELECT 1 FROM listing_stats_daily s
                   WHERE s.listing_id = live.id AND s.day >= CURRENT_DATE - 30
                     AND COALESCE((to_jsonb(s) ->> 'visit_requests')::int, 0) > 0)) AS has_lead
    FROM live
  )
  SELECT count(*)::int AS live,
         count(*) FILTER (WHERE has_lead)::int AS with_lead,
         count(*) FILTER (WHERE since <= NOW() - interval '30 days')::int AS mature,
         count(*) FILTER (WHERE has_lead AND since <= NOW() - interval '30 days')::int AS mature_with_lead
  FROM flagged`;

/**
 * Days from going public to the first person's lead, for listings that went
 * public after lead tracking began (an older listing's "first" lead would be
 * the first one we happened to record).
 */
export const TIME_TO_LEAD_SQL = `
  WITH ${LEADS_CTE},
  start AS (SELECT min(created_at) AS t FROM whatsapp_clicks),
  pub AS (
    SELECT p.id, COALESCE(p.moderated_at, p.created_at) AS since
    FROM properties p, start
    WHERE p.approve_status = 1 AND ${NOT_TEST_LISTING_SQL} AND start.t IS NOT NULL
      AND COALESCE(p.moderated_at, p.created_at) >= start.t
  ),
  firsts AS (
    SELECT pub.since,
      (SELECT min(l.created_at) FROM leads l WHERE l.listing_id = pub.id AND l.created_at >= pub.since) AS first_lead
    FROM pub
  )
  SELECT count(*)::int AS listings,
         count(first_lead)::int AS with_lead,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_lead - since) / 86400)
           FILTER (WHERE first_lead IS NOT NULL) AS median_days
  FROM firsts`;

/** The price record: closes, days on market, achieved against asking. */
export const CLOSES_SQL = `
  SELECT count(*)::int AS closes,
         count(*) FILTER (WHERE p.sold_price > 0 AND p.price > 0)::int AS priced,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY (p.sold_at - p.created_at::date))
           FILTER (WHERE p.sold_at >= p.created_at::date) AS median_days_on_market,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY (p.sold_price - p.price) / p.price)
           FILTER (WHERE p.sold_price > 0 AND p.price > 0) AS median_gap
  FROM properties p
  WHERE p.approve_status = 1 AND p.sold_at IS NOT NULL AND ${NOT_TEST_LISTING_SQL}`;

export const DEMAND_TOTALS_SQL = `
  SELECT count(*)::int AS searches,
         count(*) FILTER (WHERE s.result_count = 0)::int AS zero_results,
         count(DISTINCT s.visitor_id)::int AS searchers,
         count(DISTINCT s.visitor_id) FILTER (WHERE s.result_count = 0)::int AS zero_searchers
  FROM search_events s
  WHERE s.created_at >= NOW() - make_interval(days => $1::int) AND ${peopleSql('s')}
    AND ($2::timestamptz IS NULL OR s.created_at >= $2::timestamptz)`;

/** What people searched for and found nothing: the supply the market is missing. */
export const UNMET_DEMAND_SQL = `
  SELECT c.commune, s.purpose, s.property_type,
         count(*)::int AS searches,
         count(DISTINCT s.visitor_id)::int AS searchers,
         count(s.price_max) FILTER (WHERE s.price_max > 0)::int AS budgets,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY s.price_max) FILTER (WHERE s.price_max > 0) AS median_budget
  FROM search_events s
  LEFT JOIN LATERAL unnest(
    CASE WHEN cardinality(s.communes) = 0 THEN ARRAY[NULL::text] ELSE s.communes END
  ) AS c(commune) ON true
  WHERE s.created_at >= NOW() - make_interval(days => $1::int) AND ${peopleSql('s')} AND s.result_count = 0
    AND ($3::timestamptz IS NULL OR s.created_at >= $3::timestamptz)
  GROUP BY 1, 2, 3
  ORDER BY searchers DESC, searches DESC
  LIMIT $2`;

/** Of the visitors first seen each month, how many came back on a later day. */
export const VISITOR_RETURN_SQL = `
  WITH firsts AS (
    SELECT ${VISITOR('v')} AS vid, min(v.created_at) AS first_at, max(v.created_at) AS last_at
    FROM page_views v
    WHERE ${peopleSql('v')} AND ${VISITOR('v')} IS NOT NULL
      AND ($2::timestamptz IS NULL OR v.created_at >= $2::timestamptz)
    GROUP BY 1
  )
  SELECT to_char(date_trunc('month', first_at), 'YYYY-MM') AS month,
         count(*)::int AS new_visitors,
         count(*) FILTER (WHERE last_at >= first_at + interval '1 day')::int AS returned
  FROM firsts
  WHERE first_at >= date_trunc('month', NOW()) - make_interval(months => $1::int - 1)
  GROUP BY 1 ORDER BY 1`;

/**
 * Of the agents who published their first listing each month, how many
 * published another within 30 days. "+1 day" so one multi-unit paste is
 * one publication, not a repeat.
 */
export const AGENT_REPEAT_SQL = `
  WITH pubs AS (
    SELECT p.agent_id, p.created_at FROM properties p
    WHERE p.agent_id IS NOT NULL AND p.approve_status IN (0, 1) AND ${NOT_TEST_LISTING_SQL}
  ),
  firsts AS (SELECT agent_id, min(created_at) AS first_at FROM pubs GROUP BY 1)
  SELECT to_char(date_trunc('month', f.first_at), 'YYYY-MM') AS month,
         count(*)::int AS new_publishers,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM pubs p2 WHERE p2.agent_id = f.agent_id
             AND p2.created_at >= f.first_at + interval '1 day'
             AND p2.created_at < f.first_at + interval '31 days'))::int AS published_again,
         bool_and(f.first_at <= NOW() - interval '31 days') AS complete
  FROM firsts f
  WHERE f.first_at >= date_trunc('month', NOW()) - make_interval(months => $1::int - 1)
  GROUP BY 1 ORDER BY 1`;

/** Viewing requests that reached an agent (engine-written log), last `$1` days. */
export const RESPONSE_SQL = `
  SELECT count(*)::int AS requests,
         count(l.first_response_timestamp)::int AS answered,
         count(l.response_latency_seconds)::int AS timed,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY l.response_latency_seconds)
           FILTER (WHERE l.response_latency_seconds IS NOT NULL) AS median_seconds,
         count(*) FILTER (WHERE l.response_latency_seconds <= $2::int)::int AS fast
  FROM agent_performance_logs l
  JOIN agents a ON a.id = l.agent_id
  WHERE l.lead_timestamp >= NOW() - make_interval(days => $1::int) AND ${NOT_TEST_AGENT_SQL('a')}
    AND ($3::timestamptz IS NULL OR l.lead_timestamp >= $3::timestamptz)`;

/** People's views, distinct visitors and WhatsApp taps by recorded source, last `$1` days. */
export const ACQUISITION_SQL = `
  WITH v AS (
    SELECT COALESCE(v.source, 'inconnu') AS source, ${VISITOR('v')} AS vid
    FROM page_views v WHERE v.created_at >= NOW() - make_interval(days => $1::int) AND ${peopleSql('v')}
      AND ($3::timestamptz IS NULL OR v.created_at >= $3::timestamptz)
  ),
  w AS (
    SELECT COALESCE(w.source, 'inconnu') AS source
    FROM whatsapp_clicks w WHERE w.created_at >= NOW() - make_interval(days => $1::int) AND ${peopleSql('w')}
      AND ($3::timestamptz IS NULL OR w.created_at >= $3::timestamptz)
  ),
  vs AS (SELECT source, count(*)::int AS views, count(DISTINCT vid)::int AS visitors FROM v GROUP BY 1),
  ws AS (SELECT source, count(*)::int AS taps FROM w GROUP BY 1)
  SELECT COALESCE(vs.source, ws.source) AS source,
         COALESCE(vs.views, 0) AS views, COALESCE(vs.visitors, 0) AS visitors, COALESCE(ws.taps, 0) AS taps
  FROM vs FULL OUTER JOIN ws ON ws.source = vs.source
  ORDER BY views DESC, taps DESC
  LIMIT $2`;

/**
 * `launch` is the first (non-test) listing's creation: production was reset
 * for launch in October 2026, so everything recorded before it is pre-launch
 * testing on listings that no longer exist. Every window on the page starts
 * there at the earliest (`investorWindow`).
 */
export const TRACKING_STARTS_SQL = `
  SELECT (SELECT min(p.created_at) FROM properties p WHERE ${NOT_TEST_LISTING_SQL}) AS launch,
         (SELECT min(created_at) FROM page_views) AS views,
         (SELECT min(created_at) FROM whatsapp_clicks) AS whatsapp,
         (SELECT min(v.created_at) FROM page_views v WHERE ${VISITOR('v')} IS NOT NULL) AS visitors,
         (SELECT min(day) FROM listing_stats_daily) AS rollup`;

export const SEARCH_START_SQL = `SELECT min(created_at) AS searches FROM search_events`;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

/** A median only from MIN_SAMPLE values; otherwise null. */
export function sampled(value, count) {
  if (value === null || value === undefined || !(count >= MIN_SAMPLE)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** part ÷ whole, or null when there is no whole. */
export function ratio(part, whole) {
  if (!(whole > 0) || !Number.isFinite(part)) return null;
  return part / whole;
}

/**
 * Calendar months from the launch month to `now`'s, both included, capped at
 * INVESTOR_MONTHS (UTC). No launch → the cap.
 */
export function monthsSince(launch, now = new Date()) {
  if (!launch) return INVESTOR_MONTHS;
  const start = new Date(launch);
  const span = (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth()) + 1;
  return Math.min(INVESTOR_MONTHS, Math.max(1, span));
}

/** A rolling window of `days`, shortened so it never reaches before launch. */
export function daysSince(launch, days, now = new Date()) {
  if (!launch) return days;
  const elapsed = Math.ceil((now.getTime() - new Date(launch).getTime()) / 86400000);
  return Math.min(days, Math.max(1, elapsed));
}

const missingRelation = (err) => err?.code === '42P01';

async function rowsOf(sql, values) {
  const { rows } = await getPool().query(sql, values);
  return rows;
}

/** A section that reads a table the migrations may not have created yet. */
async function optional(load) {
  try {
    return await load();
  } catch (err) {
    if (missingRelation(err)) return null;
    throw err;
  }
}

export async function getFunnelByMonth(months = INVESTOR_MONTHS, launch = null) {
  const [funnel, searches] = await Promise.all([
    rowsOf(FUNNEL_SQL, [months, launch]),
    optional(() => rowsOf(SEARCHES_BY_MONTH_SQL, [months, launch])),
  ]);
  const searchByMonth = new Map((searches || []).map((r) => [r.month, r]));
  return funnel.map((row) => {
    const search = searchByMonth.get(row.month);
    return {
      month: row.month,
      visitors: row.visitors ?? null,
      pageViews: row.page_views,
      listingViews: row.listing_views,
      searches: searches ? (search?.searches ?? 0) : null,
      zeroResults: searches ? (search?.zero_results ?? 0) : null,
      whatsapp: row.whatsapp,
      calls: row.calls,
      // Without one rolled-up day in the month the engine's count is unknown.
      visitRequests: row.rollup_days > 0 ? row.visit_requests : null,
      closes: row.closes,
    };
  });
}

export async function getSupply(months = INVESTOR_MONTHS, launch = null) {
  const [byMonth, [snapshot]] = await Promise.all([
    rowsOf(SUPPLY_BY_MONTH_SQL, [months, launch]),
    rowsOf(SNAPSHOT_SQL, []),
  ]);
  return {
    byMonth: byMonth.map((r) => ({
      month: r.month,
      newListings: r.new_listings,
      cumulativeListings: r.cumulative_listings,
      newAgents: r.new_agents,
      verifiedAgents: r.verified_agents,
    })),
    snapshot: {
      liveListings: snapshot.live_listings,
      agentsWithLive: snapshot.agents_with_live,
      activeAgents: snapshot.active_agents,
      verifiedAgents: snapshot.verified_agents,
      cities: snapshot.cities,
      communes: snapshot.communes,
    },
  };
}

export async function getLiquidity() {
  const [[live], [lead], [closes]] = await Promise.all([
    rowsOf(LIQUIDITY_SQL, []),
    rowsOf(TIME_TO_LEAD_SQL, []),
    rowsOf(CLOSES_SQL, []),
  ]);
  return {
    liveListings: live.live,
    withLead30d: live.with_lead,
    matureListings: live.mature,
    matureWithLead30d: live.mature_with_lead,
    // Every live listing, young ones included: at launch none is 30 days old,
    // and the mature-only rate is kept beside it for when they are.
    leadRate30d: ratio(live.with_lead, live.live),
    matureLeadRate30d: ratio(live.mature_with_lead, live.mature),
    trackedListings: lead.listings,
    listingsWithLead: lead.with_lead,
    medianDaysToFirstLead: sampled(lead.median_days, lead.with_lead),
    closes: closes.closes,
    pricedCloses: closes.priced,
    medianDaysOnMarket: sampled(closes.median_days_on_market, closes.closes),
    medianPriceGap: sampled(closes.median_gap, closes.priced),
  };
}

export async function getDemand({ days = DEMAND_DAYS, limit = 10, launch = null } = {}) {
  return optional(async () => {
    const [[totals], unmet] = await Promise.all([
      rowsOf(DEMAND_TOTALS_SQL, [days, launch]),
      rowsOf(UNMET_DEMAND_SQL, [days, limit, launch]),
    ]);
    return {
      days,
      searches: totals.searches,
      zeroResults: totals.zero_results,
      zeroShare: ratio(totals.zero_results, totals.searches),
      searchers: totals.searchers,
      zeroSearchers: totals.zero_searchers,
      unmet: unmet.map((r) => ({
        commune: r.commune,
        purpose: r.purpose,
        propertyType: r.property_type,
        searches: r.searches,
        searchers: r.searchers,
        medianBudget: r.purpose ? sampled(r.median_budget, r.budgets) : null,
      })),
    };
  });
}

export async function getRetention(months = INVESTOR_MONTHS, launch = null) {
  const [visitors, agents] = await Promise.all([
    rowsOf(VISITOR_RETURN_SQL, [months, launch]),
    rowsOf(AGENT_REPEAT_SQL, [months]),
  ]);
  return {
    visitors: visitors.map((r) => ({
      month: r.month,
      newVisitors: r.new_visitors,
      returned: r.returned,
      rate: ratio(r.returned, r.new_visitors),
    })),
    agents: agents.map((r) => ({
      month: r.month,
      newPublishers: r.new_publishers,
      publishedAgain: r.published_again,
      rate: ratio(r.published_again, r.new_publishers),
      complete: r.complete === true,
    })),
  };
}

export async function getResponsiveness({ days = RESPONSE_DAYS, launch = null } = {}) {
  return optional(async () => {
    const [row] = await rowsOf(RESPONSE_SQL, [days, FAST_RESPONSE_SECONDS, launch]);
    return {
      days,
      requests: row.requests,
      answered: row.answered,
      answerRate: ratio(row.answered, row.requests),
      medianMinutes: row.timed >= MIN_SAMPLE && row.median_seconds !== null ? Number(row.median_seconds) / 60 : null,
      fast: row.fast,
      fastRate: row.timed >= MIN_SAMPLE ? ratio(row.fast, row.requests) : null,
    };
  });
}

export async function getAcquisition({ days = DEMAND_DAYS, limit = 12, launch = null } = {}) {
  const rows = await rowsOf(ACQUISITION_SQL, [days, limit, launch]);
  return rows.map((r) => ({ ...r, tapRate: ratio(r.taps, r.views) }));
}

export async function getTrackingStarts() {
  const [[starts], search] = await Promise.all([
    rowsOf(TRACKING_STARTS_SQL, []),
    optional(() => rowsOf(SEARCH_START_SQL, [])),
  ]);
  return { ...starts, searches: search?.[0]?.searches ?? null };
}

/**
 * The page's windows, all starting at launch at the earliest: how many months
 * the monthly tables show, and the demand / response day counts.
 */
export async function investorWindow(now = new Date()) {
  const starts = await getTrackingStarts();
  return {
    starts,
    launch: starts.launch ?? null,
    months: monthsSince(starts.launch, now),
    demandDays: daysSince(starts.launch, DEMAND_DAYS, now),
    responseDays: daysSince(starts.launch, RESPONSE_DAYS, now),
  };
}

/**
 * One row per month for the data-room CSV: funnel, searches, supply and
 * retention side by side, from the launch month. Nulls stay empty cells,
 * never 0.
 */
export async function getInvestorMonthlyRows() {
  const { months, launch } = await investorWindow();
  const [funnel, supply, retention] = await Promise.all([
    getFunnelByMonth(months, launch),
    getSupply(months, launch),
    getRetention(months, launch),
  ]);
  const supplyBy = new Map(supply.byMonth.map((r) => [r.month, r]));
  const visitorsBy = new Map(retention.visitors.map((r) => [r.month, r]));
  const agentsBy = new Map(retention.agents.map((r) => [r.month, r]));
  return funnel.map((f) => ({
    ...f,
    ...(supplyBy.get(f.month) || {}),
    newVisitors: visitorsBy.get(f.month)?.newVisitors ?? null,
    returningVisitors: visitorsBy.get(f.month)?.returned ?? null,
    newPublishers: agentsBy.get(f.month)?.newPublishers ?? null,
    publishedAgain30d: agentsBy.get(f.month)?.publishedAgain ?? null,
  }));
}
