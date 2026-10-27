/**
 * Meta / TikTok ad measurement (growth plan items 5–7) — the rules both the
 * browser and the server read. Pure: no DOM, no secrets.
 *
 * EVENTS: PageView (browser only — every page), ViewContent (a listing page),
 * Search, Contact (a WhatsApp or call tap), CompleteRegistration (a customer
 * whose number was just verified), Schedule (a visit request). Every event
 * but PageView is also sent from our server (Meta Conversions API, TikTok
 * Events API) under the SAME event id, so each platform counts it once.
 *
 * CONSENT (`lp_consent`): 'granted' / 'denied' for a visitor asked, 'na' for
 * one who is not asked. Asked = a browser on a European time zone
 * (Europe/…, Atlantic/Canary|Madeira|Azores|Faroe|Reykjavik): the diaspora in
 * the EU and the UK, where ad cookies need a yes first. A Kinshasa phone is
 * not asked and is measured. No cookie yet = nothing is sent, by the browser
 * or the server.
 */

export const CONSENT_COOKIE = 'lp_consent';
export const CONSENT_VALUES = ['granted', 'denied', 'na'];
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60;

/** Server-queued browser events (`[{n, id, p}]`), drained by the page on its next load. */
export const AD_QUEUE_COOKIE = 'lp_adq';

export const AD_EVENTS = ['PageView', 'ViewContent', 'Search', 'Contact', 'CompleteRegistration', 'Schedule'];
export const SERVER_AD_EVENTS = AD_EVENTS.filter((name) => name !== 'PageView');

/**
 * TikTok's names for the same events. Its standard list uses the same words
 * as Meta for these six; check them against Events Manager after the first
 * live events — an unknown name is recorded as a custom event, not refused.
 */
export const TIKTOK_EVENT_NAME = {
  PageView: 'Pageview',
  ViewContent: 'ViewContent',
  Search: 'Search',
  Contact: 'Contact',
  CompleteRegistration: 'CompleteRegistration',
  Schedule: 'Schedule',
};

const EUROPEAN_ATLANTIC = new Set(['Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Faroe', 'Atlantic/Reykjavik']);

/** Whether this browser must be asked before any ad measurement. */
export function consentRequired({ timeZone = '' } = {}) {
  const zone = String(timeZone || '');
  return zone.startsWith('Europe/') || EUROPEAN_ATLANTIC.has(zone);
}

/** Whether a stored consent value lets ad events go out. */
export function consentAllowsAds(value) {
  return value === 'granted' || value === 'na';
}

/** A random event id shared by the browser and the server copy. */
export function newEventId(prefix = 'e') {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`.slice(0, 64);
}

const EVENT_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * The browser's claim about an event, bounded for /api/ad-event: a known
 * server event, a well-formed id, a same-site URL, and only the four params
 * the two platforms are sent.
 */
export function cleanAdEvent(body, { siteHost = 'lukkaplace.com' } = {}) {
  const name = SERVER_AD_EVENTS.includes(body?.name) ? body.name : null;
  const eventId = typeof body?.eventId === 'string' && EVENT_ID_RE.test(body.eventId) ? body.eventId : null;
  if (!name || !eventId) return null;
  let url = null;
  try {
    const parsed = new URL(String(body?.url || ''));
    const host = parsed.hostname.replace(/^www\./, '');
    if (host === siteHost || host === 'localhost') url = `${parsed.origin}${parsed.pathname}`;
  } catch {
    url = null;
  }
  const params = body?.params && typeof body.params === 'object' ? body.params : {};
  const contentIds = Array.isArray(params.contentIds)
    ? params.contentIds.map((id) => String(id)).filter((id) => /^\d{1,18}$/.test(id)).slice(0, 5)
    : [];
  const value = Number(params.value);
  return {
    name,
    eventId,
    url,
    params: {
      contentIds,
      value: Number.isFinite(value) && value >= 0 && value < 1e9 ? value : null,
      currency: params.currency === 'USD' ? 'USD' : null,
      searchString: typeof params.searchString === 'string' ? params.searchString.slice(0, 120) : null,
    },
  };
}

/** The queue cookie's content, bounded (at most 5 events, known names, well-formed ids). */
export function parseAdQueue(value) {
  try {
    const list = JSON.parse(decodeURIComponent(String(value || '')));
    return (Array.isArray(list) ? list : [])
      .filter((entry) => AD_EVENTS.includes(entry?.n) && EVENT_ID_RE.test(String(entry?.id || '')))
      .slice(0, 5)
      .map((entry) => ({ n: entry.n, id: entry.id, p: entry.p && typeof entry.p === 'object' ? entry.p : {} }));
  } catch {
    return [];
  }
}
