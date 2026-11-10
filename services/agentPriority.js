/**
 * services/agentPriority.js
 *
 * An agency's priority level for customer requests (2026-11-10, owner
 * decision): Or / Argent / Bronze, from what the agency does with us, shown
 * to the agency on its dashboard (never publicly) with what to do to move up.
 * The level multiplies the match score in services/leadDispatch.js, so an Or
 * agency lands in the first, exclusive wave more often.
 *
 * Replaces the hidden ×1.05 "up-to-date portfolio" boost (2026-11-09) and the
 * responsiveness multiplier: both are now parts of the level, worth enough
 * to change who is asked first, and visible to the agency.
 *
 * Points (100):
 *   up_to_date   30  every live listing confirmed or published in the last
 *                    14 days ("Faites le point"), at least one live listing
 *   new_listing  15  a listing published in the last 30 days
 *   requests     35  share of request alerts answered in 60 days (claimed,
 *                    "Pas dispo" or a listing proposed); fewer than 3 alerts
 *                    = half marks, a new agency is not punished
 *   visits       20  share of visit requests answered in 60 days; fewer than
 *                    2 = half marks
 *
 * The plan (packages.priority_multiplier) stays in the match score, outside
 * the level: a boost, never a pass (owner decision).
 *
 * Nothing here is invented: a signal that cannot be read gives nobody its
 * points (Postgres down -> no portfolio points for anyone) and is reported
 * as unknown to the dashboard.
 */

const dbService = require('./db');
const { portfolioSignals: readPortfolioSignals } = require('./agentRanking');

const LEVELS = ['or', 'argent', 'bronze'];
const LEVEL_THRESHOLDS = { or: 70, argent: 40 };
const LEVEL_MULTIPLIER = { or: 1.25, argent: 1, bronze: 0.8 };

const POINTS = { up_to_date: 30, new_listing: 15, requests: 35, visits: 20 };
const HISTORY_DAYS = 60;
const NEW_LISTING_DAYS = 30;
const MIN_ALERTS = 3;
const MIN_VISITS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

function levelFor(points) {
  if (points >= LEVEL_THRESHOLDS.or) return 'or';
  if (points >= LEVEL_THRESHOLDS.argent) return 'argent';
  return 'bronze';
}

