import 'server-only';
import { getPool } from './db';

/**
 * C4 — a customer follows an agency (app plan part 2 phase 3, 2026-11-10):
 * "Suivre" on /agents/<id>, and the Lukka Place app pushes each new listing
 * that agency publishes (lib/portalDigests.js runFollowedAgentListings).
 * Table customer_follows (migrations/20261110_push_notifications.sql).
 *
 * The customer is always the session's; the agent id is checked against a
 * live, public agent account (not deleted). Before the migration, reads say
 * "not following" and a follow answers 'unavailable'.
 */

const MISSING = new Set(['42P01', '42703']);
export const MAX_FOLLOWS = 100;

export async function isFollowing(customerId, agentId) {
  try {
    const { rows } = await getPool().query(
      'SELECT 1 FROM customer_follows WHERE customer_id = $1 AND agent_id = $2',
      [customerId, agentId],
    );
    return rows.length > 0;
  } catch (err) {
    if (MISSING.has(err?.code)) return false;
    throw err;
  }
}

/** @returns {Promise<'ok'|'not-found'|'limit'|'unavailable'>} */
export async function followAgent(customerId, agentId) {
  try {
    const { rows } = await getPool().query(
      `INSERT INTO customer_follows (customer_id, agent_id)
       SELECT $1, a.id FROM agents a
        WHERE a.id = $2 AND a.deleted_at IS NULL
          AND (SELECT COUNT(*) FROM customer_follows f WHERE f.customer_id = $1) < ${MAX_FOLLOWS}
       ON CONFLICT (customer_id, agent_id) DO NOTHING
       RETURNING agent_id`,
      [customerId, agentId],
    );
    if (rows.length) return 'ok';
    if (await isFollowing(customerId, agentId)) return 'ok';
    const { rows: agent } = await getPool().query('SELECT 1 FROM agents WHERE id = $1 AND deleted_at IS NULL', [agentId]);
    return agent.length ? 'limit' : 'not-found';
  } catch (err) {
    if (MISSING.has(err?.code)) return 'unavailable';
    throw err;
  }
}

export async function unfollowAgent(customerId, agentId) {
  try {
    await getPool().query('DELETE FROM customer_follows WHERE customer_id = $1 AND agent_id = $2', [customerId, agentId]);
    return 'ok';
  } catch (err) {
    if (MISSING.has(err?.code)) return 'unavailable';
    throw err;
  }
}
