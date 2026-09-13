'use client';

/**
 * The one client-side event beacon. `lib/analytics.js` is the READ side and
 * is `server-only`; this is the write side, and the two must not be
 * confused — importing that file from a `'use client'` component is a build
 * error by design.
 *
 * Three call sites were each hand-rolling the same `fetch('/api/track', …)`
 * with their own `.catch(() => {})` (ListingViewTracker, WhatsAppCTA, and
 * now the Save toggle). One copy, so the swallow-and-continue posture below
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
 * (lib/requestContext.js's analyticsDimensions), the same way page_view and
 * whatsapp_click already do it, and it is stored on every row this writes.
 * The body stays the client's claim about WHAT it did; the headers are the
 * browser's own account of WHO it is, which is the harder one to get wrong
 * and the harder one to spoof casually. A client-supplied 'mobile' |
 * 'desktop' would be a second, disagreeing source for one fact.
 *
 * @param {'page_view'|'whatsapp_click'|'listing_saved'|'listing_unsaved'} type
 * @param {Object} [payload] `listingId` / `price` / `commune` / `path`.
 */
export function trackEvent(type, payload = {}) {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // fetch itself can throw synchronously on a malformed body — still not
    // the visitor's problem.
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
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/telemetry/lead-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'whatsapp_cta_clicked', ...listingEventPayload(listing), routingType }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Not the visitor's problem.
  }
}
