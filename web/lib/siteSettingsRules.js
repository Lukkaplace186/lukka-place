/**
 * Pure rules for the console's /admin/settings page: the footer's social
 * links and the feature flags that hide unfinished sections. Stored as two
 * `cms_settings` rows (lib/siteSettings.js); kept free of server imports so
 * the forms and tests/unit/site-settings.test.js share one definition.
 */

export const SOCIAL_SETTING_KEY = 'site.social_links';
export const FEATURES_SETTING_KEY = 'site.features';

/**
 * Each network accepts its own hosts only, so a pasted link to the wrong
 * place (or to a lookalike domain) is refused rather than published in the
 * footer of every page.
 */
export const SOCIAL_NETWORKS = [
  { key: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { key: 'instagram', label: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { key: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { key: 'whatsapp', label: 'WhatsApp Business', hosts: ['wa.me', 'whatsapp.com'] },
];

const MAX_URL_LENGTH = 300;

function hostAllowed(hostname, hosts) {
  const host = hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * One network's URL: '' clears it; otherwise https, on that network's own
 * host, with a path (a bare "https://facebook.com" is not a page of ours).
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
export function validateSocialUrl(networkKey, raw) {
  const network = SOCIAL_NETWORKS.find((n) => n.key === networkKey);
  if (!network) return { ok: false, error: 'unknown' };
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > MAX_URL_LENGTH) return { ok: false, error: 'too_long' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'https' };
  if (url.username || url.password) return { ok: false, error: 'invalid' };
  if (!hostAllowed(url.hostname, network.hosts)) return { ok: false, error: 'host' };
  if (url.pathname.replace(/\/+$/, '') === '') return { ok: false, error: 'path' };
  return { ok: true, value: url.toString() };
}

/** A stored value back into a clean {network: url} map — anything invalid is dropped, never shown. */
export function socialLinksFromStored(stored) {
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const { key } of SOCIAL_NETWORKS) {
    const check = validateSocialUrl(key, stored[key]);
    if (check.ok && check.value) out[key] = check.value;
  }
  return out;
}

/**
 * What the footer shows: the console's value wins, the NEXT_PUBLIC_* env
 * value (lib/seoSchema.js socialProfiles) fills a network the console has
 * not set. WhatsApp has no env twin here — the footer falls back to the
 * central number's wa.me link on its own.
 */
export function mergeSocialLinks(fromSettings, fromEnv) {
  return { ...(fromEnv || {}), ...(fromSettings || {}) };
}

/**
 * What can be hidden while it is being built (/admin/settings, "Onglets et
 * sections"). Each default is the state production had before the switch
 * existed, except the agent's Abonnements tab, hidden until FlexPaie is live.
 * `agentSubscriptions` keeps its name: the engine reads it too
 * (services/listingQuota.js).
 *
 *   agentSubscriptions  agent portal: Abonnements tab + /compte/agent/abonnement
 *   publicProjects      public site: "Neuf" in the header, footer links, the
 *                       home strip, the map's projects pill, the sitemap,
 *                       /projets and /promoteurs
 *   agentProjects       agent portal: the projects card + /compte/agent/projets
 *   publicBlog          public site: Guides & Actualités — the posts written
 *                       on /admin/blog, the menu link, the posts in the
 *                       sitemap. Off: /guides shows only the code guides
 *                       (lib/guides.js), as it did before the blog existed.
 */
export const FEATURE_FLAGS = [
  { key: 'agentSubscriptions', surface: 'agent', default: false },
  { key: 'agentProjects', surface: 'agent', default: true },
  { key: 'publicProjects', surface: 'public', default: true },
  { key: 'publicBlog', surface: 'public', default: false },
];

/** Never hideable: hiding the page that un-hides things would lock the team out. */
export const UNHIDEABLE_ADMIN_TABS = ['/admin/settings'];

/**
 * @param {object|null} stored the `site.features` value
 * @param {string[]} [knownAdminTabs] hrefs the console sidebar has; a stored
 *   href that is not one of them (a renamed page) is dropped.
 * @returns {{agentSubscriptions: boolean, agentProjects: boolean, publicProjects: boolean, publicBlog: boolean, hiddenAdminTabs: string[]}}
 */
export function featuresFromStored(stored, knownAdminTabs = null) {
  const value = stored && typeof stored === 'object' ? stored : {};
  const out = {};
  for (const flag of FEATURE_FLAGS) {
    out[flag.key] = typeof value[flag.key] === 'boolean' ? value[flag.key] : flag.default;
  }
  const hidden = Array.isArray(value.hiddenAdminTabs) ? value.hiddenAdminTabs : [];
  out.hiddenAdminTabs = [...new Set(hidden.filter((href) => typeof href === 'string'
    && href.startsWith('/admin/')
    && !UNHIDEABLE_ADMIN_TABS.includes(href)
    && (!knownAdminTabs || knownAdminTabs.includes(href))))];
  return out;
}

// ---------------------------------------------------------------------------
// "Optimisation SEO & Meta" (/admin/cms): the site's default title, meta
// description and Open Graph image, read by app/layout.js's generateMetadata.
// Each text exists per language; an empty one keeps the dictionary's
// site.metaTitle / site.metaDescription, so nothing changes until someone
// types a value. A page's own metadata (listings, landing pages, guides…)
// still wins over all three — these are the defaults underneath.
// ---------------------------------------------------------------------------

export const SEO_SETTING_KEY = 'site.seo';
export const SEO_LANGUAGES = ['fr', 'en'];
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;
export const SEO_IMAGE_URL_MAX = 500;

function cleanText(raw) {
  // One line: a <title> or a meta description never carries line breaks.
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The Open Graph image: '' clears it; a site path ("/og-image.png", resolved
 * against metadataBase) or an absolute https URL without credentials.
 * Any host is accepted — crawlers fetch it, not next/image.
 * @returns {{ok: true, value: string} | {ok: false, error: 'invalid'|'https'|'too_long'}}
 */
export function validateSeoImageUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: '' };
  if (value.length > SEO_IMAGE_URL_MAX) return { ok: false, error: 'too_long' };
  if (/\s/.test(value)) return { ok: false, error: 'invalid' };
  if (value.startsWith('/') && !value.startsWith('//')) return { ok: true, value };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'https' };
  if (url.username || url.password || !url.hostname) return { ok: false, error: 'invalid' };
  return { ok: true, value: url.toString() };
}

