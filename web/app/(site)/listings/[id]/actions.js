'use server';

import { redirect } from 'next/navigation';
import { phoneFromForm } from '@/lib/phone';
import { createLead, createViewingRequest } from '@/lib/adminApi';
import { getListingById } from '@/lib/listings';
import { dayClosed, validatePickedSlot } from '@/lib/visitSlots';
import { getListingAvailability } from '@/lib/agentAvailability';
import { kinshasaDayKey } from '@/lib/visitAgenda';

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
 *
 * `return_to=visites` (the saved-listings board) answers on the customer's own
 * agenda instead of the listing page: that is where the request now is. Any
 * other value is ignored — the destination is one of two fixed paths, never
 * something read out of the form.
 */
export async function submitVisitRequestAction(propertyId, formData) {
  const name = String(formData.get('name') || '').trim().slice(0, 120);
  const phone = phoneFromForm(formData);
  // The picker (components/VisitSlotPicker.js) posts the exact instant; the
  // French phrase is derived from it here, never trusted from the form. A page
  // cached before the picker shipped still posts free text, which is kept.
  const pickedRaw = String(formData.get('preferred_slot_at') || '').trim();
  const picked = pickedRaw ? validatePickedSlot(pickedRaw) : null;
  const requestedTime = picked?.phrase || (pickedRaw ? '' : String(formData.get('requested_time') || '').trim().slice(0, 200));

  const base = formData.get('return_to') === 'visites' ? '/compte/client/visites' : `/listings/${propertyId}`;

  if (!phone) redirect(`${base}?visit_error=phone`);
  if (!requestedTime) redirect(`${base}?visit_error=time`);

  const listing = await getListingById(propertyId);
  if (!listing) redirect(`${base}?visit_error=1`);

  // A day the agent marked as taking no visits: the calendar greys it out, and
  // a form posted around the calendar is refused the same way.
  if (picked?.iso && dayClosed(kinshasaDayKey(picked.iso), await getListingAvailability(listing.id))) {
    redirect(`${base}?visit_error=closed`);
  }

  try {
    const { lead } = await createLead({
      waId: phone,
      name: name || null,
      source: 'listing-visit-request',
      propertyId: listing.id,
      assignedAgent: listing.agency_name || null,
      requirementsSummary: `Demande de visite — créneau souhaité : ${requestedTime}`,
    });
    await createViewingRequest({ leadId: lead.id, propertyId: listing.id, requestedTime, preferredSlotAt: picked?.iso || null });
  } catch (err) {
    console.error(`[listings/${propertyId}] visit request failed: ${err.message}`);
    redirect(`${base}?visit_error=1`);
  }

  redirect(`${base}?visit_sent=1`);
}
