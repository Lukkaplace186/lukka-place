import 'server-only';
import { getPool } from './db';

/**
 * sliders/advertisements — real Laravel-schema tables, confirmed to hold a
 * genuine mix of real content (sliders' French rows, actively edited into
 * 2026) and untouched placeholder rows (advertisements' example.com URLs).
 * Every row is shown as-is, including the placeholder ones — curating them
 * out would itself be a form of misrepresenting what's actually there.
 */

const LANGUAGE_LABELS = { 20: 'EN', 26: 'FR' };

export function languageLabel(languageId) {
  return LANGUAGE_LABELS[languageId] || `#${languageId}`;
}

export async function getSliders() {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, language_id, background_image, title, text FROM sliders ORDER BY language_id, id',
  );
  return rows;
}

export async function updateSlider(id, { title, text }) {
  const pool = getPool();
  await pool.query('UPDATE sliders SET title = $1, text = $2, updated_at = NOW() WHERE id = $3', [
    title,
    text,
    id,
  ]);
}

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
