import { SITE_URL } from './constants';

/**
 * The places Lukka Place posts its listings by hand (2026-11-06): its own
 * Facebook page and Instagram, and the Kinshasa property groups on Facebook
 * the team joined. Pure and client-safe: the admin share dialog (TeamSocialPostPanel)
 * and the server (lib/teamSocialPosts.js, app/admin/listings/shareActions.js)
 * share it, so the link shown in the caption and the link Facebook is asked
 * to read are the same string.
 *
 * The groups are the ones the owner listed and the team ranked by activity
 * (members and posts a day read from each group's About page on 2026-11-06),
 * busiest first. A place not on the list is typed in the dialog ("Autre"),
 * and gets a slug of its own.
 *
 * A target's `key` is also the `utm_campaign` of the listing link posted
 * there, so lib/attribution.js can say which group a visit came from.
 */

/** Same value as lib/listingShareCopy.js TEAM_SOCIAL_SOURCE (a test compares them). */
export const TEAM_SOCIAL_UTM_SOURCE = 'lukka_reseaux';

export const TEAM_SOCIAL_TARGETS = Object.freeze([
  { key: 'page-facebook', label: 'Page Facebook Lukka Place', kind: 'page' },
  { key: 'instagram', label: 'Instagram Lukka Place', kind: 'page' },
  { key: 'maison-a-louer-limete', label: 'Maison À Louer Limete très sérieux', kind: 'group', url: 'https://www.facebook.com/groups/3205978419697983/' },
  { key: 'immobilier-tout-kin', label: 'Immobilier tout kin', kind: 'group', url: 'https://www.facebook.com/groups/1001188207331031/' },
  { key: 'immobilier-ndaku', label: 'Immobilier Ndaku', kind: 'group', url: 'https://www.facebook.com/groups/546690079848134/' },
  { key: 'kinshasa-logement', label: 'Kinshasa Logement', kind: 'group', url: 'https://www.facebook.com/groups/489940491938110/' },
  { key: 'agence-mbote', label: 'Agence Immobilière Mbote', kind: 'group', url: 'https://www.facebook.com/groups/993865931260284/' },
  { key: 'immobilier-de-kinshasa', label: 'Immobilier de Kinshasa', kind: 'group', url: 'https://www.facebook.com/groups/562851315940856/' },
  { key: 'immobilier', label: 'Immobilier', kind: 'group', url: 'https://www.facebook.com/groups/609647317380455/' },
  { key: 'kintoko', label: 'Agence Immobilière Kintoko', kind: 'group', url: 'https://www.facebook.com/groups/958122708619221/' },
  { key: 'immobilier-tout-kinshasa-parcelle', label: 'Immobilier tout Kinshasa (vente de parcelle)', kind: 'group', url: 'https://www.facebook.com/groups/1188113662268861/' },
  { key: 'immo-tout-kin-market', label: 'IMMO TOUT KIN MARKET', kind: 'group', url: 'https://www.facebook.com/groups/848211857077591/' },
  { key: 'ndakuwazi', label: 'NDAKUWAZI.IMMO', kind: 'group', url: 'https://www.facebook.com/groups/510100900020884/' },
  { key: 'kinshasa-cop-nde-cop-immo', label: 'Kinshasa cop nde cop immo', kind: 'group', url: 'https://www.facebook.com/groups/587551528805820/' },
  { key: 'immo-tout-kin-ak', label: 'Immo Tout Kin AK', kind: 'group', url: 'https://www.facebook.com/groups/966584351157388/' },
  { key: 'immobilier-agree-kinshasa', label: 'Immobilier agréé à Kinshasa', kind: 'group', url: 'https://www.facebook.com/groups/339727388399173/' },
  { key: 'immobilier-kinshasa-vente', label: 'IMMOBILIER KINSHASA (vente des maisons et matériaux)', kind: 'group', url: 'https://www.facebook.com/groups/534164651371673/' },
]);

export const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const TARGET_LABEL_MAX = 120;

/** "Kin Apartéments (Gombe)" → "kin-apartements-gombe". Null when nothing usable is left. */
export function targetSlug(label) {
  const slug = String(label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return TARGET_KEY_PATTERN.test(slug) ? slug : null;
}

/**
 * A target from what the dialog sends: a listed key, or a typed name for a
 * place not on the list. Null when neither is usable. The label is never
 * taken from the browser for a listed key.
 */
export function resolveTeamSocialTarget({ key = null, label = null } = {}) {
  const listed = TEAM_SOCIAL_TARGETS.find((target) => target.key === key);
  if (listed) return listed;
  const name = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, TARGET_LABEL_MAX);
  const slug = targetSlug(name);
  if (!name || !slug) return null;
  // A typed name that is a listed place lands on that place's key.
  const sameName = TEAM_SOCIAL_TARGETS.find((target) => target.key === slug || targetSlug(target.label) === slug);
  return sameName || { key: slug, label: name, kind: 'other' };
}

/**
 * The listing link posted in one place: the team's utm_source, `groupe` or
 * `page` as the medium, the place's key as the campaign. Same parameter order
 * as lib/listingShareCopy.js listingPublicUrl, which a test compares.
 */
export function teamSocialUrl(listingId, target) {
  const id = Number(listingId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const base = `${SITE_URL}/listings/${id}?utm_source=${TEAM_SOCIAL_UTM_SOURCE}`;
  if (!target?.key) return base;
  const medium = target.kind === 'page' ? 'page' : 'groupe';
  return `${base}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(target.key)}`;
}

/**
 * The team's feed caption with its link swapped for the place's own link.
 * `kitUrl` is the kit's `socialUrl`, the only link the caption carries.
 */
export function captionForTarget(caption, kitUrl, listingId, target) {
  const url = teamSocialUrl(listingId, target);
  if (!caption || !kitUrl || !url || !caption.includes(kitUrl)) return caption;
  return caption.split(kitUrl).join(url);
}
