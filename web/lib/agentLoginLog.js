import 'server-only';
import { headers } from 'next/headers';
import { getPool } from './db';
import { loginSummaryFromRows } from './agentLoginRules';

/**
 * Agent sign-in attempts (`agent_login_attempts`, engine migration
 * 20261024_agent_login_attempts.sql), shown on /admin/agents.
 *
 * Recording never throws into the login action that called it: a failed
 * insert must not turn a correct password into an error page. Before the
 * migration runs (42P01) nothing is recorded and the console shows no
 * history. Only attempts on an existing account are recorded.
 */

const MISSING = new Set(['42P01', '42703']);

async function requestContext() {
  try {
    const h = await headers();
    const forwarded = h.get('x-forwarded-for');
    return {
      ip: (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') || '').trim().slice(0, 64) || null,
      userAgent: (h.get('user-agent') || '').slice(0, 300) || null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** @param {number} agentId @param {string} outcome one of LOGIN_OUTCOMES */
export async function recordAgentLoginAttempt(agentId, outcome) {
  if (!agentId) return;
  const { ip, userAgent } = await requestContext();
  try {
    await getPool().query(
      `INSERT INTO agent_login_attempts (agent_id, outcome, ip_address, user_agent)
       VALUES ($1, $2, $3, $4)`,
      [agentId, outcome, ip, userAgent],
    );
  } catch (err) {
    if (!MISSING.has(err.code)) console.error(`[agent-login-log] agent #${agentId} ${outcome}: ${err.message}`);
  }
}

/**
 * Per agent: last attempt, last sign-in, and failures since that sign-in
 * (30 days at most) — the table's "Dernière connexion" cell.
 * @returns {Promise<Map<number, object>>}
 */
export async function getLoginSummaries(agentIds) {
  const ids = [...new Set((agentIds || []).map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!ids.length) return out;
  try {
    const { rows } = await getPool().query(
      `SELECT agent_id, outcome, attempted_at
         FROM (
           SELECT agent_id, outcome, attempted_at,
                  ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY attempted_at DESC) AS n
             FROM agent_login_attempts
            WHERE agent_id = ANY($1::bigint[])
              AND attempted_at > NOW() - INTERVAL '30 days'
         ) recent
        WHERE n <= 50
        ORDER BY agent_id, attempted_at DESC`,
      [ids],
    );
    const byAgent = new Map();
    for (const row of rows) {
      const id = Number(row.agent_id);
      if (!byAgent.has(id)) byAgent.set(id, []);
      byAgent.get(id).push(row);
    }
    // Older sign-ins (beyond 30 days) still name the last success.
    const { rows: lastOk } = await getPool().query(
      `SELECT agent_id, MAX(attempted_at) AS at
         FROM agent_login_attempts
        WHERE agent_id = ANY($1::bigint[])
          AND outcome IN ('success', 'code_verified', 'whatsapp_verified', 'activated')
        GROUP BY agent_id`,
      [ids],
    );
    const lastOkById = new Map(lastOk.map((r) => [Number(r.agent_id), r.at]));
    for (const id of ids) {
      const summary = loginSummaryFromRows(byAgent.get(id) || [], lastOkById.get(id) || null);
      if (summary) out.set(id, summary);
    }
  } catch (err) {
    if (!MISSING.has(err.code)) console.error(`[agent-login-log] summaries: ${err.message}`);
  }
  return out;
}

/** The agent's last 100 attempts, newest first, for the history dialog. */
export async function getLoginHistory(agentId, { limit = 100 } = {}) {
  try {
    const { rows } = await getPool().query(
      `SELECT id, outcome, ip_address, user_agent, attempted_at
         FROM agent_login_attempts
        WHERE agent_id = $1
        ORDER BY attempted_at DESC
        LIMIT $2`,
      [Number(agentId), Math.min(Math.max(Number(limit) || 100, 1), 200)],
    );
    return { available: true, rows };
  } catch (err) {
    if (MISSING.has(err.code)) return { available: false, rows: [] };
    throw err;
  }
}
