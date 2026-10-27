import 'server-only';
import { after } from 'next/server';
import { cookies, headers } from 'next/headers';
import { getPool } from './db';
import { AD_QUEUE_COOKIE, CONSENT_COOKIE, consentAllowsAds, parseAdQueue } from './adTrackingRules';
import { sendAdServerEvent } from './adServerEvents';
import { VISITOR_COOKIE, cleanVisitorId } from './trackIngest';
import { clientIpFrom } from './salesReferral';

/**
 * Who the visitor is, for an ad event's matching: IP, user agent, visitor id,
 * the pixels' own cookies (_fbp, _fbc), and the ad click id their last touch
 * carried (visitor_touches). Null when consent does not allow ad events.
 */
export async function adUserFromRequest({ phone = null } = {}) {
  const cookieStore = await cookies();
  if (!consentAllowsAds(cookieStore.get(CONSENT_COOKIE)?.value)) return null;
  const headerList = await headers();
  const visitorId = cleanVisitorId(cookieStore.get(VISITOR_COOKIE)?.value);
  let fbc = cookieStore.get('_fbc')?.value || null;
  let ttclid = cookieStore.get('ttclid')?.value || null;
  if (visitorId && (!fbc || !ttclid)) {
    try {
      const { rows } = await getPool().query(
        `SELECT last_click_id, last_click_id_type, EXTRACT(EPOCH FROM last_touch_at)::bigint * 1000 AS touch_ms
           FROM visitor_touches WHERE visitor_id = $1`,
        [visitorId],
      );
      const touch = rows[0];
      if (touch?.last_click_id_type === 'fbclid' && !fbc) fbc = `fb.1.${touch.touch_ms}.${touch.last_click_id}`;
      if (touch?.last_click_id_type === 'ttclid' && !ttclid) ttclid = touch.last_click_id;
    } catch {
      // No touch table yet: the event still goes, with less to match on.
    }
  }
  return {
    ip: clientIpFrom(headerList),
    userAgent: headerList.get('user-agent') || null,
    visitorId,
    phone,
    fbp: cookieStore.get('_fbp')?.value || null,
    fbc,
    ttclid,
  };
}

/**
 * From a server action that just did something worth measuring (a verified
 * signup, a visit request): sends the server copy after the response, and
 * queues the browser copy under the same id in `lp_adq`, which the page
 * fires on its next load (components/AdTracking.js). Nothing at all without
 * consent. Never throws.
 */
export async function recordAdEventFromAction({ name, eventId, phone = null, params = {}, url = null }) {
  try {
    const user = await adUserFromRequest({ phone });
    if (!user) return;
    const cookieStore = await cookies();
    const queue = parseAdQueue(cookieStore.get(AD_QUEUE_COOKIE)?.value);
    queue.push({ n: name, id: eventId, p: params });
    cookieStore.set(AD_QUEUE_COOKIE, encodeURIComponent(JSON.stringify(queue.slice(-5))), {
      path: '/', maxAge: 600, sameSite: 'lax', httpOnly: false, secure: process.env.NODE_ENV === 'production',
    });
    after(() => sendAdServerEvent({ name, eventId, url, user, params }));
  } catch (err) {
    console.error(`[ad-events] ${name} from action not recorded: ${err.message}`);
  }
}
