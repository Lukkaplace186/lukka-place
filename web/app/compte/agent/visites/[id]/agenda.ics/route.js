import { getCurrentAgentId } from '@/lib/agentSession';
import { findOwnedViewingRequest } from '@/lib/agentViewingOwnership';
import { getListingPlaces, visitPropertyId } from '@/lib/agentAgenda';
import { buildVisitIcs, directionsUrl, placeLine } from '@/lib/visitAgenda';
import { SITE_URL } from '@/lib/constants';

/**
 * GET /compte/agent/visites/:id/agenda.ics — "Ajouter à mon agenda" for one
 * confirmed visit.
 *
 * middleware.js already gates /compte/agent/*; the session is re-read here
 * and the request must be one of THIS agent's own (lib/agentViewingOwnership.js,
 * the rule the Visites tab's answers use). Anything else — another agent's
 * visit, a guessed id — is the same 404, so ids cannot be probed. The file
 * carries a customer's name and phone number; it is `private, no-store`.
 *
 * Only a CONFIRMED visit with a real `scheduled_at` exports. A visit whose time
 * was never agreed gets 409, not a calendar entry at a guessed hour.
 */
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  const viewingRequestId = Number.parseInt(id, 10);
  if (!Number.isFinite(viewingRequestId)) return new Response('Not found', { status: 404 });

  let visit;
  try {
    visit = await findOwnedViewingRequest(agentId, viewingRequestId, { status: 'CONFIRMED' });
  } catch (err) {
    console.error(`[agenda.ics] visit #${viewingRequestId} lookup failed: ${err.message}`);
    return new Response('Unavailable', { status: 503 });
  }
  if (!visit) return new Response('Not found', { status: 404 });
  if (!visit.scheduled_at) return new Response('This visit has no agreed time yet.', { status: 409 });

  const propertyId = visitPropertyId(visit);
  let place = null;
  if (propertyId) {
    try {
      place = (await getListingPlaces(agentId, [propertyId])).get(String(propertyId)) || null;
    } catch (err) {
      // The appointment is still worth exporting without a location.
      console.error(`[agenda.ics] listing #${propertyId} place lookup failed: ${err.message}`);
    }
  }

  const ics = buildVisitIcs({
    id: visit.id,
    scheduledAt: visit.scheduled_at,
    title: place?.title || null,
    customerName: visit.lead_name || null,
    customerPhone: visit.lead_wa_id || null,
    requestedTime: visit.requested_time || null,
    place: place ? placeLine(place) : null,
    directions: place ? directionsUrl(place) : null,
    listingUrl: propertyId ? `${SITE_URL}/listings/${propertyId}` : null,
    dashboardUrl: `${SITE_URL}/compte/agent/visites`,
  });
  if (!ics) return new Response('This visit has no agreed time yet.', { status: 409 });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="visite-lukka-place-${visit.id}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
