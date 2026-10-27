import 'server-only';
import { createHash } from 'node:crypto';
import { getGrowthSettings } from './siteSettings';
import { TIKTOK_EVENT_NAME } from './adTrackingRules';

/**
 * The server copy of an ad event (growth plan item 6): Meta Conversions API
 * and TikTok Events API, under the same event id the browser pixel used, so
 * each platform counts the event once even when the browser copy was blocked
 * (ad blockers, iPhones).
 *
 * The access tokens are server environment only (META_CAPI_TOKEN,
 * TIKTOK_EVENTS_TOKEN); the pixel ids come from lib/siteSettings.js. Either
 * half missing = that platform is skipped. Personal data leaves hashed
 * (SHA-256): the phone, the visitor id; the IP and user agent are sent as the
 * platforms require for matching. Never throws, never waited on by a page:
 * callers schedule it with `after()`.
 */

const META_API_VERSION = 'v21.0';
const TIMEOUT_MS = 4000;

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

/** What each platform needs, from what we hold. Exported for the tests. */
export function metaPayload({ name, eventId, eventTime, url, user, params }) {
  const userData = {};
  if (user.ip) userData.client_ip_address = user.ip;
  if (user.userAgent) userData.client_user_agent = user.userAgent;
  if (user.visitorId) userData.external_id = [sha256(user.visitorId)];
  if (user.phone) userData.ph = [sha256(digitsOf(user.phone))];
  if (user.fbp) userData.fbp = user.fbp;
  if (user.fbc) userData.fbc = user.fbc;
  const custom = {};
  if (params?.contentIds?.length) { custom.content_ids = params.contentIds; custom.content_type = 'product'; }
  if (params?.value != null && params?.currency) { custom.value = params.value; custom.currency = params.currency; }
  if (params?.searchString) custom.search_string = params.searchString;
  return {
    data: [{
      event_name: name,
      event_time: eventTime,
      event_id: eventId,
      action_source: 'website',
      ...(url ? { event_source_url: url } : {}),
      user_data: userData,
      ...(Object.keys(custom).length ? { custom_data: custom } : {}),
    }],
  };
}

export function tiktokPayload({ pixelId, name, eventId, eventTime, url, user, params }) {
  const tiktokUser = {};
  if (user.ip) tiktokUser.ip = user.ip;
  if (user.userAgent) tiktokUser.user_agent = user.userAgent;
  if (user.visitorId) tiktokUser.external_id = sha256(user.visitorId);
  if (user.phone) tiktokUser.phone = sha256(`+${digitsOf(user.phone)}`);
  if (user.ttclid) tiktokUser.ttclid = user.ttclid;
  const properties = {};
  if (params?.contentIds?.length) properties.contents = params.contentIds.map((id) => ({ content_id: id, content_type: 'product' }));
  if (params?.value != null && params?.currency) { properties.value = params.value; properties.currency = params.currency; }
  if (params?.searchString) properties.query = params.searchString;
  return {
    event_source: 'web',
    event_source_id: pixelId,
    data: [{
      event: TIKTOK_EVENT_NAME[name] || name,
      event_time: eventTime,
      event_id: eventId,
      user: tiktokUser,
      ...(url ? { page: { url } } : {}),
      ...(Object.keys(properties).length ? { properties } : {}),
    }],
  };
}

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${text.slice(0, 200)}`);
  }
}

/**
 * @param {{name: string, eventId: string, url?: string|null,
 *          user: {ip?, userAgent?, visitorId?, phone?, fbp?, fbc?, ttclid?},
 *          params?: object}} event
 */
export async function sendAdServerEvent(event) {
  try {
    const settings = await getGrowthSettings();
    const eventTime = Math.floor(Date.now() / 1000);
    const sends = [];
    if (settings.metaPixelId && process.env.META_CAPI_TOKEN) {
      sends.push(post(
        `https://graph.facebook.com/${META_API_VERSION}/${settings.metaPixelId}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`,
        metaPayload({ ...event, eventTime }),
      ).catch((err) => console.error(`[ad-events] meta ${event.name} failed: ${err.message}`)));
    }
    if (settings.tiktokPixelId && process.env.TIKTOK_EVENTS_TOKEN) {
      sends.push(post(
        'https://business-api.tiktok.com/open_api/v1.3/event/track/',
        tiktokPayload({ ...event, pixelId: settings.tiktokPixelId, eventTime }),
        { 'Access-Token': process.env.TIKTOK_EVENTS_TOKEN },
      ).catch((err) => console.error(`[ad-events] tiktok ${event.name} failed: ${err.message}`)));
    }
    await Promise.all(sends);
  } catch (err) {
    console.error(`[ad-events] ${event?.name} not sent: ${err.message}`);
  }
}
