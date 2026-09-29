'use client';

/**
 * The one client-side event beacon. `lib/analytics.js` is the READ side and
 * is `server-only`; this is the write side, and the two must not be
 * confused — importing that file from a `'use client'` component is a build
 * error by design.
 *
 * Every storefront call site goes through here (ListingViewTracker, the
 * WhatsApp and call buttons, the Save toggle, the photo gallery, Share, the
 * /listings search tracker), so the swallow-and-continue posture below
 * cannot drift between them.
 *
 * WHY EVERY FAILURE IS SILENT
 * A blocked or failed beacon must never surface to the visitor and must
 * never reach an error boundary. Ad blockers routinely block
 * analytics-shaped endpoints, `/api/track` rate-limits per IP, and a save
 * that genuinely succeeded would otherwise be reported as broken because
 * its telemetry didn't land. `keepalive` so an event fired immediately
 * before a navigation (the WhatsApp CTA opens another app) still leaves the
 * browser.
 *
 * WHY `device` IS NOT IN THE PAYLOAD
 * It is derived server-side from the request's own User-Agent
 * (lib/requestContext.js's analyticsDimensions). The body stays the client's
 * claim about WHAT it did; the headers are the browser's own account of WHO
 * it is.
 *
 * THE VISITOR ID (`lp_vid`)
 * A random id this browser keeps for a year, so a report can count different
 * people rather than page loads ("38 personnes", not "120 vues" from the same
 * five visitors). It is created here, holds nothing about the person, and is
 * never displayed anywhere. Kept in a first-party cookie (the server reads it
 * straight off the request, lib/trackIngest.js) with a localStorage copy so a
 * cleared cookie does not mint a second "person". Not httpOnly on purpose:
 * the browser creates it, and nothing about it is secret.
 *
 * EVERY BROWSER SENDS (product decision, 2026-09-29)
 * A driven browser (`navigator.webdriver`) or a crawler / link-preview
 * User-Agent is not silenced any more: it sends its events with
 * `automated: true`, and the server stores them tagged `viewer_kind = 'bot'`
 * (lib/trackIngest.js), beside the listing's own agent (`owner`) and the team
 * (`staff`). Only a page the browser is still PRERENDERING waits: its events
 * go out the moment the visitor actually opens it (`prerenderingchange`); a
 * prerendered page that is never opened was never on anybody's screen.
 */

export const VISITOR_COOKIE = 'lp_vid';
const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const VISITOR_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export const AUTOMATED_UA_RE =
  /bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse|facebookexternalhit|meta-externalagent|google-inspectiontool|prerender|^whatsapp\//i;

/** True when this browser says it is automated (sent as `automated`, never used to drop an event). */
export function isAutomatedClient() {
  try {
    if (typeof navigator === 'undefined') return false;
    if (navigator.webdriver) return true;
    return AUTOMATED_UA_RE.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

function newVisitorId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * This browser's visitor id, created on first use. Undefined wherever storage
 * is refused entirely — the event is then stored without one, which counts it
 * as a view but not as a person.
 */
export function getVisitorId() {
  if (typeof window === 'undefined') return undefined;
  try {
    const fromCookie = new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([^;]+)`).exec(document.cookie)?.[1];
    if (fromCookie && VISITOR_ID_RE.test(fromCookie)) return fromCookie;

    let id = null;
    try {
      id = window.localStorage.getItem(VISITOR_COOKIE);
    } catch {
      id = null;
    }
    if (!id || !VISITOR_ID_RE.test(id)) id = newVisitorId();

    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${VISITOR_COOKIE}=${id}; Max-Age=${VISITOR_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
    try {
      window.localStorage.setItem(VISITOR_COOKIE, id);
    } catch {
      // Private mode: the cookie alone still works.
    }
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Send now, or — while the browser is prerendering this page — the moment the
 * visitor actually opens it. A prerendered page that is never opened sends
 * nothing.
 */
function whenVisible(send) {
  try {
    if (typeof document !== 'undefined' && document.prerendering) {
      document.addEventListener('prerenderingchange', () => send(), { once: true });
      return;
    }
  } catch {
    // Fall through and send.
  }
  send();
}

function beacon(url, body) {
  if (typeof window === 'undefined') return;
  whenVisible(() => {
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          utmSource: landingUtmSource(),
          visitorId: getVisitorId(),
          ...(isAutomatedClient() ? { automated: true } : {}),
          ...body,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // fetch itself can throw synchronously on a malformed body — still not
      // the visitor's problem.
    }
  });
}

/**
 * @param {'page_view'|'whatsapp_click'|'listing_saved'|'listing_unsaved'|'call_click'|'gallery_open'|'gallery_complete'|'share_click'|'search'} type
 * @param {Object} [payload] `listingId` / `price` / `commune` / `path`, or a search.
 */
export function trackEvent(type, payload = {}) {
  beacon('/api/track', { type, ...payload });
}

/**
 * The `utm_source` on the page's own URL, or undefined.
 *
 * Both endpoints have always ACCEPTED `utmSource` (lib/requestContext.js), but
 * nothing sent it, and a beacon's Referer is the page itself — so every
 * visitor arriving from a tagged link an agent shared was stored as 'direct'.
 * Read here, once, rather than by each caller.
 */
function landingUtmSource() {
  try {
    return new URLSearchParams(window.location.search).get('utm_source') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The listing dimensions every listing-scoped event carries, read off the
 * real row. `price` is the canonical USD `properties.price` column — the
 * same figure every filter and sort compares against — never a
 * currency-toggled CDF estimate, which would make two events on the same
 * listing incomparable depending on what the visitor had toggled.
 */
export function listingEventPayload(listing) {
  return {
    listingId: listing?.id ?? null,
    price: listing?.price ?? null,
    commune: listing?.commune ?? null,
  };
}

/**
 * `whatsapp_cta_clicked` — a tap on a listing's WhatsApp button, with the
 * routing it took (lib/leadRouting.js). Goes to /api/telemetry/lead-click,
 * which writes the same `whatsapp_clicks` row a `whatsapp_click` did plus the
 * routing, so it REPLACES trackEvent('whatsapp_click') at those call sites —
 * firing both would count every tap twice in the conversion rate.
 *
 * No `agentId` in the body on purpose: the server reads it off the listing
 * row. Same silent-failure posture as trackEvent, for the same reasons.
 *
 * @param {Object} listing
 * @param {'DIRECT_WA'|'CENTRAL_FALLBACK'} routingType
 */
export function trackLeadClick(listing, routingType) {
  beacon('/api/telemetry/lead-click', {
    event: 'whatsapp_cta_clicked',
    ...listingEventPayload(listing),
    routingType,
  });
}

/**
 * A tap on "Appeler". `listing.agent_phone` is only ever set for a verified,
 * routing-enabled agent (lib/listings.js), so its presence IS the routing:
 * the call reached the agent directly, otherwise Lukka Place's central number.
 */
export function trackCallClick(listing) {
  trackEvent('call_click', {
    ...listingEventPayload(listing),
    routingType: listing?.agent_phone ? 'DIRECT' : 'CENTRAL',
  });
}

/** `/listings/310` (or a full URL to it) -> 310, else null. */
export function listingIdFromPath(pathOrUrl) {
  try {
    const path = String(pathOrUrl || '').replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0];
    const match = /^\/listings\/(\d{1,18})$/.exec(path);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}
