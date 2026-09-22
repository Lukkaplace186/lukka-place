import 'server-only';
import { getPool } from './db';
import { LAT_EXPR, LNG_EXPR } from './listings';

/**
 * Where each of an agent's listings is, for the agenda's directions link and
 * the .ics LOCATION: stored coordinates (NULL on most rows today), the
 * address line, quartier, and the commune tag (not a column — resolved through
 * property_amenities, amenity ids 21–44, as lib/listings.js does).
 *
 * Scoped to `p.agent_id = $1`: the agent's OWN listings, the same scope as
 * getOwnListingsForDashboard, so no public-visibility filter applies — an
 * agent needs directions to a listing that is under offer or archived just as
 * much. A visit on a listing that is not theirs (reached through a lead
 * assigned to them by name) simply gets no place, never someone else's.
 *
 * @returns {Promise<Map<string, {lat: number|null, lng: number|null, address: string|null, quartier: string|null, commune: string|null, title: string|null}>>}
 *   keyed by String(id)
 */
export async function getListingPlaces(agentId, propertyIds) {
  const ids = [...new Set((propertyIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return new Map();
  const { rows } = await getPool().query(
    `SELECT p.id, ${LAT_EXPR} AS lat, ${LNG_EXPR} AS lng, pc.address, p.quartier, pc.title,
            (SELECT ac.name FROM property_amenities pa
               JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
              WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
              LIMIT 1) AS commune
       FROM properties p
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE p.agent_id = $1 AND p.id = ANY($2::bigint[])`,
    [agentId, ids],
  );
  return new Map(rows.map((r) => [String(r.id), {
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    address: r.address || null,
    quartier: r.quartier || null,
    commune: r.commune || null,
    title: r.title || null,
  }]));
}

/** The listing a viewing request is about — its own column, else its lead's. */
export function visitPropertyId(visit) {
  return visit?.property_id || visit?.lead_property_id || null;
}
