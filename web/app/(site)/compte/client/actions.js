'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  getCurrentCustomerId,
  getCustomerById,
  removeFavorite,
  removeSavedSearch,
  updateCustomerName,
} from '@/lib/customers';
import { createLead, getLead, updateLeadRequirements } from '@/lib/adminApi';
import { buildRequirementsSummary } from '@/lib/customerPortal';
import { getT } from '@/lib/i18n/server';

/**
 * Server actions for the Espace Client portal.
 *
 * Every one of these resolves the customer id from the session cookie
 * itself (getCurrentCustomerId) and never from a form field — a
 * client-supplied id would let one customer mutate another's favorites,
 * searches or profile. Same non-negotiable binding rule the buyer
 * assistant's tool-calling layer follows (root CLAUDE.md).
 */

async function requireCustomerId() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client');
  return customerId;
}

export async function removeFavoriteAction(formData) {
  const customerId = await requireCustomerId();
  const propertyId = Number.parseInt(String(formData.get('propertyId') || ''), 10);
  if (!Number.isFinite(propertyId)) return;

  await removeFavorite(customerId, propertyId);
  // '/compte/client/favoris' is now just a redirect to '/compte/client'
  // (the merged Favoris & Alertes tab), so revalidating the real route is
  // what actually matters.
  revalidatePath('/compte/client');
  // The public /favoris page reads the same rows for a signed-in visitor.
  revalidatePath('/favoris');
}

export async function removeSavedSearchAction(formData) {
  const customerId = await requireCustomerId();
  const query = String(formData.get('query') || '');
  if (!query) return;

  await removeSavedSearch(customerId, query);
  // Same reasoning as above — '/compte/client/alertes' just redirects here now.
  revalidatePath('/compte/client');
  revalidatePath('/compte/alertes');
}

export async function updateProfileNameAction(formData) {
  const customerId = await requireCustomerId();
  const fullName = String(formData.get('fullName') || '').trim();

  await updateCustomerName(customerId, fullName);
  revalidatePath('/compte/client/parametres');
  revalidatePath('/compte/client');
  revalidatePath('/compte');
}

/**
 * "Soumettre une recherche" — a real lead written to the engine's `leads`
 * table through the same POST /admin/leads every other visitor-initiated
 * inquiry already uses (agent-profile inquiry form). It lands in the admin
 * conversations/leads dashboard exactly like any other lead, and comes back
 * to the customer through getCustomerInquiries() scoped to their own phone.
 *
 * POST /admin/leads now also accepts the structured
 * `transaction_type`/`commune`/`price_min`/`price_max`/`bedrooms` columns
 * (the matching engine needs real columns to rank on, not just prose) — the
 * full free-text summary (buildRequirementsSummary) is still sent too, so
 * nothing the customer typed is lost. The form collects multiple communes
 * (checkboxes); only the single `commune` TEXT column exists, so the first
 * selected commune becomes the structured value and the complete list stays
 * in the summary for a human reading it.
 *
 * `wa_id` is the authenticated customer's own stored phone — already in the
 * digits-only shape the engine validates (lib/customerInquiries.js's doc
 * comment confirms this), never a value typed into the form.
 *
 * Returns a plain object for useActionState rather than throwing: the
 * engine being unreachable should show the customer a real error and keep
 * their typed input, not a Next.js error page.
 */
export async function submitPropertyRequestAction(_prevState, formData) {
  const t = await getT();
  const customerId = await requireCustomerId();
  const customer = await getCustomerById(customerId);
  if (!customer) redirect('/compte/connexion?next=/compte/client/demandes');

  const transactionType = String(formData.get('transactionType') || '');
  const communes = formData.getAll('communes').map(String).filter(Boolean);
  const bedrooms = String(formData.get('bedrooms') || '');
  const budgetMin = String(formData.get('budgetMin') || '');
  const budgetMax = String(formData.get('budgetMax') || '');
  const movingDate = String(formData.get('movingDate') || '').trim();
  const flexibility = String(formData.get('flexibility') || '');
  const notes = String(formData.get('notes') || '').trim();

  if (!transactionType) {
    return { status: 'error', message: t('errors.chooseBuyOrRent') };
  }
  if (communes.length === 0) {
    return { status: 'error', message: t('errors.selectAtLeastOneCommune') };
  }

  const requirementsSummary = buildRequirementsSummary({
    transactionType,
    communes,
    bedrooms,
    budgetMin,
    budgetMax,
    movingDate,
    flexibility,
    notes,
  });

  const parsedBedrooms = Number.parseInt(bedrooms, 10);
  const parsedBudgetMin = Number.parseFloat(budgetMin);
  const parsedBudgetMax = Number.parseFloat(budgetMax);

  let leadId = null;
  try {
    const { lead } = await createLead({
      waId: customer.phone,
      name: customer.full_name || null,
      source: 'espace-client-request',
      requirementsSummary,
      transactionType,
      commune: communes[0],
      priceMin: Number.isFinite(parsedBudgetMin) ? parsedBudgetMin : null,
      priceMax: Number.isFinite(parsedBudgetMax) ? parsedBudgetMax : null,
      bedrooms: Number.isFinite(parsedBedrooms) ? parsedBedrooms : null,
    });
    leadId = lead?.id ?? null;
  } catch (error) {
    console.warn('[compte/client] submitPropertyRequestAction failed:', error.message);
    return {
      status: 'error',
      message: t('errors.requestNotSent'),
    };
  }

  revalidatePath('/compte/client/demandes');
  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client');
  revalidatePath('/compte/demandes');

  // Hand the customer straight to the tab that tracks what they just sent,
  // rather than leaving them on the form under a green banner. The request
  // has one real next state — agencies answering it — and that state lives
  // on Messages & Visites; an inline "sent!" on the form was a dead end that
  // said nothing about what happens next.
  //
  // `?submitted=<id>` is what makes it a real hand-off rather than a plain
  // navigation: the destination opens ON that thread and confirms it by
  // number (./messages/page.js), instead of defaulting to whatever happens
  // to sort first. It is only ever a display hint — every thread rendered
  // there is still resolved server-side from the session's own phone, so a
  // hand-edited id can select nothing it wasn't already allowed to see.
  //
  // Outside the try/catch on purpose: redirect() signals by throwing, and a
  // throw inside that block would be caught and reported as a send failure
  // for a lead that was in fact created.
  redirect(leadId ? `/compte/client/messages?submitted=${leadId}` : '/compte/client/messages');
}

