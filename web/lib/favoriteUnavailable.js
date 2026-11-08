import 'server-only';
import { getPool } from './db';
import { COMMUNE_SUBQUERY } from './listings';

/**
 * The customer's own saved homes that are no longer online (2026-11-08,
 * owner request): "3 biens enregistrés ne sont plus en ligne" was a dead end,
 * with no way to see which ones or to find something like them.
 *
 * Only the customer's own favourites, and only what they saw when they saved
 * it: title, type of deal, rooms, commune, and whether it was let/sold or
 * withdrawn. No price, photo, agent or address — a withdrawn listing may have
 * been taken down for a reason, and this is not a way back into it. A
 * listing deleted outright has no row; it is counted, not described.
 */

const PURPOSE_TO_TRANSACTION = { rent: 'location', sale: 'vente' };

/** /listings link to homes like it: same deal, commune and rooms (pure, exported for the tests). */
export function similarHomesHref(row) {
  const params = new URLSearchParams();
  const transaction = PURPOSE_TO_TRANSACTION[row.purpose];
  if (transaction) params.set('transaction_type', transaction);
  if (row.commune) params.set('commune', row.commune);
  const beds = Number(row.beds);
  if (Number.isFinite(beds) && beds > 0) params.set('beds_min', String(beds));
  const query = params.toString();
  return query ? `/listings?${query}` : '/listings';
}

/**
 * @param {Array<string|number>} favoriteIds every id the customer saved
 * @param {Set<string>} onlineIds the ids the public read returned
 * @returns {Promise<{items: Array<{id: number, title: string, reason: 'closed'|'withdrawn', similarHref: string}>, deletedIds: number[]}>}
 */
export async function getUnavailableFavorites(favoriteIds, onlineIds) {
  const missing = (favoriteIds || [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && !onlineIds.has(String(id)));
  if (missing.length === 0) return { items: [], deletedIds: [] };

  const { rows } = await getPool().query(
    `SELECT p.id, pc.title, p.purpose, p.beds, ${COMMUNE_SUBQUERY},
            (p.listing_status = 'closed' OR (to_jsonb(p) ->> 'sold_at') IS NOT NULL) AS closed
       FROM properties p
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE p.id = ANY($1)
        AND NOT (p.status = 1 AND p.approve_status = 1)`,
    [missing],
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  const items = missing
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      id: Number(row.id),
      title: row.title || null,
      reason: row.closed ? 'closed' : 'withdrawn',
      similarHref: similarHomesHref(row),
    }));
  return { items, deletedIds: missing.filter((id) => !byId.has(id)) };
}
