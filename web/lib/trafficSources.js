import 'server-only';
import { getPool } from './db';
import { peopleSql } from './analytics';
import { trafficBucket, trafficChannelSql } from './trafficChannels';

/**
 * Where the site's visitors come from, by channel (lib/trafficChannels.js),
 * for /admin/dashboard/sources. People only (`peopleSql`: no team, agents,
 * crawlers or local testing), so the totals are smaller than the dashboard's
 * "Page views" tile, which counts every row.
 *
 * Each query reads two windows at once, the period and the same length
 * before it, so every figure can say how it moved (an advert's effect).
 * `$1` is the period in days, NULL for "since the start" (no previous window).
 */

const PV_CHANNEL = trafficChannelSql({
  source: 'pv.source',
  medium: 'pv.utm_medium',
  clickIdType: 'pv.click_id_type',
  referrerHost: 'pv.referrer_host',
  campaign: 'pv.utm_campaign',
});

/** Rows of both windows; `cur` says which one. */
const PV_WINDOWS = `
  pv AS (
    SELECT pv.created_at, pv.visitor_id, pv.source, pv.referrer_host, pv.utm_medium,
           pv.utm_campaign, pv.utm_content, pv.click_id_type,
           ${PV_CHANNEL} AS channel,
           ($1::int IS NULL OR pv.created_at >= NOW() - make_interval(days => $1::int)) AS cur
    FROM page_views pv
    WHERE ${peopleSql('pv')}
      AND ($1::int IS NULL OR pv.created_at >= NOW() - make_interval(days => $1::int * 2))
  )`;

export const CHANNEL_TOTALS_SQL = `
  WITH ${PV_WINDOWS}
  SELECT channel,
         count(*) FILTER (WHERE cur)::int AS views,
         count(DISTINCT visitor_id) FILTER (WHERE cur)::int AS visitors,
         count(*) FILTER (WHERE NOT cur)::int AS prev_views,
         count(DISTINCT visitor_id) FILTER (WHERE NOT cur)::int AS prev_visitors
  FROM pv
  GROUP BY GROUPING SETS ((channel), ())`;

/**
 * A WhatsApp tap is credited to the channel of the same visitor's last page
 * view before it (attribution is per session, so that page carries how the
 * session started). A tap with no visitor id or no such view falls back to
 * its own `source` column.
 */
const TAP_CHANNEL = trafficChannelSql({
  source: 'COALESCE(lv.source, w.source)',
  medium: 'lv.utm_medium',
  clickIdType: 'lv.click_id_type',
  referrerHost: 'lv.referrer_host',
  campaign: 'lv.utm_campaign',
});

export const TAP_TOTALS_SQL = `
  SELECT ${TAP_CHANNEL} AS channel,
         lv.utm_campaign AS campaign,
         CASE WHEN lv.utm_medium = 'partner' THEN lv.utm_content END AS code,
         count(*) FILTER (WHERE $1::int IS NULL OR w.created_at >= NOW() - make_interval(days => $1::int))::int AS taps,
         count(*) FILTER (WHERE $1::int IS NOT NULL AND w.created_at < NOW() - make_interval(days => $1::int))::int AS prev_taps
  FROM whatsapp_clicks w
  LEFT JOIN LATERAL (
    SELECT p.source, p.utm_medium, p.click_id_type, p.referrer_host, p.utm_campaign, p.utm_content
    FROM page_views p
    WHERE w.visitor_id IS NOT NULL
      AND p.visitor_id = w.visitor_id
      AND p.created_at <= w.created_at + interval '1 minute'
      AND p.created_at >= w.created_at - interval '2 days'
    ORDER BY p.created_at DESC
    LIMIT 1
  ) lv ON true
  WHERE ${peopleSql('w')}
    AND ($1::int IS NULL OR w.created_at >= NOW() - make_interval(days => $1::int * 2))
  GROUP BY 1, 2, 3`;

/** Visitors per bucket (Kinshasa time) and channel, current window only. `$2` = hour/day/week. */
export const TIMELINE_SQL = `
  WITH ${PV_WINDOWS}
  SELECT to_char(date_trunc($2, created_at AT TIME ZONE 'Africa/Kinshasa'), 'YYYY-MM-DD"T"HH24:MI') AS bucket,
         channel,
         count(DISTINCT visitor_id)::int AS visitors,
         count(*)::int AS views
  FROM pv
  WHERE cur
  GROUP BY 1, 2
  ORDER BY 1`;

/**
 * Tagged links: an advert's campaign (Meta sends its id), or an agent's
 * partner code (utm_content on /i/CODE links). Current and previous window.
 */
