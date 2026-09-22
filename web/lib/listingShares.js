import 'server-only';
import { getPool } from './db';
import { SHARE_AGENT_PER_MINUTE, SHARE_DEDUPE_SECONDS, STATUS_MAX, STATUS_RECENT_DAYS } from './listingShareRules';

/**
 * `listing_shares` (migrations/20260922_listing_shares.sql) — the SQL half.
 * lib/listingShareRules.js says what a share is and validates the input.
 *
 * Every read and write degrades when the table is not there yet (web can
 * deploy seconds before the migration runs): a write records nothing, a count
 * is `null` ("not known", which the report leaves out), and the suggestions
 * fall back to "never shared", which is the truth as far as we can tell.
 */

const MISSING = new Set(['42P01', '42703']);
export const isMissingShareTable = (err) => MISSING.has(err?.code);

/**
 * Records one share per listing id, for listings that are the agent's own AND
 * live — ownership and the public filter are in the INSERT, so a crafted
 * request can neither credit another agency's listing nor count shares of a
 * page that 404s.
 *
 * One tap = one record: the NOT EXISTS skips a row identical to one written in
 * the last SHARE_DEDUPE_SECONDS (a double tap, a retried request). Two truly
 * simultaneous requests for the same tap could both pass it; the browser
 * sends each tap once, so that window is accepted rather than paid for with a
 * lock on every share.
 *
 * @param {number} agentId  From the session, never from the browser.
 * @param {{ids: number[], channel: string, format: string}} record  normaliseShareRecord output.
 * @returns {Promise<number>} rows written
 */
export async function recordListingShares(agentId, { ids, channel, format }) {
  if (!Number.isSafeInteger(Number(agentId)) || !ids?.length) return 0;
  try {
    const { rowCount } = await getPool().query(
      `INSERT INTO listing_shares (property_id, agent_id, channel, format)
       SELECT p.id, $2, $3, $4
         FROM properties p
        WHERE p.id = ANY($1::bigint[])
          AND p.agent_id = $2
          AND p.status = 1 AND p.approve_status = 1
          AND NOT EXISTS (
            SELECT 1 FROM listing_shares s
             WHERE s.property_id = p.id AND s.agent_id = $2
               AND s.channel = $3 AND s.format IS NOT DISTINCT FROM $4
               AND s.created_at > NOW() - make_interval(secs => $5)
          )
          AND (
            SELECT count(*) FROM listing_shares f
             WHERE f.agent_id = $2 AND f.created_at > NOW() - interval '1 minute'
          ) < $6`,
      [ids.map(Number), Number(agentId), channel, format, SHARE_DEDUPE_SECONDS, SHARE_AGENT_PER_MINUTE],
    );
    return rowCount || 0;
  } catch (err) {
    if (isMissingShareTable(err)) return 0;
    throw err;
  }
}

/**
 * Shares of one listing in [from, until). `null` when unknown — the caller
 * must print nothing then, never 0.
 */
export async function getListingShareCount(listingId, { from, until }) {
  try {
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM listing_shares
        WHERE property_id = $1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,
      [Number(listingId), from.toISOString(), until.toISOString()],
    );
    return rows[0]?.n ?? 0;
  } catch (err) {
    if (!isMissingShareTable(err)) console.error(`[listing-shares] count for ${listingId}: ${err.message}`);
    return null;
  }
}

const SUGGESTION_FIELDS = `
  p.id, p.price, p.purpose, p.price_period, p.featured_image, p.created_at, p.quartier,
  pc.title,
  (
    SELECT ac.name FROM property_amenities pa
    JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
    WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
    LIMIT 1
  ) AS commune`;

// shareBlocker()'s "shareable": approved, public, and on the market. A NULL
// listing_status predates the column and is active.
const LIVE_OWN = `
  p.agent_id = $1 AND p.status = 1 AND p.approve_status = 1
  AND COALESCE(p.listing_status, 'active') NOT IN ('under_offer', 'closed')`;

/**
 * "Statut du jour": up to STATUS_MAX of the agent's live listings that have
 * not been shared in the last STATUS_RECENT_DAYS — never-shared first, then
 * the least recently shared, newest listing first within each.
 *
 * @returns {Promise<{items: Array<object>, tracked: boolean}>}  `tracked` is
 *   false when listing_shares does not exist yet, so the card can say that
 *   "not shared recently" is not known rather than claim it.
 */
export async function getStatusSuggestions(agentId, { limit = STATUS_MAX, recentDays = STATUS_RECENT_DAYS } = {}) {
  if (!Number.isSafeInteger(Number(agentId))) return { items: [], tracked: false };
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT ${SUGGESTION_FIELDS}, ls.last_shared_at
         FROM properties p
         JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
         LEFT JOIN LATERAL (
           SELECT max(s.created_at) AS last_shared_at FROM listing_shares s WHERE s.property_id = p.id
         ) ls ON true
        WHERE ${LIVE_OWN}
          AND (ls.last_shared_at IS NULL OR ls.last_shared_at < NOW() - make_interval(days => $2))
        ORDER BY ls.last_shared_at ASC NULLS FIRST, p.created_at DESC, p.id DESC
        LIMIT $3`,
      [Number(agentId), recentDays, limit],
    );
    return { items: rows, tracked: true };
  } catch (err) {
    if (!isMissingShareTable(err)) throw err;
  }
  const { rows } = await pool.query(
    `SELECT ${SUGGESTION_FIELDS}, NULL::timestamptz AS last_shared_at
       FROM properties p
       JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE ${LIVE_OWN}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [Number(agentId), limit],
  );
  return { items: rows, tracked: false };
}

/** A suggestion row as plain JSON for the client card (bigint ids and Dates do not cross as-is). */
export function serialiseSuggestion(row) {
  return {
    id: Number(row.id),
    title: row.title || null,
    price: row.price == null ? null : Number(row.price),
    purpose: row.purpose || null,
    price_period: row.price_period || null,
    featured_image: row.featured_image || null,
    commune: row.commune || null,
    quartier: row.quartier || null,
    lastSharedAt: row.last_shared_at ? new Date(row.last_shared_at).toISOString() : null,
  };
}
