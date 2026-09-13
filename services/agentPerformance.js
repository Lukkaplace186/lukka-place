/**
 * services/agentPerformance.js
 *
 * How fast, and how usefully, agents answer the leads we route to them.
 *
 * WHAT A "LEAD" IS HERE
 * One viewing request that actually reached an agent's WhatsApp — written by
 * services/viewingNotifications.js the moment the alert is accepted by Chakra.
 * NOT a storefront tap on a direct wa.me link: those open a chat between the
 * customer and the agent that this system never sees, which is the whole
 * point of direct routing and also why it cannot be timed. The leaderboard is
 * therefore honest about its scope — viewing requests and central-routed
 * enquiries — rather than implying it measures every conversation.
 *
 * WHERE IT LIVES
 * Postgres `agent_performance_logs` (migrations/20260913_…), beside `agents`
 * and `properties`, because the read side joins both. The SQLite
 * viewing_requests row carries its own `first_response_at` mirror so the
 * engine can answer "has this agent responded" without a round trip.
 *
 * FAILURE POSTURE
 * Every write is best-effort and never throws into its caller: a metrics
 * insert failing must not stop a customer hearing their visit is confirmed.
 */

const postgres = require('./postgres');
const { computePriceDelta } = require('./priceExtraction');

const OUTCOMES = ['PENDING', 'CONFIRMED', 'RESCHEDULED', 'DECLINED', 'COMPLETED'];

/**
 * Below this many closed transactions a commune's average discount is not
 * reported. Same threshold and same reasoning as web/lib/marketBenchmarks.js's
 * MIN_SAMPLE: an "average" of two sales is two sales, and this figure is meant
 * to be quotable.
 */
const MIN_SAMPLE = 5;

/** SQLite's CURRENT_TIMESTAMP ('2026-09-13 10:04:00', UTC) -> ISO with a Z. */
function sqliteToIso(value) {
  if (!value) return null;
  const text = String(value);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(text)) return new Date(text).toISOString();
  return new Date(`${text.replace(' ', 'T')}Z`).toISOString();
}

function poolOrNull(pool) {
  if (pool) return pool;
  return postgres.isConfigured() ? postgres.getPool() : null;
}

/**
 * One log per viewing request that reached an agent.
 *
 * `reassign: true` is the admin override: the request now belongs to a
 * different agent, so the clock restarts for them rather than charging them
 * for the time the first agent sat on it.
 */
async function logLeadDispatched({ agentId, listingId, viewingRequestId, leadTimestamp, reassign = false } = {}, { pool } = {}) {
  const client = poolOrNull(pool);
  const agent = Number.parseInt(agentId, 10);
  const listing = Number.parseInt(listingId, 10);
  if (!client || !Number.isFinite(agent) || !Number.isFinite(listing)) return false;

  const onConflict = reassign
    ? `DO UPDATE SET agent_id = EXCLUDED.agent_id, lead_timestamp = EXCLUDED.lead_timestamp,
         first_response_timestamp = NULL, response_latency_seconds = NULL,
         outcome_status = 'PENDING', updated_at = NOW()`
    : 'DO NOTHING';

  try {
    const { rowCount } = await client.query(
      `INSERT INTO agent_performance_logs (agent_id, listing_id, viewing_request_id, lead_timestamp)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
       ON CONFLICT (viewing_request_id) WHERE viewing_request_id IS NOT NULL ${onConflict}`,
      [agent, listing, viewingRequestId ?? null, sqliteToIso(leadTimestamp)],
    );
    return rowCount > 0;
  } catch (err) {
    console.error(`[performance] dispatch log for request #${viewingRequestId} failed: ${err.message}`);
    return false;
  }
}

/**
 * The agent answered. The FIRST answer fixes the latency (COALESCE keeps it);
 * the outcome follows every later answer, so a reschedule that ends in an
 * accept reads CONFIRMED.
 */