/** Visit requests per agent over the window: total and answered. */
function visitStatsSince(agentIds, since) {
  if (agentIds.length === 0) return new Map();
  const placeholders = agentIds.map(() => '?').join(', ');
  const rows = dbService.db
    .prepare(
      `SELECT agent_id,
              COUNT(*) AS total,
              SUM(CASE WHEN first_response_at IS NOT NULL OR direct_contact_at IS NOT NULL THEN 1 ELSE 0 END) AS answered
         FROM viewing_requests
        WHERE agent_id IN (${placeholders}) AND created_at >= datetime(?)
        GROUP BY agent_id`,
    )
    .all(...agentIds, since);
  return new Map(rows.map((r) => [Number(r.agent_id), { total: r.total, answered: r.answered || 0 }]));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * One agency's level from its signals. Pure.
 *
 * @param {{portfolio: {live:number, stale:number, lastPublishedAt: Date|null}|null|undefined,
 *          requests: {matched:number, answered:number}|undefined,
 *          visits: {total:number, answered:number}|undefined,
 *          portfolioKnown: boolean, now: number}} s
 */
function scoreAgent({ portfolio, requests, visits, portfolioKnown, now }) {
  const parts = [];
  if (portfolioKnown) {
    const live = portfolio?.live || 0;
    const upToDate = live > 0 && (portfolio?.stale || 0) === 0;
    parts.push({ key: 'up_to_date', points: upToDate ? POINTS.up_to_date : 0, max: POINTS.up_to_date, live, stale: portfolio?.stale || 0 });
    const last = portfolio?.lastPublishedAt ? new Date(portfolio.lastPublishedAt).getTime() : null;
    const recent = last != null && now - last <= NEW_LISTING_DAYS * DAY_MS;
    parts.push({ key: 'new_listing', points: recent ? POINTS.new_listing : 0, max: POINTS.new_listing, lastPublishedAt: last ? new Date(last).toISOString() : null });
  } else {
    parts.push({ key: 'up_to_date', points: 0, max: POINTS.up_to_date, unknown: true });
    parts.push({ key: 'new_listing', points: 0, max: POINTS.new_listing, unknown: true });
  }
  const matched = requests?.matched || 0;
  const answeredRequests = requests?.answered || 0;
  const requestRate = matched >= MIN_ALERTS ? answeredRequests / matched : 0.5;
  parts.push({
    key: 'requests', points: round1(POINTS.requests * requestRate), max: POINTS.requests,
    alerts: matched, answered: answeredRequests, neutral: matched < MIN_ALERTS,
  });
  const totalVisits = visits?.total || 0;
  const answeredVisits = visits?.answered || 0;
  const visitRate = totalVisits >= MIN_VISITS ? answeredVisits / totalVisits : 0.5;
  parts.push({
    key: 'visits', points: round1(POINTS.visits * visitRate), max: POINTS.visits,
    requests: totalVisits, answered: answeredVisits, neutral: totalVisits < MIN_VISITS,
  });
  const points = round1(parts.reduce((sum, p) => sum + p.points, 0));
  const level = levelFor(points);
  return { level, points, multiplier: LEVEL_MULTIPLIER[level], parts };
}

/**
 * Levels for several agencies at once (one Postgres query, two SQLite reads).
 * Never throws: a failed read gives nobody that signal's points.
 *
 * @param {number[]} agentIds
 * @param {{portfolioSignals?: Function, now?: number}} [options]
 * @returns {Promise<Map<number, ReturnType<typeof scoreAgent>>>}
 */
async function computeLevels(agentIds, { portfolioSignals = readPortfolioSignals, now = Date.now() } = {}) {
  const ids = [...new Set((agentIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = new Map();
  if (ids.length === 0) return out;
  const since = new Date(now - HISTORY_DAYS * DAY_MS).toISOString();

  let portfolio = null;
  try {
    portfolio = await portfolioSignals(ids);
  } catch (err) {
    console.warn(`[agent-priority] portfolio signals failed: ${err.message}`);
  }
  let requests = new Map();
  try {
    requests = dbService.getAgentResponsivenessSince({ since });
  } catch (err) {
    console.warn(`[agent-priority] request history unavailable: ${err.message}`);
  }
  let visits = new Map();
  try {
    visits = visitStatsSince(ids, since);
  } catch (err) {
    console.warn(`[agent-priority] visit history unavailable: ${err.message}`);
  }

  for (const id of ids) {
    out.set(id, scoreAgent({
      portfolio: portfolio ? portfolio.get(id) : null,
      portfolioKnown: portfolio instanceof Map,
      requests: requests.get(id),
      visits: visits.get(id),
      now,
    }));
  }
  return out;
}

/** One agency's level, for its dashboard (GET /admin/agents/:id/priority). */
async function getAgentPriority(agentId, options) {
  const levels = await computeLevels([agentId], options);
  const result = levels.get(Number(agentId));
  if (!result) return null;
  return {
    ...result,
    thresholds: LEVEL_THRESHOLDS,
    next: result.level === 'or' ? null : (result.level === 'argent' ? 'or' : 'argent'),
    pointsToNext: result.level === 'or' ? 0 : round1(LEVEL_THRESHOLDS[result.level === 'argent' ? 'or' : 'argent'] - result.points),
  };
}

module.exports = {
  computeLevels,
  getAgentPriority,
  scoreAgent,
  levelFor,
  LEVELS,
  LEVEL_THRESHOLDS,
  LEVEL_MULTIPLIER,
  POINTS,
};
