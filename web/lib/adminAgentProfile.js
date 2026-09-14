import 'server-only';
import { getPool } from './db';

/**
 * The performance half of an agent's profile page, from
 * `agent_performance_logs` — one row per viewing request that REACHED this
 * agent (services/viewingNotifications.js). Same scope as the leaderboard: a
 * direct wa.me chat is invisible to us and is not counted.
 */

export async function getAgentPerformanceSummary(agentId, days = 90) {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS leads,
            COUNT(first_response_timestamp)::int AS responded,
            AVG(response_latency_seconds)::float AS avg_latency_seconds,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_latency_seconds)::float AS median_latency_seconds,
            COUNT(*) FILTER (WHERE outcome_status IN ('CONFIRMED', 'COMPLETED'))::int AS viewings,
            COUNT(*) FILTER (WHERE outcome_status = 'COMPLETED')::int AS completed,
            COUNT(*) FILTER (WHERE outcome_status = 'DECLINED')::int AS declined
     FROM agent_performance_logs
     WHERE agent_id = $1 AND lead_timestamp >= NOW() - make_interval(days => $2::int)`,
    [agentId, days],
  );
  return rows[0];
}

export async function listAgentPerformanceLogs(agentId, limit = 20) {
  const { rows } = await getPool().query(
    `SELECT l.listing_id, l.viewing_request_id, l.lead_timestamp, l.first_response_timestamp,
            l.response_latency_seconds, l.outcome_status, pc.title
     FROM agent_performance_logs l
     LEFT JOIN property_contents pc ON pc.property_id = l.listing_id AND pc.language_id = 20
     WHERE l.agent_id = $1
     ORDER BY l.lead_timestamp DESC
     LIMIT $2`,
    [agentId, Math.min(Number(limit) || 20, 100)],
  );
  return rows;
}

export async function getAgentListingStatusCounts(agentId) {
  const { rows } = await getPool().query(
    `SELECT COUNT(*) FILTER (WHERE approve_status = 0)::int AS pending,
            COUNT(*) FILTER (WHERE approve_status = 1 AND status = 1)::int AS approved,
            COUNT(*) FILTER (WHERE approve_status = 2)::int AS rejected,
            COUNT(*) FILTER (WHERE approve_status = 1 AND status = 0)::int AS suspended
     FROM properties WHERE agent_id = $1`,
    [agentId],
  );
  return rows[0];
}