export const CAMPAIGNS_SQL = `
  WITH ${PV_WINDOWS}
  SELECT channel,
         utm_campaign AS campaign,
         CASE WHEN utm_medium = 'partner' THEN utm_content END AS code,
         count(DISTINCT visitor_id) FILTER (WHERE cur)::int AS visitors,
         count(*) FILTER (WHERE cur)::int AS views,
         count(DISTINCT visitor_id) FILTER (WHERE NOT cur)::int AS prev_visitors,
         min(created_at) FILTER (WHERE cur) AS first_seen,
         max(created_at) FILTER (WHERE cur) AS last_seen
  FROM pv
  WHERE utm_campaign IS NOT NULL OR (utm_medium = 'partner' AND utm_content IS NOT NULL)
  GROUP BY 1, 2, 3
  HAVING count(*) FILTER (WHERE cur) > 0
  ORDER BY visitors DESC, views DESC
  LIMIT $2`;

/** The raw values behind the channels: source and referring site, current window. */
export const RAW_SOURCES_SQL = `
  WITH ${PV_WINDOWS}
  SELECT channel, COALESCE(source, 'direct') AS source, referrer_host,
         count(DISTINCT visitor_id)::int AS visitors,
         count(*)::int AS views
  FROM pv
  WHERE cur
  GROUP BY 1, 2, 3
  ORDER BY visitors DESC, views DESC
  LIMIT $2`;

/**
 * Everything the sources page shows, for one period.
 *
 * @param {{ sinceDays: number|null }} opts
 */
export async function getTrafficSources({ sinceDays = null } = {}) {
  const pool = getPool();
  const days = sinceDays ?? null;
  const [totals, taps, timeline, campaigns, raw] = await Promise.all([
    pool.query(CHANNEL_TOTALS_SQL, [days]),
    pool.query(TAP_TOTALS_SQL, [days]),
    pool.query(TIMELINE_SQL, [days, trafficBucket(days)]),
    pool.query(CAMPAIGNS_SQL, [days, 20]),
    pool.query(RAW_SOURCES_SQL, [days, 30]),
  ]);

  const hasPrevious = days !== null;
  const tapsByChannel = new Map();
  const tapsByCampaign = new Map();
  let tapTotal = 0;
  let prevTapTotal = 0;
  for (const row of taps.rows) {
    const entry = tapsByChannel.get(row.channel) || { taps: 0, prevTaps: 0 };
    entry.taps += row.taps;
    entry.prevTaps += row.prev_taps;
    tapsByChannel.set(row.channel, entry);
    tapTotal += row.taps;
    prevTapTotal += row.prev_taps;
    if (row.campaign || row.code) {
      const key = `${row.channel}|${row.campaign || ''}|${row.code || ''}`;
      tapsByCampaign.set(key, (tapsByCampaign.get(key) || 0) + row.taps);
    }
  }

  let total = { views: 0, visitors: 0, prevViews: null, prevVisitors: null };
  const channels = [];
  for (const row of totals.rows) {
    const figures = {
      views: row.views,
      visitors: row.visitors,
      prevViews: hasPrevious ? row.prev_views : null,
      prevVisitors: hasPrevious ? row.prev_visitors : null,
    };
    if (row.channel === null) {
      total = figures;
      continue;
    }
    const tap = tapsByChannel.get(row.channel) || { taps: 0, prevTaps: 0 };
    channels.push({ channel: row.channel, ...figures, taps: tap.taps, prevTaps: hasPrevious ? tap.prevTaps : null });
    tapsByChannel.delete(row.channel);
  }
  // Taps from a channel with no page view in the windows (fallback source only).
  for (const [channel, tap] of tapsByChannel) {
    channels.push({
      channel, views: 0, visitors: 0, prevViews: hasPrevious ? 0 : null, prevVisitors: hasPrevious ? 0 : null,
      taps: tap.taps, prevTaps: hasPrevious ? tap.prevTaps : null,
    });
  }
  channels.sort((a, b) => b.visitors - a.visitors || b.views - a.views || b.taps - a.taps);

  return {
    bucket: trafficBucket(days),
    total: { ...total, taps: tapTotal, prevTaps: hasPrevious ? prevTapTotal : null },
    channels: channels.filter((row) => row.visitors > 0 || row.views > 0 || row.taps > 0 || (row.prevVisitors ?? 0) > 0),
    timeline: timeline.rows,
    campaigns: campaigns.rows.map((row) => ({
      channel: row.channel,
      campaign: row.campaign,
      code: row.code,
      visitors: row.visitors,
      views: row.views,
      prevVisitors: hasPrevious ? row.prev_visitors : null,
      taps: tapsByCampaign.get(`${row.channel}|${row.campaign || ''}|${row.code || ''}`) || 0,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
    })),
    raw: raw.rows,
  };
}
