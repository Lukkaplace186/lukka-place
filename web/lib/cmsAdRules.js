import { allowedHeroUrl } from './cmsHeroRules';

/**
 * Pure rules for /admin/cms' "Bannières publicitaires" table — the Laravel
 * `advertisements` rows (lib/cms.js). Shared by the page, the save action and
 * tests/unit/admin-cms.test.js.
 *
 * WHAT A ROW CAN TELL US (checked against production 2026-10-27, 7 rows):
 * `ad_type` 'banner', `resolution_type` 1 / 2 / 3, `image` a bare Laravel
 * file name ("65bf7088a2c9f.png"), `url` empty, `slot` NULL. `slot` is an
 * AdSense slot id in the back-office's schema, not a page, and no column
 * names a page. The placement a row really carries is its FORMAT: the
 * back-office's ad form offers resolution 1 = 300 × 250, 2 = 300 × 600,
 * 3 = 728 × 90. The label says that format and where such a format goes in a
 * page layout; it never names a page ("Accueil - Hero") the data does not
 * hold — and lukkaplace.com renders none of these rows today.
 */
export const AD_FORMATS = {
  1: { key: 'box', width: 300, height: 250 },
  2: { key: 'sidebar', width: 300, height: 600 },
  3: { key: 'leaderboard', width: 728, height: 90 },
};

/**
 * @param {{ad_type?: string, resolution_type?: number|string}} ad
 * @returns {{labelKey: string, vars: object}} an i18n key under
 *   admin.cms.ads.format and its variables — "Bandeau horizontal · 728 × 90".
 */
export function adPlacement(ad) {
  const n = Number.parseInt(ad?.resolution_type, 10);
  const format = AD_FORMATS[n];
  if (!format) return { labelKey: 'admin.cms.ads.format.unknown', vars: { n: Number.isFinite(n) ? n : '—' } };
  return {
    labelKey: `admin.cms.ads.format.${format.key}`,
    vars: { size: `${format.width} × ${format.height}` },
  };
}

/**
 * The thumbnail for a row's `image`: only an absolute https URL on a host
 * next/image may load (the hero's allow-list). A bare Laravel file name has
 * no address this site can reach — the back-office's /assets/img/advertisements/
 * answers 404 — so it gets no picture, only its name, never a broken image.
 * @returns {{src: string|null, file: string|null}}
 */
export function adImage(image) {
  const value = typeof image === 'string' ? image.trim() : '';
  if (!value) return { src: null, file: null };
  const src = allowedHeroUrl(value);
  return { src, file: src ? null : value.split('/').pop() };
}

export const AD_URL_MAX = 500;

/**
 * The banner's click-through URL: '' clears it, otherwise http(s), no
 * credentials, at most AD_URL_MAX characters.
 * @returns {{ok: true, value: string} | {ok: false, error: 'invalid'|'too_long'}}
 */
export function validateAdUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > AD_URL_MAX) return { ok: false, error: 'too_long' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return { ok: false, error: 'invalid' };
  return { ok: true, value: url.toString() };
}