async function logResponse({ viewingRequestId, outcome, at = new Date().toISOString() } = {}, { pool } = {}) {
  const client = poolOrNull(pool);
  if (!client || !viewingRequestId) return false;
  if (!OUTCOMES.includes(outcome)) throw new Error(`logResponse: unknown outcome '${outcome}'`);
  try {
    const { rowCount } = await client.query(
      `UPDATE agent_performance_logs
          SET first_response_timestamp = COALESCE(first_response_timestamp, $2::timestamptz),
              response_latency_seconds = COALESCE(
                response_latency_seconds,
                GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - lead_timestamp)))::int
              ),
              outcome_status = $3,
              updated_at = NOW()
        WHERE viewing_request_id = $1`,
      [viewingRequestId, at, outcome],
    );
    return rowCount > 0;
  } catch (err) {
    console.error(`[performance] response log for request #${viewingRequestId} failed: ${err.message}`);
    return false;
  }
}

/** A later milestone that is not an agent response (the visit happened). */
async function logOutcome({ viewingRequestId, outcome } = {}, { pool } = {}) {
  const client = poolOrNull(pool);
  if (!client || !viewingRequestId) return false;
  if (!OUTCOMES.includes(outcome)) throw new Error(`logOutcome: unknown outcome '${outcome}'`);
  try {
    const { rowCount } = await client.query(
      'UPDATE agent_performance_logs SET outcome_status = $2, updated_at = NOW() WHERE viewing_request_id = $1',
      [viewingRequestId, outcome],
    );
    return rowCount > 0;
  } catch (err) {
    console.error(`[performance] outcome log for request #${viewingRequestId} failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read side — GET /api/admin/benchmarks/agent-performance
// ---------------------------------------------------------------------------

const { AGENT_NAME_EXPR, AGENT_INFOS_JOIN, COMMUNE_SUBQUERY } = require('./propertyRepository');

/**
 * Every agent, with whatever activity the window holds. LEFT JOIN on purpose:
 * the admin page needs a routing switch for an agent who has had no leads yet,
 * and "0 leads" is a real answer where an absent row reads as "no such agent".
 */
const AGENT_PERFORMANCE_SQL = `
  SELECT
    a.id AS agent_id,
    ${AGENT_NAME_EXPR},
    a.phone AS agent_phone,
    a.phone_verified_at,
    a.direct_routing_enabled,
    COUNT(l.id)::int                                                         AS leads,
    COUNT(l.first_response_timestamp)::int                                   AS responded,
    AVG(l.response_latency_seconds)::float                                   AS avg_latency_seconds,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l.response_latency_seconds)  AS median_latency_seconds,
    COUNT(*) FILTER (WHERE l.outcome_status IN ('CONFIRMED', 'COMPLETED'))::int AS viewings,
    COUNT(*) FILTER (WHERE l.outcome_status = 'COMPLETED')::int              AS completed,
    COUNT(*) FILTER (WHERE l.outcome_status = 'DECLINED')::int               AS declined,
    COUNT(DISTINCT l.listing_id) FILTER (WHERE p.listing_status = 'closed')::int AS closed_deals
  FROM agents a
  LEFT JOIN agent_performance_logs l
    ON l.agent_id = a.id AND l.lead_timestamp >= NOW() - make_interval(days => $1::int)
  LEFT JOIN properties p ON p.id = l.listing_id
  ${AGENT_INFOS_JOIN}
  GROUP BY a.id, ai.first_name, ai.last_name
  ORDER BY leads DESC, a.id
`;

/**
 * Average negotiation delta by commune over real closes.
 *
 * `approve_status = 1` ONLY — the same deliberate departure from the public
 * gate web/lib/dataExport.js and marketBenchmarks.js make: closing sets
 * `status = 0`, so filtering on it would drop every sold listing. No
 * imputation: a close without a recorded figure is excluded.
 */
const COMMUNE_DELTA_SQL = `
  WITH closed AS (
    SELECT
      ${COMMUNE_SUBQUERY},
      p.price,
      p.sold_price,
      p.price_source
    FROM properties p
    WHERE p.approve_status = 1
      AND p.listing_status = 'closed'
      AND p.sold_price IS NOT NULL
      AND p.price > 0
  )
  SELECT
    commune,
    COUNT(*)::int                                                         AS sample,
    AVG(((sold_price - price) / price) * 100)::float                      AS avg_delta_pct,
    AVG(sold_price - price)::float                                        AS avg_delta_usd,
    COUNT(*) FILTER (WHERE price_source = 'WHATSAPP_AGENT_REPLY')::int    AS from_whatsapp
  FROM closed
  GROUP BY commune
  ORDER BY sample DESC, commune
`;

const round1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10);

/** Rates are null, not 0, when there is nothing to divide by. */
function summariseAgentRow(row) {
  const leads = Number(row.leads) || 0;
  const responded = Number(row.responded) || 0;
  const viewings = Number(row.viewings) || 0;
  const closedDeals = Number(row.closed_deals) || 0;
  const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : null);
  return {
    agentId: Number(row.agent_id),
    name: row.agent_name || null,
    phone: row.agent_phone || null,
    phoneVerified: Boolean(row.phone_verified_at),
    directRoutingEnabled: row.direct_routing_enabled !== false,
    // What the storefront actually does for this agent's listings.
    routesDirect: Boolean(row.agent_phone && row.phone_verified_at && row.direct_routing_enabled !== false),
    leads,
    responded,
    avgLatencySeconds: row.avg_latency_seconds == null ? null : Math.round(Number(row.avg_latency_seconds)),
    medianLatencySeconds: row.median_latency_seconds == null ? null : Math.round(Number(row.median_latency_seconds)),
    viewings,
    completed: Number(row.completed) || 0,
    declined: Number(row.declined) || 0,
    closedDeals,
    responseRatePct: pct(responded, leads),
    // The spec's conversion: viewings confirmed / leads routed.
    leadToViewingPct: pct(viewings, leads),
    viewingToClosePct: pct(closedDeals, viewings),
  };
}

function summariseCommuneRow(row) {
  const sample = Number(row.sample) || 0;
  const suppressed = sample < MIN_SAMPLE;
  return {
    commune: row.commune || null,
    sample,
    suppressed,
    avgDeltaPct: suppressed ? null : round1(row.avg_delta_pct),
    avgDeltaUsd: suppressed || row.avg_delta_usd == null ? null : Math.round(Number(row.avg_delta_usd)),
    fromWhatsapp: Number(row.from_whatsapp) || 0,
  };
}

/**
 * @param {{days?: number, pool?: Object}} [options]
 * @returns {Promise<{windowDays: number, agents: Object[], communes: Object[], totals: Object}>}
 */
async function getAgentPerformanceBenchmarks({ days = 90, pool } = {}) {
  const client = poolOrNull(pool);
  if (!client) throw new Error('Postgres is not configured');
  const parsed = Number.parseInt(days, 10);
  const windowDays = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 365) : 90;

  const [{ rows: agentRows }, { rows: communeRows }] = await Promise.all([
    client.query(AGENT_PERFORMANCE_SQL, [windowDays]),
    client.query(COMMUNE_DELTA_SQL),
  ]);

  const agents = agentRows.map(summariseAgentRow);
  const communes = communeRows.map(summariseCommuneRow);
  const leads = agents.reduce((sum, a) => sum + a.leads, 0);
  const responded = agents.reduce((sum, a) => sum + a.responded, 0);
  const viewings = agents.reduce((sum, a) => sum + a.viewings, 0);
  const latencyWeighted = agents.reduce((sum, a) => sum + (a.avgLatencySeconds ?? 0) * a.responded, 0);

  return {
    windowDays,
    minSample: MIN_SAMPLE,
    agents,
    communes,
    totals: {
      agents: agents.length,
      directRoutingAgents: agents.filter((a) => a.routesDirect).length,
      leads,
      responded,
      viewings,
      avgLatencySeconds: responded > 0 ? Math.round(latencyWeighted / responded) : null,
      leadToViewingPct: leads > 0 ? round1((viewings / leads) * 100) : null,
      closedTransactions: communes.reduce((sum, c) => sum + c.sample, 0),
    },
  };
}

module.exports = {
  logLeadDispatched,
  logResponse,
  logOutcome,
  getAgentPerformanceBenchmarks,
  summariseAgentRow,
  summariseCommuneRow,
  sqliteToIso,
  computePriceDelta,
  AGENT_PERFORMANCE_SQL,
  COMMUNE_DELTA_SQL,
  OUTCOMES,
  MIN_SAMPLE,
};
