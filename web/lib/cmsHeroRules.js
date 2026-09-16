/**
 * The homepage hero image setting — pure rules shared by the CMS form, its
 * Server Action and the tests.
 *
 * A pasted URL must be an https image on a host `next.config.mjs` lets
 * next/image load (Supabase Storage public objects, or this site's own
 * /assets/img). Anything else would render as a broken hero on lukkaplace.com
 * rather than fail in the console, so it is refused here, where the admin can
 * still see why. Uploads go to the same Storage bucket and always pass.
 */

export const HERO_SETTING_KEY = 'home.hero';
export const HERO_ALT_MAX = 160;
export const HERO_CREDIT_MAX = 200;
export const HERO_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const HERO_UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const ALLOWED_IMAGE_HOSTS = [
  { hostname: 'havyrzfdksabghgbrxfy.supabase.co', pathPrefix: '/storage/v1/object/public/' },
  { hostname: 'lukkaplace.com', pathPrefix: '/assets/img/' },
];

/** @returns {string|null} the URL, normalised, when next/image can load it */
export function allowedHeroUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const allowed = ALLOWED_IMAGE_HOSTS.some((host) => url.hostname === host.hostname && url.pathname.startsWith(host.pathPrefix));
  return allowed ? url.toString() : null;
}

/**
 * @returns {{errorKey: string} | {values: {alt: string|null, credit: string|null}}}
 */
export function validateHeroText({ alt, credit }) {
  const cleanAlt = String(alt ?? '').trim().replace(/\s+/g, ' ');
  const cleanCredit = String(credit ?? '').trim().replace(/\s+/g, ' ');
  if (cleanAlt.length > HERO_ALT_MAX) return { errorKey: 'admin.cms.hero.altTooLong' };
  if (cleanCredit.length > HERO_CREDIT_MAX) return { errorKey: 'admin.cms.hero.creditTooLong' };
  return { values: { alt: cleanAlt || null, credit: cleanCredit || null } };
}

/** A stored value read back defensively: anything malformed means "use the built-in photo". */
export function heroFromStored(value) {
  if (!value || typeof value !== 'object') return null;
  const imageUrl = allowedHeroUrl(value.imageUrl);
  if (!imageUrl) return null;
  return {
    imageUrl,
    alt: typeof value.alt === 'string' ? value.alt.slice(0, HERO_ALT_MAX) : null,
    credit: typeof value.credit === 'string' ? value.credit.slice(0, HERO_CREDIT_MAX) : null,
  };
}
