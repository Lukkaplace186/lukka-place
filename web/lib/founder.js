import 'server-only';
import { getPool } from './db';
import { getGrowthSettings } from './siteSettings';

/**
 * "Membre fondateur" (growth plan item 25): every customer account created
 * before the cutoff day (/admin/settings, default 21 December 2026, read as
 * the start of that day in Kinshasa) carries the badge, and every account its
 * member number — its rank by creation among customer accounts that exist.
 * A counted number, never a stored one: a deleted account simply leaves the
 * count. Null when the database cannot answer.
 *
 * @returns {Promise<{founder: boolean, memberNumber: number, cutoff: string}|null>}
 */
export async function getFounderInfo(customerId) {
  try {
    const { founderCutoff } = await getGrowthSettings();
    const { rows } = await getPool().query(
      `SELECT c.created_at < ($2::date::timestamp AT TIME ZONE 'Africa/Kinshasa') AS founder,
              (SELECT COUNT(*) FROM customers c2 WHERE c2.created_at < c.created_at OR (c2.created_at = c.created_at AND c2.id <= c.id))::int AS member_number
         FROM customers c
        WHERE c.id = $1`,
      [Number(customerId), founderCutoff],
    );
    if (!rows[0]) return null;
    return { founder: Boolean(rows[0].founder), memberNumber: Number(rows[0].member_number), cutoff: founderCutoff };
  } catch (err) {
    console.error(`[founder] customer #${customerId}: ${err.message}`);
    return null;
  }
}
