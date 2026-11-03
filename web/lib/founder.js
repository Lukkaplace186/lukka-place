import 'server-only';
import { getPool } from './db';
import { getGrowthSettings } from './siteSettings';

/**
 * "Membre fondateur" (growth plan item 25) belongs to the commissionnaires
 * and agencies who joined early, not to customer accounts (owner decision,
 * 2026-11-04 — it was first built on customers). Every agent account created
 * before the cutoff day (/admin/settings, default 21 December 2026, read as
 * the start of that day in Kinshasa) carries the badge, and every agent its
 * number — its rank by creation among agent accounts that exist and are not
 * deleted or test accounts. A counted number, never a stored one: a deleted
 * account simply leaves the count. Null when the database cannot answer.
 *
 * @returns {Promise<{founder: boolean, memberNumber: number, cutoff: string}|null>}
 */
export async function getAgentFounderInfo(agentId) {
  try {
    const { founderCutoff } = await getGrowthSettings();
    const { rows } = await getPool().query(
      `SELECT a.created_at < ($2::date::timestamp AT TIME ZONE 'Africa/Kinshasa') AS founder,
              (SELECT COUNT(*) FROM agents a2
                WHERE a2.deleted_at IS NULL
                  AND NOT COALESCE((to_jsonb(a2) ->> 'is_test')::boolean, false)
                  AND (a2.created_at < a.created_at OR (a2.created_at = a.created_at AND a2.id <= a.id)))::int AS member_number
         FROM agents a
        WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [Number(agentId), founderCutoff],
    );
    if (!rows[0] || rows[0].founder === null) return null;
    return { founder: Boolean(rows[0].founder), memberNumber: Number(rows[0].member_number), cutoff: founderCutoff };
  } catch (err) {
    console.error(`[founder] agent #${agentId}: ${err.message}`);
    return null;
  }
}