/**
 * The form's fields (`title_fr`, `title_en`, `description_fr`,
 * `description_en`, `og_image_url`) into the stored shape. One bad field
 * refuses the whole save and names it.
 * @param {{get(name: string): unknown}} form a FormData, or anything with get()
 * @returns {{ok: true, value: {title: {fr: string, en: string}, description: {fr: string, en: string}, ogImageUrl: string}}
 *   | {ok: false, field: string, error: string}}
 */
export function validateSeoInput(form) {
  const value = { title: {}, description: {}, ogImageUrl: '' };
  for (const lang of SEO_LANGUAGES) {
    const title = cleanText(form.get(`title_${lang}`));
    if (title.length > SEO_TITLE_MAX) return { ok: false, field: `title_${lang}`, error: 'title_too_long' };
    value.title[lang] = title;
    const description = cleanText(form.get(`description_${lang}`));
    if (description.length > SEO_DESCRIPTION_MAX) return { ok: false, field: `description_${lang}`, error: 'description_too_long' };
    value.description[lang] = description;
  }
  const image = validateSeoImageUrl(form.get('og_image_url'));
  if (!image.ok) return { ok: false, field: 'og_image_url', error: `image_${image.error}` };
  value.ogImageUrl = image.value;
  return { ok: true, value };
}

/** A stored `site.seo` value back into the same clean shape — anything invalid reads as empty. */
export function seoFromStored(stored) {
  const value = stored && typeof stored === 'object' ? stored : {};
  const pick = (group, lang, max) => {
    const raw = value[group]?.[lang];
    if (typeof raw !== 'string') return '';
    const text = cleanText(raw);
    return text.length <= max ? text : '';
  };
  const out = { title: {}, description: {}, ogImageUrl: '' };
  for (const lang of SEO_LANGUAGES) {
    out.title[lang] = pick('title', lang, SEO_TITLE_MAX);
    out.description[lang] = pick('description', lang, SEO_DESCRIPTION_MAX);
  }
  const image = validateSeoImageUrl(value.ogImageUrl);
  out.ogImageUrl = image.ok ? image.value : '';
  return out;
}

/**
 * What the root metadata uses for one reader's language: the console's text
 * when set, else the dictionary's. `image` is null when no image was set, so
 * the layout keeps its own 1200×630 card (and its known dimensions).
 * @param {ReturnType<typeof seoFromStored>|null} seo
 * @param {'fr'|'en'} locale
 * @param {{title: string, description: string}} defaults
 */
export function seoMetadata(seo, locale, defaults) {
  const lang = SEO_LANGUAGES.includes(locale) ? locale : 'fr';
  return {
    title: seo?.title?.[lang] || defaults.title,
    description: seo?.description?.[lang] || defaults.description,
    image: seo?.ogImageUrl || null,
  };
}
