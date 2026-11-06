import 'server-only';
import { getPool } from './db';

/**
 * Where Lukka Place posted each listing (team_social_posts,
 * migrations/20261106_team_social_posts.sql). Written from the team's
 * "Carte réseaux sociaux" dialog when someone presses "Marquer comme publié",
 * read by /admin/listings ("Publié sur" column, "Réseaux sociaux" filter).
 *
 * A row is what a team member SAID they did, never proof the post is up: a
 * group whose admins approve posts may still decline it.
 *
 * Works before the migration: `hasTeamSocialPosts()` gates every read (a
 * missing table would fail the whole moderation queue otherwise), reads then
 * return null ("not known"), and a write answers `{ ok: false, reason: 'not_ready' }`.
 */

/** A second mark of the same listing in the same place inside this window is refused as a double tap. */
export const DUPLICATE_WINDOW_HOURS = 24;

let tableCheck = { at: 0, value: null };

export async function hasTeamSocialPosts() {
  if (tableCheck.value === true) return true;
  if (tableCheck.value === false && Date.now() - tableCheck.at < 10 * 60 * 1000) return false;
  try {
    const { rows } = await getPool().query("SELECT to_regclass('public.team_social_posts') IS NOT NULL AS ok");
    tableCheck = { at: Date.now(), value: Boolean(rows[0]?.ok) };
  } catch {
    tableCheck = { at: Date.now(), value: false };
  }
  return tableCheck.value;
}

/** Test hook: forget the cached table check. */
export function resetTeamSocialPostsCache() {
  tableCheck = { at: 0, value: null };
}

function toPost(row) {
  return {
    id: Number(row.id),
    propertyId: Number(row.property_id),
    targetKey: row.target_key,
    targetLabel: row.target_label,
    postedAt: new Date(row.posted_at).toISOString(),
    postedBy: row.posted_by_label || null,
  };
}

/**
 * Records one post. Only a PUBLIC listing can be marked (the link in the post
 * leads to its public page), and the same place twice within
 * DUPLICATE_WINDOW_HOURS answers `duplicate` with the earlier post instead of
 * a second row.
 *
 * @param {{propertyId: number, target: {key: string, label: string}, session: object|null}} input
 * @returns {Promise<{ok: true, post: object}|{ok: false, reason: 'not_ready'|'not_public'|'duplicate', post?: object}>}
 */
export async function recordTeamSocialPost({ propertyId, target, session }) {
  if (!(await hasTeamSocialPosts())) return { ok: false, reason: 'not_ready' };
  const id = Number(propertyId);
  const by = session && !session.shared ? session.id ?? null : null;
  const byLabel = session ? (session.shared ? null : session.name || null) : null;
  const { rows: earlier } = await getPool().query(
    `SELECT id, property_id, target_key, target_label, posted_at, posted_by_label
       FROM team_social_posts
      WHERE property_id = $1 AND target_key = $2 AND posted_at > NOW() - make_interval(hours => $3)
      ORDER BY posted_at DESC LIMIT 1`,
    [id, target.key, DUPLICATE_WINDOW_HOURS],
  );
  if (earlier[0]) return { ok: false, reason: 'duplicate', post: toPost(earlier[0]) };
  const { rows } = await getPool().query(
    `INSERT INTO team_social_posts (property_id, target_key, target_label, posted_by, posted_by_label)
     SELECT p.id, $2, $3, $4, $5
       FROM properties p
      WHERE p.id = $1 AND p.status = 1 AND p.approve_status = 1
     RETURNING id, property_id, target_key, target_label, posted_at, posted_by_label`,
    [id, target.key, target.label, by, byLabel],
  );
  if (!rows[0]) return { ok: false, reason: 'not_public' };
  return { ok: true, post: toPost(rows[0]) };
}

/**
 * Every post of these listings, newest first, as `Map<propertyId, post[]>`.
 * Null when the table is not there yet (the page then says it does not know).
 */
export async function getTeamSocialPostsByListing(propertyIds) {
  const ids = [...new Set((propertyIds || []).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!(await hasTeamSocialPosts())) return null;
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const { rows } = await getPool().query(
    `SELECT id, property_id, target_key, target_label, posted_at, posted_by_label
       FROM team_social_posts
      WHERE property_id = ANY($1::int[])
      ORDER BY posted_at DESC`,
    [ids],
  );
  for (const row of rows) map.get(Number(row.property_id))?.push(toPost(row));
  return map;
}

/** The moderation queue's "Réseaux sociaux" filter, as SQL on the queue's `p`. */
export const SOCIAL_FILTER_SQL = {
  unposted: 'NOT EXISTS (SELECT 1 FROM team_social_posts tsp WHERE tsp.property_id = p.id)',
  posted: 'EXISTS (SELECT 1 FROM team_social_posts tsp WHERE tsp.property_id = p.id)',
};
export const SOCIAL_FILTERS = Object.keys(SOCIAL_FILTER_SQL);
