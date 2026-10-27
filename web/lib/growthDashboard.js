import 'server-only';
import { getPool } from './db';
import { CHANNELS, CHANNEL_LABELS_FR, channelOf, dailySummaryText, paidChannelCosts } from './growthRules';

/**
 * /admin/croissance and the owners' morning summary (growth plan items 21–22).
 * Every figure is counted from rows that exist: customer accounts and where
 * they came from (account_acquisitions), agent accounts, visitors
 * (page_views, people only), partner conversions, and the ad spend the team
 * typed in. No target (owner decision 2026-10-27): the page counts.
 *
 * Days are Kinshasa days. Before the attribution migration every account is
 * "inconnu" and partner figures are empty; nothing throws.
 */

const MISSING = new Set(['42P01', '42703']);
const KINSHASA_DAY = (column) => `to_char((${column} AT TIME ZONE 'Africa/Kinshasa')::date, 'YYYY-MM-DD')`;

export const SIGNUPS_BY_DAY_SQL = `
  SELECT ${KINSHASA_DAY('c.created_at')} AS day,
         aa.id IS NOT NULL AS has_acquisition,
         aa.channel,
         p.kind AS partner_kind,
         COALESCE(NULLIF(aa.last_source, 'direct'), aa.first_source) AS source,
         CASE WHEN NULLIF(aa.last_source, 'direct') IS NOT NULL THEN aa.last_medium ELSE aa.first_medium END AS medium,
         COALESCE(aa.last_click_id_type, aa.first_click_id_type) AS click_id_type,
         COUNT(*)::int AS accounts,
         COUNT(*) FILTER (WHERE c.phone_verified_at IS NOT NULL)::int AS verified
    FROM customers c
    LEFT JOIN account_acquisitions aa ON aa.account_type = 'customer' AND aa.account_id = c.id
    LEFT JOIN partners p ON p.id = aa.partner_id
   WHERE c.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa') - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
   GROUP BY 1, 2, 3, 4, 5, 6, 7
`;

// Before account_acquisitions exists: every account is "inconnu".
const SIGNUPS_BY_DAY_LEGACY_SQL = `
  SELECT ${KINSHASA_DAY('c.created_at')} AS day, false AS has_acquisition,
         COUNT(*)::int AS accounts, COUNT(*) FILTER (WHERE c.phone_verified_at IS NOT NULL)::int AS verified
    FROM customers c
   WHERE c.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa') - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
   GROUP BY 1, 2
`;

const AGENTS_BY_DAY_SQL = `
  SELECT ${KINSHASA_DAY('a.created_at')} AS day, COUNT(*)::int AS agents
    FROM agents a
   WHERE a.deleted_at IS NULL
     AND a.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa') - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
   GROUP BY 1
`;

/** People only: the dashboard's rule (lib/analytics.js peopleSql). */
const VISITORS_BY_DAY_SQL = `
  SELECT ${KINSHASA_DAY('pv.created_at')} AS day,
         COUNT(DISTINCT pv.visitor_id)::int AS visitors,
         COUNT(*) FILTER (WHERE pv.listing_id IS NOT NULL)::int AS listing_views
    FROM page_views pv
   WHERE pv.created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Africa/Kinshasa') - make_interval(days => $1::int - 1)) AT TIME ZONE 'Africa/Kinshasa'
     AND COALESCE(to_jsonb(pv) ->> 'viewer_kind', 'visitor') = 'visitor'
     AND COALESCE(pv.device, '') <> 'bot'
     AND COALESCE(pv.source, '') <> 'localhost'
   GROUP BY 1
`;

