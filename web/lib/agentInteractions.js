import 'server-only';
import { getPool } from './db';
import { getInteractionCounts as getEngineInteractionCounts } from './adminApi';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';
import { mergeInteractionCounts, propertyIdsToAttribute } from './interactionCounts';

/**
 * Reads behind /admin/interactions; lib/interactionCounts.js adds them up.
 * Only visitors' taps count (`viewer_kind = 'visitor'`): the listing's own
 * agent, the team, bots and prefetches are stored too (lib/trackIngest.js)
 * but are not a customer reaching anybody.
 */

export const TAPS_BY_AGENT_SQL = `
  SELECT agent_id, routing_type, COUNT(*)::int AS count
    FROM whatsapp_clicks
   WHERE created_at >= NOW() - make_interval(days => $1::int)
     AND COALESCE(viewer_kind, 'visitor') = 'visitor'
   GROUP BY agent_id, routing_type
`;

export const CALLS_BY_AGENT_SQL = `
  SELECT p.agent_id, e.routing_type, COUNT(*)::int AS count
    FROM listing_events e
    LEFT JOIN properties p ON p.id = e.listing_id
   WHERE e.event = 'call_click'
     AND e.created_at >= NOW() - make_interval(days => $1::int)
     AND COALESCE(e.viewer_kind, 'visitor') = 'visitor'
   GROUP BY p.agent_id, e.routing_type
`;

export const PROPERTY_AGENTS_SQL = 'SELECT id, agent_id FROM properties WHERE id = ANY($1::bigint[])';

export const AGENT_NAMES_SQL = `
  SELECT a.id, ${AGENCY_NAME_EXPR},
         NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS person_name
    FROM agents a
    ${AGENT_INFOS_JOIN}
   WHERE a.id = ANY($1::bigint[])
`;

const toRows = (rows) => rows.map((r) => ({
  agentId: r.agent_id == null ? null : Number(r.agent_id),
  routingType: r.routing_type,
  count: Number(r.count) || 0,
}));

/**
 * @param {{days: number}} options
 * @returns {Promise<{days: number, counts: ReturnType<typeof mergeInteractionCounts>,
 *   names: Map<number, string>, errors: {engine: string|null, taps: string|null}}>}
 *   Each store is read on its own: one being down leaves the other's channels
 *   on the page and says which half is missing, never a silent zero.
 */
export async function getAgentInteractions({ days }) {
  const pool = getPool();
  const [tapsRes, callsRes, engineRes] = await Promise.allSettled([
    pool.query(TAPS_BY_AGENT_SQL, [days]),
    pool.query(CALLS_BY_AGENT_SQL, [days]),
    getEngineInteractionCounts({ days }),
  ]);

  const errors = {
    taps: tapsRes.status === 'rejected' || callsRes.status === 'rejected'
      ? (tapsRes.reason?.message || callsRes.reason?.message || 'error') : null,
    engine: engineRes.status === 'rejected' ? (engineRes.reason?.message || 'error') : null,
  };
  if (errors.taps) console.error(`[admin/interactions] taps read failed: ${errors.taps}`);
  if (errors.engine) console.error(`[admin/interactions] engine read failed: ${errors.engine}`);

  const engine = engineRes.status === 'fulfilled' ? engineRes.value : { leads: [], viewings: [] };
  const taps = tapsRes.status === 'fulfilled' ? toRows(tapsRes.value.rows) : [];
  const calls = callsRes.status === 'fulfilled' ? toRows(callsRes.value.rows) : [];

  const propertyAgents = new Map();
  const toAttribute = propertyIdsToAttribute(engine);
  if (toAttribute.length) {
    try {
      const { rows } = await pool.query(PROPERTY_AGENTS_SQL, [toAttribute]);
      for (const r of rows) propertyAgents.set(Number(r.id), r.agent_id == null ? null : Number(r.agent_id));
    } catch (err) {
      console.error(`[admin/interactions] listing → agent lookup failed: ${err.message}`);
    }
  }

  const counts = mergeInteractionCounts({ taps, calls, engine, propertyAgents });

  const names = new Map();
  const ids = counts.agents.map((a) => a.agentId).filter(Boolean);
  if (ids.length) {
    try {
      const { rows } = await pool.query(AGENT_NAMES_SQL, [ids]);
      // Person first, like every console label (ADMIN_AGENT_NAME); never the
      // username, which is the phone number.
      for (const r of rows) names.set(Number(r.id), r.person_name || r.agency_name || null);
    } catch (err) {
      console.error(`[admin/interactions] agent names failed: ${err.message}`);
    }
  }

  return { days, counts, names, errors };
}
