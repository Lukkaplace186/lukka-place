import { getPool } from '@/lib/db';
import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited, usableAmount } from '@/lib/eventIngest';
import { recordLeadClick, LEAD_CLICK_ROUTING_TYPES } from '@/lib/leadClicks';
import { ownerAgentIdFrom, shouldSkipRequest, visitorIdFrom } from '@/lib/trackIngest';

/**
 * POST /api/telemetry/lead-click — one tap on a listing's WhatsApp button,
 * fired by lib/analyticsClient.js's trackLeadClick (`whatsapp_cta_clicked`).
 *
 * Same trust posture as /api/track: unauthenticated, write-only, rate limited
 * per IP through the shared lib/eventIngest.js budget, device and source taken
 * from the request headers rather than the body, bots and prefetches dropped,
 * and the listing's own agent never counted (lib/trackIngest.js). What this
 * adds is the routing the button took, which is the one thing /admin/telemetry
 * needs that a plain `whatsapp_click` never recorded.
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

  const { listingId, commune, price, routingType, utmSource } = body || {};
  if (!LEAD_CLICK_ROUTING_TYPES.includes(routingType)) {
    return Response.json(
      { success: false, error: `routingType must be one of ${LEAD_CLICK_ROUTING_TYPES.join(', ')}` },
      { status: 400 },
    );
  }
  const id = Number.parseInt(listingId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ success: false, error: 'listingId is required' }, { status: 400 });
  }

  const { device, source } = analyticsDimensions(request.headers, { utmSource });
  const skipped = shouldSkipRequest(request.headers, device);
  if (skipped) return Response.json({ success: true, recorded: false, skipped });

  let recorded;
  try {
    recorded = await recordLeadClick(getPool(), {
      listingId: id,
      commune,
      device,
      source,
      price: usableAmount(price),
      routingType,
      visitorId: visitorIdFrom(request, body?.visitorId),
      ownerAgentId: ownerAgentIdFrom(request),
    });
  } catch (err) {
    console.error(`[api/telemetry/lead-click] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }

  return Response.json({ success: true, recorded });
}
