import { getPool } from '@/lib/db';
import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited, usableAmount } from '@/lib/eventIngest';
import {
  LISTING_EVENT_TYPES,
  attributionFromBody,
  eventSource,
  partnerCodeFrom,
  recordVisitorTouch,
  normaliseSearch,
  positiveId,
  recordListingEvent,
  recordPageView,
  recordSearch,
  signedInAgentIdFrom,
  viewerKindFor,
  visitorIdFrom,
} from '@/lib/trackIngest';

/**
 * Public, write-only event logger for the analytics every dashboard, the
 * landlord report and the market-data export read (web/lib/analytics.js,
 * lib/marketing/mandateReport.js, lib/dataExport.js). No auth — same trust
 * level as any client-side beacon — and no read capability exposed here at
 * all. Anything outside the known event types is a 400, not silently
 * accepted junk.
 *
 * WHERE EACH EVENT LANDS
 *  - `page_view` → `page_views`.
 *  - `whatsapp_click` → `whatsapp_clicks`. Still accepted for pages cached
 *    before the storefront CTAs moved to /api/telemetry/lead-click.
 *  - every listing-scoped step that is NOT an enquiry → `listing_events`
 *    (lib/trackIngest.js LISTING_EVENT_TYPES): saves and unsaves, taps on
 *    "Appeler" (`call_click`, with the routing the tel: link took), a
 *    visitor engaging with the photos (`gallery_open`) and reaching the end
 *    of them (`gallery_complete`), and sharing the listing (`share_click`).
 *    Kept out of `whatsapp_clicks` on purpose: getWhatsAppConversionRate
 *    divides that table by views, and folding other steps in would inflate
 *    the one number it exists to get right. Saves and unsaves are two rows
 *    with an `event` discriminator rather than one deleted row, because
 *    "changed their mind" is itself a real signal.
 *  - `search` → `search_events`, with the count of listings that matched
 *    the search exactly — the demand side of the market data.
 *
 * EVERY VIEWER IS STORED, tagged with `viewer_kind` (lib/trackIngest.js):
 * visitors, the listing's own agent, other agents, the Lukka Place team, bots
 * and prefetches alike.
 *
 * `price` is the listing's canonical USD figure at the moment of the event.
 * Recorded on the row rather than joined back from `properties` at read
 * time on purpose: a listing's price changes, and a saved-at-$1,100 event
 * must keep saying $1,100 after the agent drops it to $950.
 *
 * Device is derived from request HEADERS, never from the body — see
 * lib/requestContext.js. The traffic source is the session's attribution the
 * beacon carries (lib/attribution.js: the landing page's campaign tags, ad
 * click id or external referrer), because the beacon's own Referer is our
 * page; with none it is 'direct'. A page view also records the visit's full
 * campaign and moves the visitor's first / last touch (lib/trackIngest.js).
 * The visitor id prefers the `lp_vid` cookie over the body's copy.
 *
 * Rate limited per IP, one budget shared with /api/telemetry/lead-click
 * (lib/eventIngest.js). These figures are meant to be sold, which makes
 * "trivially skewable" a product problem, not just an ops one. The limiter
 * is in-process and best-effort: the app runs as a single PM2 fork, so one
 * process sees all traffic today. A speed bump against casual abuse, not a
 * defence against a determined distributed attacker.
 */

export async function POST(request) {
  if (rateLimited(clientKey(request))) {
    return Response.json({ success: false, error: 'Too many events' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, path, commune, listingId, price } = body || {};
  const attribution = attributionFromBody(body);
  const headerDimensions = analyticsDimensions(request.headers);
  const device = headerDimensions.device;
  const source = eventSource(attribution, headerDimensions.source);

  const pool = getPool();
  const visitorId = visitorIdFrom(request, body?.visitorId);
  const agentId = signedInAgentIdFrom(request);
  const viewerKind = viewerKindFor(request, device, { automated: body?.automated === true, agentId });
  let recorded = true;

  try {
    if (type === 'page_view') {
      if (!path) return Response.json({ success: false, error: 'path is required' }, { status: 400 });
      const refCode = partnerCodeFrom(request);
      recorded = await recordPageView(pool, {
        path, commune, device, source, visitorId, viewerKind, agentId, attribution, refCode,
      });
      await recordVisitorTouch(pool, { visitorId, viewerKind, attribution, refCode });
    } else if (type === 'whatsapp_click') {
      await pool.query(
        'INSERT INTO whatsapp_clicks (listing_id, commune, device, source, price) VALUES ($1, $2, $3, $4, $5)',
        [positiveId(listingId), commune || null, device, source, usableAmount(price)],
      );
    } else if (LISTING_EVENT_TYPES.includes(type)) {
      // A listing-scoped event with no listing is not a usable row — there is
      // nothing to attribute it to, and a NULL-listing row would quietly pad
      // every per-listing count with events belonging to no listing at all.
      const id = positiveId(listingId);
      if (!id) {
        return Response.json({ success: false, error: 'listingId is required' }, { status: 400 });
      }
      recorded = await recordListingEvent(pool, {
        event: type,
        listingId: id,
        commune,
        price: usableAmount(price),
        device,
        source,
        visitorId,
        routingType: body?.routingType,
        viewerKind,
        agentId,
      });
    } else if (type === 'search') {
      recorded = await recordSearch(pool, normaliseSearch(body), { device, source, visitorId, viewerKind });
    } else {
      return Response.json(
        {
          success: false,
          error: `type must be one of page_view, whatsapp_click, search, ${LISTING_EVENT_TYPES.join(', ')}`,
        },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error(`[api/track] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }

  return Response.json({ success: true, recorded });
}