/** The days of the window, oldest first, as YYYY-MM-DD (Kinshasa). */
export function windowDays(days, now = new Date()) {
  const today = new Date(now.getTime() + 60 * 60 * 1000);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

async function query(sql, params, legacySql = null) {
  const pool = getPool();
  try {
    return (await pool.query(sql, params)).rows;
  } catch (err) {
    if (!MISSING.has(err?.code)) throw err;
    return legacySql ? (await pool.query(legacySql, params)).rows : [];
  }
}

/**
 * @returns {Promise<{days: object[], totals: object, byChannel: Record<string, {accounts: number, verified: number}>,
 *                    costs: object, spend: object[]}>}
 */
export async function getGrowthDashboard({ days = 30 } = {}) {
  const span = Math.max(1, Math.min(365, Number(days) || 30));
  const [signups, agents, visitors, spend] = await Promise.all([
    query(SIGNUPS_BY_DAY_SQL, [span], SIGNUPS_BY_DAY_LEGACY_SQL),
    query(AGENTS_BY_DAY_SQL, [span]),
    query(VISITORS_BY_DAY_SQL, [span]),
    listAdSpend({ days: span }),
  ]);

  const byDay = new Map(windowDays(span).map((day) => [day, {
    day, accounts: 0, verified: 0, agents: 0, visitors: 0, listingViews: 0, byChannel: {},
  }]));
  const byChannel = Object.fromEntries(CHANNELS.map((channel) => [channel, { accounts: 0, verified: 0 }]));

  for (const row of signups) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    const channel = channelOf({
      hasAcquisition: row.has_acquisition,
      channel: row.channel,
      partnerKind: row.partner_kind,
      source: row.source,
      medium: row.medium,
      clickIdType: row.click_id_type,
    });
    entry.accounts += row.accounts;
    entry.verified += row.verified;
    entry.byChannel[channel] = (entry.byChannel[channel] || 0) + row.accounts;
    byChannel[channel].accounts += row.accounts;
    byChannel[channel].verified += row.verified;
  }
  for (const row of agents) if (byDay.has(row.day)) byDay.get(row.day).agents = row.agents;
  for (const row of visitors) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    entry.visitors = row.visitors;
    entry.listingViews = row.listing_views;
  }

  const list = [...byDay.values()];
  const totals = list.reduce((acc, d) => ({
    accounts: acc.accounts + d.accounts,
    verified: acc.verified + d.verified,
    agents: acc.agents + d.agents,
    visitorDays: acc.visitorDays + d.visitors,
    listingViews: acc.listingViews + d.listingViews,
  }), { accounts: 0, verified: 0, agents: 0, visitorDays: 0, listingViews: 0 });
  totals.viewsPerVisitor = totals.visitorDays > 0 ? Math.round((totals.listingViews / totals.visitorDays) * 10) / 10 : null;

  const verifiedByChannel = Object.fromEntries(Object.entries(byChannel).map(([channel, v]) => [channel, v.verified]));
  return { days: list, totals, byChannel, costs: paidChannelCosts(spend, verifiedByChannel), spend };
}

// ---------------------------------------------------------------------------
// Ad spend (typed in weekly, partners.stats)
// ---------------------------------------------------------------------------

export async function listAdSpend({ days = 90 } = {}) {
  try {
    const { rows } = await getPool().query(
      `SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, channel, amount, currency, entered_by
         FROM ad_spend_weekly
        WHERE week_start >= (NOW() AT TIME ZONE 'Africa/Kinshasa')::date - make_interval(days => $1::int + 6)
        ORDER BY week_start DESC, channel`,
      [days],
    );
    return rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  } catch (err) {
    if (MISSING.has(err?.code)) return [];
    throw err;
  }
}

export async function upsertAdSpend({ weekStart, channel, amount, currency, by }) {
  await getPool().query(
    `INSERT INTO ad_spend_weekly (week_start, channel, amount, currency, entered_by)
     VALUES ($1::date, $2, $3, $4, $5)
     ON CONFLICT (week_start, channel, currency) DO UPDATE
       SET amount = EXCLUDED.amount, entered_by = EXCLUDED.entered_by, updated_at = NOW()`,
    [weekStart, channel, amount, currency, by],
  );
}

// ---------------------------------------------------------------------------
// The owners' morning summary
// ---------------------------------------------------------------------------

const TOP_PARTNER_SQL = `
  SELECT p.kind,
         COALESCE(NULLIF(TRIM(a.agency_name), ''), NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), ''), p.name) AS name,
         COUNT(*)::int AS n
    FROM partner_conversions c
    JOIN partners p ON p.id = c.partner_id
    LEFT JOIN agents a ON a.id = p.agent_id
    LEFT JOIN LATERAL (SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1) ai ON TRUE
   WHERE ${KINSHASA_DAY('c.created_at')} = $1
   GROUP BY p.kind, 2
   ORDER BY n DESC
`;

/**
 * Yesterday (Kinshasa) in one French message: accounts by channel, new
 * agents, visitors, the best agent and the best creator.
 * @returns {Promise<{day: string, text: string}>}
 */
export async function getDailySummary({ now = new Date() } = {}) {
  const dashboard = await getGrowthDashboard({ days: 2 });
  const yesterday = windowDays(2, now)[0];
  const entry = dashboard.days.find((d) => d.day === yesterday) || { accounts: 0, agents: 0, visitors: null, byChannel: {} };
  const partners = await query(TOP_PARTNER_SQL, [yesterday]);
  const top = (kind) => {
    const row = partners.find((p) => p.kind === kind);
    return row ? { name: row.name, n: row.n } : null;
  };
  const [y, m, d] = yesterday.split('-').map(Number);
  const dayLabel = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return {
    day: yesterday,
    text: dailySummaryText({
      day: dayLabel,
      customers: entry.accounts,
      agents: entry.agents,
      byChannel: entry.byChannel,
      visitors: entry.visitors ?? null,
      topAgent: top('agent'),
      topCreator: top('creator'),
    }, CHANNEL_LABELS_FR),
  };
}
