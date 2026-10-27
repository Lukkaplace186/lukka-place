/**
 * Where a visit came from: the campaign tags on the landing URL, the ad
 * platforms' click ids, and the external site that sent the visitor. Pure —
 * the browser beacon (lib/analyticsClient.js) reads it off the page, the
 * server (lib/trackIngest.js) cleans what the beacon claims, with the same
 * rules on both sides.
 *
 * ONE SESSION, ONE SOURCE (2026-10-27)
 * The beacon used to send only the `utm_source` of the page it fired on, and
 * its Referer header is our own page, so a visitor who landed from a TikTok
 * ad and then opened a listing was 'direct' on every event after the first.
 * The browser now keeps the landing attribution for the tab's session
 * (sessionStorage) and sends it with every event; a NEW tagged link opened in
 * the same tab replaces it. An external referrer (google.com, facebook.com)
 * is a source too — it used to be lost entirely, since the beacon's own
 * Referer is lukkaplace.com.
 *
 * Partner referral codes are NOT carried here: they live in the `lp_ref`
 * cookie that /go/<code> sets (lib/partners.js), which the server reads.
 */

export const CLICK_ID_PARAMS = ['fbclid', 'ttclid', 'gclid'];

const MAX_TAG = 100;
const MAX_CLICK_ID = 255;
const MAX_PATH = 300;
const MAX_HOST = 128;

function tag(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().slice(0, MAX_TAG);
  return text ? text.toLowerCase() : null;
}

function host(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9.-]{1,128}$/.test(text) ? text.slice(0, MAX_HOST) : null;
}

function landingPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.split(/[?#]/)[0];
  return path.startsWith('/') && !path.startsWith('//') ? path.slice(0, MAX_PATH) : null;
}

/**
 * The attribution the page's own URL and referrer carry, or null when neither
 * says anything (internal navigation, or a typed address).
 *
 * @param {string} href       the page URL
 * @param {string} [referrer] document.referrer
 */
export function attributionFromLocation(href, referrer = '') {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const params = url.searchParams;
  const out = {
    source: tag(params.get('utm_source')),
    medium: tag(params.get('utm_medium')),
    campaign: tag(params.get('utm_campaign')),
    content: tag(params.get('utm_content')),
    term: tag(params.get('utm_term')),
    clickId: null,
    clickIdType: null,
    referrerHost: null,
    landingPath: landingPath(url.pathname),
  };
  for (const name of CLICK_ID_PARAMS) {
    const value = params.get(name);
    if (value) {
      out.clickId = value.slice(0, MAX_CLICK_ID);
      out.clickIdType = name;
      break;
    }
  }
  try {
    const ref = referrer ? new URL(referrer) : null;
    const refHost = ref ? host(ref.hostname) : null;
    if (refHost && refHost !== host(url.hostname)) out.referrerHost = refHost;
  } catch {
    // A malformed referrer says nothing.
  }
  return isTagged(out) || out.referrerHost ? out : null;
}

/** Carries a campaign tag or an ad click id (an external referrer alone is not a tag). */
export function isTagged(attr) {
  return Boolean(attr && (attr.source || attr.medium || attr.campaign || attr.clickId));
}

/**
 * Which attribution a new event should carry: the page's own when it is
 * tagged (a new campaign link replaces the session's), else the session's,
 * else the page's referrer-only attribution (the first page of a session
 * reached from another site).
 */
export function chooseSessionAttribution(current, stored) {
  if (isTagged(current)) return current;
  if (stored) return stored;
  return current || null;
}

/**
 * The beacon's claim, bounded field by field. Anything malformed becomes
 * null; the result is null when nothing usable is left.
 */
export function cleanAttribution(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clickIdType = CLICK_ID_PARAMS.includes(raw.clickIdType) ? raw.clickIdType : null;
  const clickId = clickIdType && typeof raw.clickId === 'string' && /^[A-Za-z0-9._-]{1,255}$/.test(raw.clickId)
    ? raw.clickId
    : null;
  const out = {
    source: tag(raw.source),
    medium: tag(raw.medium),
    campaign: tag(raw.campaign),
    content: tag(raw.content),
    term: tag(raw.term),
    clickId,
    clickIdType: clickId ? clickIdType : null,
    referrerHost: host(raw.referrerHost),
    landingPath: landingPath(raw.landingPath),
  };
  return isTagged(out) || out.referrerHost ? out : null;
}

/**
 * The single traffic source a row stores (`page_views.source` and its
 * siblings): the campaign's utm_source, else the external referrer's host,
 * else 'direct'. An ad click with no utm_source is named after its platform.
 */
export function sourceOf(attr) {
  if (!attr) return 'direct';
  if (attr.source) return attr.source.slice(0, 64);
  if (attr.clickIdType === 'fbclid') return 'facebook';
  if (attr.clickIdType === 'ttclid') return 'tiktok';
  if (attr.clickIdType === 'gclid') return 'google';
  return attr.referrerHost || 'direct';
}
