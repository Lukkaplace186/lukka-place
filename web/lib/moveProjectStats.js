import 'server-only';
import { getPool } from './db';

/**
 * /admin/move-projects (2026-11-07): what customers' moves say, in aggregate.
 * Everything is counted from customer_move_projects as the customers told it
 * — nothing estimated. The journey columns are read through
 * `to_jsonb(p) ->> '…'`, so the page works (with zeros) before
 * migrations/20261107_move_project_journey.sql runs.
 *
 * North star: moves that reached "C'est le bon !" (status 'found'), and of
 * those, the ones whose customer said they are settled in — "déménagements
 * accompagnés jusqu'au bout".
 */

const STATUS = "COALESCE(to_jsonb(p) ->> 'status', 'active')";
const FOUND = `(${STATUS} = 'found')`;

/** @returns {Promise<object|null>} null when the table does not exist yet. */
export async function getMoveProjectStats() {
  const pool = getPool();
  try {
    const [totals, reasons, communes, pairs, stories] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS projects,
               COUNT(DISTINCT customer_id)::int AS customers,
               COUNT(*) FILTER (WHERE ${STATUS} = 'active')::int AS active,
               COUNT(*) FILTER (WHERE ${STATUS} = 'paused')::int AS paused,
               COUNT(*) FILTER (WHERE ${FOUND})::int AS found,
               COUNT(*) FILTER (WHERE to_jsonb(p) ->> 'settled_answer' = 'settled')::int AS settled,
               COUNT(*) FILTER (WHERE last_lead_id IS NOT NULL)::int AS sent,
               COUNT(*) FILTER (WHERE to_jsonb(p) ->> 'story_consent_at' IS NOT NULL)::int AS stories,
               percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM ((to_jsonb(p) ->> 'found_at')::timestamptz - p.created_at)) / 86400
               ) FILTER (WHERE to_jsonb(p) ->> 'found_at' IS NOT NULL) AS median_days_to_found
          FROM customer_move_projects p`),
      pool.query(`
        SELECT r AS reason, COUNT(*)::int AS projects, COUNT(*) FILTER (WHERE ${FOUND})::int AS found
          FROM customer_move_projects p, unnest(p.reasons) AS r
         GROUP BY r ORDER BY projects DESC, r`),
      pool.query(`
        SELECT c AS commune, COUNT(*)::int AS projects, COUNT(*) FILTER (WHERE ${FOUND})::int AS found
          FROM customer_move_projects p, unnest(p.communes) AS c
         GROUP BY c ORDER BY projects DESC, c LIMIT 30`),
      pool.query(`
        SELECT r AS reason, c AS commune, COUNT(*)::int AS projects
          FROM customer_move_projects p, unnest(p.reasons) AS r, unnest(p.communes) AS c
         GROUP BY r, c ORDER BY projects DESC, r, c LIMIT 15`),
      // Only stories the customer agreed to share.
      pool.query(`
        SELECT p.customer_id, p.reasons, p.communes,
               to_jsonb(p) ->> 'story_text' AS story,
               to_jsonb(p) ->> 'story_consent_at' AS consent_at
          FROM customer_move_projects p
         WHERE to_jsonb(p) ->> 'story_consent_at' IS NOT NULL AND to_jsonb(p) ->> 'story_text' IS NOT NULL
         ORDER BY (to_jsonb(p) ->> 'story_consent_at') DESC
         LIMIT 20`),
    ]);
    const t = totals.rows[0];
    return {
      ...t,
      // The rows below replace the count under the same name; keep the count.
      stories_count: t.stories,
      median_days_to_found: t.median_days_to_found == null ? null : Math.round(Number(t.median_days_to_found)),
      reasons: reasons.rows,
      communes: communes.rows,
      pairs: pairs.rows,
      stories: stories.rows,
    };
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}
