import { getPool } from '@/lib/db';
import { recordAgentContactTap } from '@/lib/agentContactTaps';
import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import { signedInAgentIdFrom, signedInCustomerIdFrom, viewerKindFor, visitorIdFrom } from '@/lib/trackIngest';

/**
 * POST /api/telemetry/contact-tap — a tap on a direct "WhatsApp" / "Appeler"
 * link to an agent outside a listing page (components/ContactTapBeacon.js,
 * lib/contactTapAttrs.js), for /admin/contacts.
 *
 * Same posture as /api/track: unauthenticated, write-only, rate limited per IP
 * on the shared budget, device from the headers, viewer kind from the cookies.
 * The agent is resolved server-side (lib/agentContactTaps.js). Always answers
 * 204-like JSON: the beacon does not read it.
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

  const { device } = analyticsDimensions(request.headers);
  const agentId = signedInAgentIdFrom(request);
  const viewerKind = viewerKindFor(request, device, { automated: false, agentId });
  try {
    const recorded = await recordAgentContactTap(getPool(), {
      surface: body?.surface,
      channel: body?.channel,
      agentId: body?.agentId,
      listingId: body?.listingId,
      projectSlug: body?.projectSlug,
      visitorId: visitorIdFrom(request, body?.visitorId),
      customerId: signedInCustomerIdFrom(request),
      viewerKind,
      device,
    });
    return Response.json({ success: true, recorded });
  } catch (err) {
    console.error(`[api/telemetry/contact-tap] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }
}
