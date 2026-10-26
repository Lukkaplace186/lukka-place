import 'server-only';
import { getPool } from './db';
import { memo } from './memo';
import { ALL_CITIES, CITIES, DEFAULT_CITY, MIN_PUBLIC_CITY_LISTINGS, findCity, isAllCities } from './cities';

/**
 * Which cities the storefront shows: Kinshasa always, and any other city with
 * at least MIN_PUBLIC_CITY_LISTINGS live listings — 0 today (owner decision,
 * 2026-10-20), so every city is offered, empty ones included.
 * Counted under the public gate, cached 60 s (lib/memo.js); a failed count
 * shows Kinshasa alone rather than failing the page.
 *
 * @returns {Promise<Array<{name: string, slug: string, count: number}>>}
 */
export async function getPublicCities() {
  return memo('public-cities', 60_000, async () => {
    try {
      const { rows } = await getPool().query(
        `SELECT pcc.name, COUNT(DISTINCT p.id)::int AS count
           FROM properties p
           JOIN property_city_contents pcc ON pcc.city_id = p.city_id
          WHERE p.status = 1 AND p.approve_status = 1
          GROUP BY pcc.name`,
      );
      const counts = new Map();
      for (const row of rows) {
        const city = findCity(row.name);
        if (city) counts.set(city.name, Math.max(counts.get(city.name) || 0, row.count));
      }
      return CITIES
        .filter((c) => c.name === DEFAULT_CITY || (counts.get(c.name) || 0) >= MIN_PUBLIC_CITY_LISTINGS)
        .map((c) => ({ name: c.name, slug: c.slug, count: counts.get(c.name) || 0 }));
    } catch (err) {
      console.warn('[public-cities] count failed, Kinshasa only:', err.message);
      return [{ name: DEFAULT_CITY, slug: 'kinshasa', count: 0 }];
    }
  });
}

/**
 * `?ville=` only when it names a public city, or `toutes` (every city);
 * anything else is no city (= Kinshasa).
 */
export async function publicVille(ville) {
  if (isAllCities(ville)) return ALL_CITIES;
  const city = findCity(ville);
  if (!city || city.name === DEFAULT_CITY) return null;
  const visible = await getPublicCities();
  return visible.some((c) => c.name === city.name) ? city.name : null;
}
