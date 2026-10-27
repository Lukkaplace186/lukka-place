import 'server-only';
import { getPool } from './db';

/**
 * advertisements — a real Laravel-schema table, shown on /admin/cms as-is
 * (lib/cmsAdRules.js says what a row can and cannot tell us).
 *
 * The `sliders` reader and writer that used to live here are gone
 * (2026-10-27): those rows held only the old Laravel storefront's hero
 * taglines ("Search Congo's Largest Choice Homes", "Anywhere and Everywhere
 * in Congo" and their French twins), and lukkaplace.com never rendered them —
 * the homepage headline is home.hero.title in the dictionary. Removing the
 * rows themselves is the engine's scripts/remove-legacy-slider-copy.js, dry
 * run by default.
 */

export async function getAdvertisements() {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, ad_type, resolution_type, image, url, slot, views FROM advertisements ORDER BY id',
  );
  return rows;
}

export async function updateAdvertisement(id, { url }) {
  const pool = getPool();
  await pool.query('UPDATE advertisements SET url = $1, updated_at = NOW() WHERE id = $2', [url, id]);
}
