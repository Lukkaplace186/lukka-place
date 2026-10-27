/**
 * The launch-campaign settings (/admin/settings, "Croissance") — pure, so the
 * form, the storage and the tests read one definition. One `cms_settings` row,
 * `site.growth`:
 *
 *   metaPixelId     Meta (Facebook / Instagram) Pixel id — 15 or 16 digits
 *   tiktokPixelId   TikTok Pixel id — 20 letters and digits (C… / D…)
 *   founderCutoff   "Membre fondateur" for accounts created BEFORE this day
 *
 * Pixel ids are public by nature (they ship in every page). The ACCESS TOKENS
 * for the server events are secrets and live only in the server environment
 * (META_CAPI_TOKEN, TIKTOK_EVENTS_TOKEN) — never here, never in a form.
 * Each id falls back to META_PIXEL_ID / TIKTOK_PIXEL_ID when the row has none;
 * nothing loads while both are empty.
 */

export const GROWTH_SETTING_KEY = 'site.growth';
export const DEFAULT_FOUNDER_CUTOFF = '2026-12-21';

const META_ID_RE = /^\d{10,20}$/;
const TIKTOK_ID_RE = /^[A-Z0-9]{10,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanMetaPixelId(value) {
  const text = String(value ?? '').trim();
  return META_ID_RE.test(text) ? text : null;
}

export function cleanTiktokPixelId(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return TIKTOK_ID_RE.test(text) ? text : null;
}

export function cleanDate(value) {
  const text = String(value ?? '').trim();
  if (!DATE_RE.test(text)) return null;
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? text : null;
}

/**
 * A stored row (re-validated on read) merged with the environment fallbacks.
 * @returns {{metaPixelId: string|null, tiktokPixelId: string|null, founderCutoff: string}}
 */
export function growthSettingsFromStored(stored, env = {}) {
  const value = stored && typeof stored === 'object' ? stored : {};
  return {
    metaPixelId: cleanMetaPixelId(value.metaPixelId) || cleanMetaPixelId(env.META_PIXEL_ID),
    tiktokPixelId: cleanTiktokPixelId(value.tiktokPixelId) || cleanTiktokPixelId(env.TIKTOK_PIXEL_ID),
    founderCutoff: cleanDate(value.founderCutoff) || DEFAULT_FOUNDER_CUTOFF,
  };
}

/**
 * The form, checked. An empty pixel field is "none" (the env fallback then
 * applies); a non-empty one that is not an id refuses the whole save.
 * @returns {{ok: true, value: object}|{ok: false, error: 'meta'|'tiktok'|'cutoff'}}
 */
export function parseGrowthForm(fields) {
  const meta = String(fields?.metaPixelId ?? '').trim();
  const tiktok = String(fields?.tiktokPixelId ?? '').trim();
  const cutoff = String(fields?.founderCutoff ?? '').trim();
  if (meta && !cleanMetaPixelId(meta)) return { ok: false, error: 'meta' };
  if (tiktok && !cleanTiktokPixelId(tiktok)) return { ok: false, error: 'tiktok' };
  if (cutoff && !cleanDate(cutoff)) return { ok: false, error: 'cutoff' };
  return {
    ok: true,
    value: {
      metaPixelId: meta || null,
      tiktokPixelId: tiktok ? tiktok.toUpperCase() : null,
      founderCutoff: cutoff || DEFAULT_FOUNDER_CUTOFF,
    },
  };
}
