'use client';

import { CONSENT_COOKIE, TIKTOK_EVENT_NAME, consentAllowsAds, newEventId } from './adTrackingRules';

/**
 * The browser half of an ad event (growth plan items 5–6): the Meta and
 * TikTok pixels, plus the server copy through /api/ad-event under the same
 * event id. components/AdTracking.js loads the pixels; an event fired before
 * it has decided (consent, ids) waits in `window.__lpAdQueue` and goes out
 * once it has, or is dropped if the visitor refused.
 *
 * Silent like every beacon: a blocked pixel or a failed request is never the
 * visitor's problem.
 */

function readCookie(name) {
  try {
    return new RegExp(`(?:^|;\s*)${name}=([^;]+)`).exec(document.cookie)?.[1] || null;
  } catch {
    return null;
  }
}

/** The state AdTracking publishes: 'pending' until it has decided, then 'on' or 'off'. */
function trackingState() {
  return (typeof window !== 'undefined' && window.__lpAds?.state) || 'pending';
}

/** Sends one event to whichever pixels are loaded, and the server copy. */
export function dispatchAdEvent(name, params = {}, eventId = newEventId(), { serverCopy = true } = {}) {
  if (typeof window === 'undefined') return;
  const ads = window.__lpAds || {};
  if (ads.state !== 'on' || !consentAllowsAds(readCookie(CONSENT_COOKIE))) return;
  const metaParams = {};
  if (params.contentIds?.length) { metaParams.content_ids = params.contentIds; metaParams.content_type = 'product'; }
  if (params.value != null && params.currency) { metaParams.value = params.value; metaParams.currency = params.currency; }
  if (params.searchString) metaParams.search_string = params.searchString;
  try {
    if (ads.meta && typeof window.fbq === 'function') window.fbq('track', name, metaParams, { eventID: eventId });
  } catch { /* a pixel error is not the visitor's problem */ }
  try {
    // TikTok's page view is ttq.page(), which AdTracking calls itself.
    if (ads.tiktok && window.ttq?.track && name !== 'PageView') {
      window.ttq.track(TIKTOK_EVENT_NAME[name] || name, {
        ...(params.contentIds?.length ? { contents: params.contentIds.map((id) => ({ content_id: String(id), content_type: 'product' })) } : {}),
        ...(params.value != null && params.currency ? { value: params.value, currency: params.currency } : {}),
        ...(params.searchString ? { query: params.searchString } : {}),
      }, { event_id: eventId });
    }
  } catch { /* idem */ }
  if (!serverCopy || name === 'PageView' || !(ads.meta || ads.tiktok)) return;
  try {
    fetch('/api/ad-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, eventId, params, url: window.location.href }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* idem */ }
}

/**
 * Fire an ad event now, or once AdTracking has decided. Returns the event id.
 * @param {'ViewContent'|'Search'|'Contact'} name
 * @param {{contentIds?: Array<number|string>, value?: number, currency?: 'USD', searchString?: string}} [params]
 */
export function adEvent(name, params = {}) {
  if (typeof window === 'undefined') return null;
  const eventId = newEventId(name.slice(0, 3).toLowerCase());
  const state = trackingState();
  if (state === 'pending') {
    window.__lpAdQueue = window.__lpAdQueue || [];
    if (window.__lpAdQueue.length < 20) window.__lpAdQueue.push({ name, params, eventId });
  } else if (state === 'on') {
    dispatchAdEvent(name, params, eventId);
  }
  return eventId;
}