/**
 * "Modifier ma recherche" — a customer editing the structured fields on
 * their own already-submitted lead (Messages & Visites detail panel).
 * `leadId` alone is never enough authorization: it's re-fetched from the
 * engine and its own `wa_id` is checked against this session's real
 * `customer.phone` before any write — the same non-negotiable
 * server-side-only binding rule every other action here follows (a
 * client-supplied leadId must never let one customer edit another's lead).
 *
 * Returns a plain {ok, error} result rather than throwing/redirecting — it's
 * called imperatively from EditPropertyRequestDialog via useTransition, same
 * contract as markListingSoldAction (web/app/compte/agent/actions.js).
 */
export async function updatePropertyRequestAction(leadId, formData) {
  const t = await getT();
  const customerId = await requireCustomerId();
  const customer = await getCustomerById(customerId);
  if (!customer) redirect('/compte/connexion?next=/compte/client/messages');

  const numericLeadId = Number.parseInt(leadId, 10);
  if (!Number.isFinite(numericLeadId)) {
    return { ok: false, error: t('errors.requestNotFound') };
  }

  let lead;
  try {
    ({ lead } = await getLead(numericLeadId));
  } catch (error) {
    return { ok: false, error: t('errors.requestNotFound') };
  }
  if (!lead || lead.wa_id !== customer.phone) {
    return { ok: false, error: t('errors.requestNotYours') };
  }

  const transactionType = String(formData.get('transactionType') || '');
  const commune = String(formData.get('commune') || '');
  const bedroomsRaw = String(formData.get('bedrooms') || '');
  const budgetMin = String(formData.get('budgetMin') || '');
  const budgetMax = String(formData.get('budgetMax') || '');
  const requirementsSummary = String(formData.get('requirementsSummary') || '').trim();

  if (!['vente', 'location'].includes(transactionType)) {
    return { ok: false, error: t('errors.chooseBuyOrRent') };
  }
  if (!commune) {
    return { ok: false, error: t('errors.selectACommune') };
  }

  const parsedBedrooms = Number.parseInt(bedroomsRaw, 10);
  const parsedBudgetMin = Number.parseFloat(budgetMin);
  const parsedBudgetMax = Number.parseFloat(budgetMax);
  if (Number.isFinite(parsedBudgetMin) && Number.isFinite(parsedBudgetMax) && parsedBudgetMin > parsedBudgetMax) {
    return { ok: false, error: t('errors.budgetMinAboveMax') };
  }

  let proposalsReset = false;
  try {
    // The engine decides `proposals_reset` itself — by comparing this
    // lead's stored commune against the one being written, never from
    // anything computed here — and clears every existing agent
    // pitch when it actually changed (routes/admin.js's PATCH /leads/:id,
    // services/db.js's resetLeadProposals): a proposal pitched by an agent
    // covering the old commune is no longer relevant once the request has
    // moved elsewhere.
    ({ proposals_reset: proposalsReset } = await updateLeadRequirements(numericLeadId, {
      transactionType,
      commune,
      priceMin: Number.isFinite(parsedBudgetMin) ? parsedBudgetMin : null,
      priceMax: Number.isFinite(parsedBudgetMax) ? parsedBudgetMax : null,
      bedrooms: Number.isFinite(parsedBedrooms) ? parsedBedrooms : null,
      requirementsSummary: requirementsSummary || null,
    }));
  } catch (error) {
    console.warn('[compte/client] updatePropertyRequestAction failed:', error.message);
    return { ok: false, error: t('errors.requestNotUpdated') };
  }

  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client/demandes');
  revalidatePath('/compte/client');

  return { ok: true, proposalsReset: Boolean(proposalsReset) };
}
