import { after } from 'next/server';
import { getPool } from '@/lib/db';
import { alertAgentOfContactTap, contactTapKind } from '@/lib/contactTapAlert';
import { visitContactFromBody } from '@/lib/visitContact';
import { analyticsDimensions } from '@/lib/requestContext';
import { CONTACT_MAX_EVENTS, contactKey, rateLimited, usableAmount } from '@/lib/eventIngest';
import { leadClickPlacement, recordLeadClick, LEAD_CLICK_ROUTING_TYPES } from '@/lib/leadClicks';
import { cleanWhatsAppIntent } from '@/lib/whatsappIntent';
import { userAgentKind } from '@/lib/waSheetRules';
import {
  attributionFromBody, eventSource, signedInAgentIdFrom, signedInCustomerIdFrom, viewerKindFor, visitorIdFrom,
} from '@/lib/trackIngest';

/**
 * POST /api/telemetry/lead-click — one tap on a listing's WhatsApp button,
 * fired by lib/analyticsClient.js's trackLeadClick (`whatsapp_cta_clicked`).
 *
 * Same trust posture as /api/track: unauthenticated, write-only, rate limited
 * per IP through the shared lib/eventIngest.js budget, device taken from the
 * request headers and source from the session's attribution (lib/attribution.js),
 * and every tap stored with its
 * `viewer_kind` — the listing's own agent, the team and bots included
 * (lib/trackIngest.js). What this
 * adds is the routing the button took, which is the one thing /admin/telemetry
 * needs that a plain `whatsapp_click` never recorded.
 */
export async function POST(request) {
  // Its own budget (lib/eventIngest.js CONTACT_MAX_EVENTS): page views from
  // the same carrier IP must never crowd out a customer reaching an agent.
  if (rateLimited(contactKey(request), CONTACT_MAX_EVENTS)) {
    return Response.json({ success: false, error: 'Too many events' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { listingId, commune, price, routingType } = body || {};
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

  const headerDimensions = analyticsDimensions(request.headers);
  const device = headerDimensions.device;
  const source = eventSource(attributionFromBody(body), headerDimensions.source);
  const agentId = signedInAgentIdFrom(request);
  const viewerKind = viewerKindFor(request, device, { automated: body?.automated === true, agentId });

  const visitorId = visitorIdFrom(request, body?.visitorId);
  const intent = cleanWhatsAppIntent(body?.intent);
  let recorded;
  try {
    recorded = await recordLeadClick(getPool(), {
      listingId: id,
      commune,
      device,
      source,
      price: usableAmount(price),
      routingType,
      visitorId,
      viewerKind,
      agentId,
      // Optional; an unknown value is stored as none, never a 400.
      placement: leadClickPlacement(body?.placement),
      // Who tapped, when signed in (/admin/contacts). An anonymous visitor stays anonymous.
      customerId: signedInCustomerIdFrom(request),
      // Visit / disponible / question, from the WhatsApp sheet; unknown → none.
      intent,
    });
  } catch (err) {
    console.error(`[api/telemetry/lead-click] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }

  // Tell the agent a customer is about to write to them, once the response
  // has left (lib/contactTapAlert.js): the tap is the only moment we know.
  const tapKind = contactTapKind({ event: 'whatsapp_cta_clicked', routingType, viewerKind, recorded });
  // A visit's optional name + number (lib/visitContact.js, 2026-11-20) goes to
  // the engine with the alert only — never into whatsapp_clicks.
  const contact = visitContactFromBody(body, intent);
  if (tapKind) after(() => alertAgentOfContactTap({ listingId: id, kind: tapKind, visitorId, intent, contact }));

  // One line per tap answered (lib/waSheetRules.js): beside the [wa-sheet]
  // open / choose lines it shows whether a chosen tap reached the server.
  console.log(`[lead-click] ${JSON.stringify({
    listingId: id, placement: leadClickPlacement(body?.placement), intent, viewerKind, recorded: Boolean(recorded),
    ua: userAgentKind(request.headers.get('user-agent')),
  })}`);
  return Response.json({ success: true, recorded });
}
