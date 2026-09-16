import 'server-only';
import { getPool } from './db';
import { HERO_SETTING_KEY, heroFromStored } from './cmsHeroRules';

/**
 * `cms_settings` (migrations/20260921_cms_settings.sql): one JSON value per key,
 * edited from /admin/cms and read on each request, so a change is live on
 * lukkaplace.com without a deploy.
 */

/**
 * The homepage hero override, or null for the built-in photo. Never throws:
 * a missing table (before the migration) or a bad row must not take the
 * homepage down.
 * @returns {Promise<{imageUrl: string, alt: string|null, credit: string|null}|null>}
 */
export async function getHeroSettings() {
  try {
    const { rows } = await getPool().query('SELECT value FROM cms_settings WHERE key = $1', [HERO_SETTING_KEY]);
    return heroFromStored(rows[0]?.value);
  } catch (err) {
    console.error(`[cms] hero settings unavailable, using the built-in photo: ${err.message}`);
    return null;
  }
}

/** For the console: the raw row with who changed it and when. */
export async function getHeroSettingsRow() {
  const { rows } = await getPool().query(
    'SELECT value, updated_at, updated_by FROM cms_settings WHERE key = $1',
    [HERO_SETTING_KEY],
  );
  if (!rows[0]) return null;
  return { hero: heroFromStored(rows[0].value), updatedAt: rows[0].updated_at, updatedBy: rows[0].updated_by };
}

export async function saveHeroSettings({ imageUrl, alt, credit }, updatedBy) {
  await getPool().query(
    `INSERT INTO cms_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [HERO_SETTING_KEY, JSON.stringify({ imageUrl, alt, credit }), updatedBy],
  );
}

/** Back to the built-in photo. */
export async function clearHeroSettings() {
  await getPool().query('DELETE FROM cms_settings WHERE key = $1', [HERO_SETTING_KEY]);
}
