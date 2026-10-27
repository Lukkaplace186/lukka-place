import 'server-only';
import { getPool } from './db';
import { forget, memo } from './memo';
import { ADMIN_NAV_HREFS } from './adminNav';
import {
  FEATURES_SETTING_KEY,
  SOCIAL_SETTING_KEY,
  featuresFromStored,
  socialLinksFromStored,
} from './siteSettingsRules';
import { GROWTH_SETTING_KEY, growthSettingsFromStored } from './growthSettingsRules';

/**
 * Social links and feature flags, two `cms_settings` rows edited from
 * /admin/settings. The footer reads the links on every public page, so both
 * are memoised for 30 s and dropped the moment the console saves.
 *
 * Never throws: a missing table or a bad row falls back to the defaults
 * (no console links, every flag at its default) rather than taking the
 * storefront down.
 */
const TTL_MS = 30_000;
const MEMO_PREFIX = 'site-settings:';

async function readValue(key) {
  const { rows } = await getPool().query('SELECT value, updated_at, updated_by FROM cms_settings WHERE key = $1', [key]);
  return rows[0] || null;
}

/** @returns {Promise<Record<string, string>>} */
export async function getSocialLinks() {
  try {
    return await memo(`${MEMO_PREFIX}social`, TTL_MS, async () => socialLinksFromStored((await readValue(SOCIAL_SETTING_KEY))?.value));
  } catch (err) {
    console.error(`[site-settings] social links unavailable: ${err.message}`);
    return {};
  }
}

/** @returns {Promise<{agentSubscriptions: boolean, agentProjects: boolean, publicProjects: boolean, hiddenAdminTabs: string[]}>} */
export async function getFeatureFlags() {
  try {
    return await memo(`${MEMO_PREFIX}features`, TTL_MS, async () => featuresFromStored((await readValue(FEATURES_SETTING_KEY))?.value, ADMIN_NAV_HREFS));
  } catch (err) {
    console.error(`[site-settings] feature flags unavailable, using defaults: ${err.message}`);
    return featuresFromStored(null, ADMIN_NAV_HREFS);
  }
}

/** For the console: both rows with who changed them and when. Throws, so the page can say so. */
export async function getSiteSettingsForAdmin() {
  const [social, features] = await Promise.all([readValue(SOCIAL_SETTING_KEY), readValue(FEATURES_SETTING_KEY)]);
  return {
    social: socialLinksFromStored(social?.value),
    socialUpdatedAt: social?.updated_at || null,
    socialUpdatedBy: social?.updated_by || null,
    features: featuresFromStored(features?.value, ADMIN_NAV_HREFS),
    featuresUpdatedAt: features?.updated_at || null,
    featuresUpdatedBy: features?.updated_by || null,
  };
}

async function save(key, value, updatedBy) {
  await getPool().query(
    `INSERT INTO cms_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), updatedBy],
  );
  forget(MEMO_PREFIX);
}

export const saveSocialLinks = (links, updatedBy) => save(SOCIAL_SETTING_KEY, links, updatedBy);
export const saveFeatureFlags = (flags, updatedBy) => save(FEATURES_SETTING_KEY, flags, updatedBy);

// ---------------------------------------------------------------------------
// Launch campaign: pixel ids and the founder cutoff (lib/growthSettingsRules.js)
// ---------------------------------------------------------------------------

/** @returns {Promise<{metaPixelId: string|null, tiktokPixelId: string|null, founderCutoff: string}>} */
export async function getGrowthSettings() {
  try {
    return await memo(`${MEMO_PREFIX}growth`, TTL_MS, async () => growthSettingsFromStored((await readValue(GROWTH_SETTING_KEY))?.value, process.env));
  } catch (err) {
    console.error(`[site-settings] growth settings unavailable: ${err.message}`);
    return growthSettingsFromStored(null, process.env);
  }
}

/** The stored row only (no env fallback) plus who changed it — for the console form. */
export async function getGrowthSettingsForAdmin() {
  const row = await readValue(GROWTH_SETTING_KEY);
  return {
    stored: growthSettingsFromStored(row?.value, {}),
    effective: growthSettingsFromStored(row?.value, process.env),
    serverEvents: {
      meta: Boolean(process.env.META_CAPI_TOKEN),
      tiktok: Boolean(process.env.TIKTOK_EVENTS_TOKEN),
    },
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null,
  };
}

export const saveGrowthSettings = (value, updatedBy) => save(GROWTH_SETTING_KEY, value, updatedBy);
