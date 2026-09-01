'use server';

import { redirect } from 'next/navigation';
import { normalizePhone } from '@/lib/phone';
import { createLead, createViewingRequest } from '@/lib/adminApi';
import { getListingById } from '@/lib/listings';

/**
 * Public "Demander une visite" form (EnquiryCard.js) — creates a real lead
 * plus a real viewing_requests row tied to it, the same underlying tables
 * the WhatsApp buyer-assistant's request_viewing tool writes to
 * (services/openai.js, engine repo). This makes the request appear on the
 * agent dashboard's Visit Scheduler (web/app/compte/agent/visites)
 * automatically — ownership there is resolved via property_id (see
 * services/db.js's listViewingRequestsForOwner doc comment), so getting
 * `property_id` right is what matters; `assigned_agent` is best-effort
 * display only, not the ownership signal.
 *
 * `getListingById` re-applies the public approved-listing filter, so this
 * can never create a viewing request against a pending/unpublished listing
 * id, even a crafted one.
 */
export async function submitVisitRequestAction(propertyId, formData) {
  const name = String(formData.get('name') || '').trim().slice(0, 120);
  const phone = normalizePhone(String(formData.get('phone') || ''));
  const requestedTime = String(formData.get('requested_time') || '').trim().slice(0, 200);

  if (!phone) redirect(`/listings/${propertyId}?visit_error=phone`);
  if (!requestedTime) redirect(`/listings/${propertyId}?visit_error=time`);

  const listing = await getListingById(propertyId);
  if (!listing) redirect(`/listings/${propertyId}?visit_error=1`);

  try {
    const { lead } = await createLead({
      waId: phone,
      name: name || null,
      source: 'listing-visit-request',
      propertyId: listing.id,
      assignedAgent: listing.agency_name || null,
      requirementsSummary: `Demande de visite — créneau souhaité : ${requestedTime}`,
    });
    await createViewingRequest({ leadId: lead.id, propertyId: listing.id, requestedTime });
  } catch (err) {
    console.error(`[listings/${propertyId}] visit request failed: ${err.message}`);
    redirect(`/listings/${propertyId}?visit_error=1`);
  }

  redirect(`/listings/${propertyId}?visit_sent=1`);
}
