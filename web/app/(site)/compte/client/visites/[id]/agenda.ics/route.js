import { getPortalCustomer } from '@/lib/customerPortal';
import { getCustomerInquiries } from '@/lib/customerInquiries';
import { buildVisitIcs } from '@/lib/visitAgenda';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { SITE_URL } from '@/lib/constants';

/**
 * GET /compte/client/visites/:id/agenda.ics — the customer's "Ajouter à mon
 * agenda" for one of THEIR confirmed visits. middleware.js gates /compte/*;
 * the visit must be among the signed-in customer's own requests (matched by
 * their stored phone in the engine), and anything else is the same 404.
 * CONFIRMED with a real `scheduled_at` only (409 otherwise). The location is
 * the commune — the exact address stays with the agent.
 */
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const portal = await getPortalCustomer();
  if (!portal) return new Response('Unauthorized', { status: 401 });
  const viewingId = Number.parseInt((await params).id, 10);
  if (!Number.isFinite(viewingId)) return new Response('Not found', { status: 404 });

  let found = null;
  try {
    const inquiries = await getCustomerInquiries(portal.customerId);
    for (const { listing, viewings = [] } of inquiries) {
      const viewing = viewings.find((v) => Number(v.id) === viewingId);
      if (viewing) found = { viewing, listing };
    }
  } catch (err) {
    console.error(`[client agenda.ics] visit #${viewingId}: ${err.message}`);
    return new Response('Unavailable', { status: 503 });
  }
  if (!found) return new Response('Not found', { status: 404 });
  if (found.viewing.status !== 'CONFIRMED' || !found.viewing.scheduled_at) {
    return new Response('This visit has no agreed time yet.', { status: 409 });
  }

  const { viewing, listing } = found;
  const agent = displayableAgencyName(listing?.agency_name);
  const ics = buildVisitIcs({
    id: viewing.id,
    scheduledAt: viewing.scheduled_at,
    title: listing?.title || null,
    customerName: agent || null,
    contactLabel: 'Agent',
    customerPhone: listing?.agent_phone || null,
    requestedTime: null,
    place: listing?.commune ? `${listing.commune}, Kinshasa` : null,
    directions: null,
    listingUrl: listing ? `${SITE_URL}/listings/${listing.id}` : null,
    dashboardUrl: `${SITE_URL}/compte/client/visites`,
  });
  if (!ics) return new Response('Not found', { status: 404 });
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="visite-${viewing.id}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
