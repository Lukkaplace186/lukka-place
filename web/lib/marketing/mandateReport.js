import 'server-only';
import { getPool } from '../db';
import { isRollupFresh } from '../analytics';
import { listViewingRequests } from '../adminApi';

/**
 * The counts behind the landlord report (lib/marketing/mandateReportCopy.js
 * has the wording): views, WhatsApp taps and saves for one listing over this
 * week and last, plus visit requests from the engine.
 *
 * Read the same way the agent dashboard reads them (lib/analytics.js):
 * listing_stats_daily while the rollup is fresh, the raw event tables
 * otherwise — so the number an agent forwards to an owner is the number their
 * own dashboard shows. Both paths bound on whole UTC days, which is what the
 * rollup is keyed on.
 *
 * Callers must have established ownership first (getFlyerListing's
 * `p.agent_id = $3`); these queries take a listing id and trust it.
 */

const EMPTY = { views: 0, whatsappClicks: 0, saves: 0 };

async function eventCounts(listingId, window) {
  const pool = getPool();
  const params = [Number(listingId), window.previousFrom.toISOString(), window.from.toISOString(), window.end.toISOString()];

  if (await isRollupFresh()) {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(sum(views) FILTER (WHERE day >= $3::date), 0)::int AS views,
         COALESCE(sum(views) FILTER (WHERE day < $3::date), 0)::int AS prev_views,
         COALESCE(sum(whatsapp_clicks) FILTER (WHERE day >= $3::date), 0)::int AS clicks,
         COALESCE(sum(whatsapp_clicks) FILTER (WHERE day < $3::date), 0)::int AS prev_clicks,
         COALESCE(sum(saves) FILTER (WHERE day >= $3::date), 0)::int AS saves,
         COALESCE(sum(saves) FILTER (WHERE day < $3::date), 0)::int AS prev_saves
       FROM listing_stats_daily
       WHERE listing_id = $1 AND day >= $2::date AND day < $4::date`,
      // Plain YYYY-MM-DD: a timestamp string cast to date would go through the
      // session's TimeZone first.
      [params[0], ...params.slice(1).map((iso) => iso.slice(0, 10))],
    );
    return split(rows[0]);
  }

  const { rows } = await pool.query(
    `WITH w AS (SELECT $2::timestamptz AS prev_from, $3::timestamptz AS cur_from, $4::timestamptz AS until),
     v AS (
       SELECT count(*) FILTER (WHERE pv.created_at >= w.cur_from)::int AS cur,
              count(*) FILTER (WHERE pv.created_at < w.cur_from)::int AS prev
         FROM page_views pv, w
        WHERE pv.path = $5 AND pv.created_at >= w.prev_from AND pv.created_at < w.until
     ),
     c AS (
       SELECT count(*) FILTER (WHERE wc.created_at >= w.cur_from)::int AS cur,
              count(*) FILTER (WHERE wc.created_at < w.cur_from)::int AS prev
         FROM whatsapp_clicks wc, w
        WHERE wc.listing_id = $1 AND wc.created_at >= w.prev_from AND wc.created_at < w.until
     ),
     s AS (
       SELECT count(*) FILTER (WHERE le.created_at >= w.cur_from)::int AS cur,
              count(*) FILTER (WHERE le.created_at < w.cur_from)::int AS prev
         FROM listing_events le, w
        WHERE le.listing_id = $1 AND le.event = 'listing_saved'
          AND le.created_at >= w.prev_from AND le.created_at < w.until
     )
     SELECT v.cur AS views, v.prev AS prev_views, c.cur AS clicks, c.prev AS prev_clicks,
            s.cur AS saves, s.prev AS prev_saves
       FROM v, c, s`,
    [...params, `/listings/${Number(listingId)}`],
  );
  return split(rows[0]);
}

function split(row) {
  if (!row) return { current: { ...EMPTY }, previous: { ...EMPTY } };
  return {
    current: { views: row.views, whatsappClicks: row.clicks, saves: row.saves },
    previous: { views: row.prev_views, whatsappClicks: row.prev_clicks, saves: row.prev_saves },
  };
}

/** Engine timestamps are SQLite `YYYY-MM-DD HH:MM:SS`, in UTC. */
export function parseEngineTimestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

const VISIT_PAGE = 200;

/**
 * Visit requests created in each window, or nulls when the engine cannot be
 * asked — "the engine did not answer" must not read as "nobody asked".
 */
async function visitRequestCounts(listingId, window) {
  try {
    const { data = [] } = await listViewingRequests({ propertyIds: [Number(listingId)], limit: VISIT_PAGE });
    let current = 0;
    let previous = 0;
    for (const row of data) {
      const at = parseEngineTimestamp(row.created_at);
      if (at == null || at >= window.end.getTime()) continue;
      if (at >= window.from.getTime()) current += 1;
      else if (at >= window.previousFrom.getTime()) previous += 1;
    }
    return { current, previous };
  } catch (err) {
    console.error(`[mandate-report] visit requests unavailable for listing ${listingId}: ${err.message}`);
    return { current: null, previous: null };
  }
}

export async function getMandateCounts(listingId, window) {
  const [events, visits] = await Promise.all([eventCounts(listingId, window), visitRequestCounts(listingId, window)]);
  return {
    current: { ...events.current, visitRequests: visits.current },
    previous: { ...events.previous, visitRequests: visits.previous },
  };
}
