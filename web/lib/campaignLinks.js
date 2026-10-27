import { normaliseReferralCode } from './launchCommission';
import { safeDestination } from './partnerRules';

/**
 * The team's tagged links (/admin/liens, growth plan item 4). Pure: the page
 * builds the link and its QR code on the server, the tests read the same
 * rules.
 *
 * ONE VOCABULARY. A source is picked from a list rather than typed, so one
 * campaign is never split across "Facebook", "facebook" and "fb" in the
 * dashboard. Campaign and content are free but folded to one shape
 * (lowercase, no accents, words joined by `_`), the same shape
 * lib/attribution.js stores.
 */

export const CAMPAIGN_SOURCES = [
  'facebook', 'instagram', 'tiktok', 'whatsapp', 'youtube', 'google',
  'influencer', 'agent', 'radio', 'tv', 'flyer', 'affiche', 'sms', 'email', 'evenement',
];

export const CAMPAIGN_MEDIUMS = ['paid', 'organic', 'bio', 'story', 'post', 'video', 'qr', 'message', 'partner'];

export const DEFAULT_CAMPAIGN = 'lancement_dec';

/** "Lancement Décembre!" → "lancement_decembre"; null when nothing is left. */
export function normaliseTag(value, max = 60) {
  const text = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, max);
  return text || null;
}

/**
 * Where the link lands: `home`, a listing id, or a path on this site.
 * @returns {string|null}
 */
export function campaignDestination(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'home' || text === '/') return '/';
  if (/^\d{1,18}$/.test(text)) return `/listings/${text}`;
  try {
    const url = new URL(text);
    if (/(^|\.)lukkaplace\.com$/.test(url.hostname)) return safeDestination(`${url.pathname}${url.search}`);
    return null;
  } catch {
    return safeDestination(text.startsWith('/') ? text : `/${text}`);
  }
}

/**
 * @param {{destination: string, source: string, medium?: string, campaign?: string, content?: string, ref?: string}} fields
 * @returns {{ok: true, url: string, tags: object}|{ok: false, error: 'destination'|'source'|'medium'}}
 */
export function buildCampaignLink(fields, { siteUrl = 'https://lukkaplace.com' } = {}) {
  const path = campaignDestination(fields?.destination);
  if (!path) return { ok: false, error: 'destination' };
  const source = CAMPAIGN_SOURCES.includes(fields?.source) ? fields.source : null;
  if (!source) return { ok: false, error: 'source' };
  const medium = fields?.medium ? (CAMPAIGN_MEDIUMS.includes(fields.medium) ? fields.medium : null) : null;
  if (fields?.medium && !medium) return { ok: false, error: 'medium' };
  const campaign = normaliseTag(fields?.campaign) || DEFAULT_CAMPAIGN;
  const content = normaliseTag(fields?.content);
  const ref = normaliseReferralCode(fields?.ref);

  const url = new URL(path, siteUrl);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref']) url.searchParams.delete(key);
  url.searchParams.set('utm_source', source);
  if (medium) url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', campaign);
  if (content) url.searchParams.set('utm_content', content);
  if (ref) url.searchParams.set('ref', ref);
  return { ok: true, url: url.toString(), tags: { source, medium, campaign, content, ref } };
}
