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
import { createLead } from '@/lib/adminApi';
import { buildRequirementsSummary } from '@/lib/customerPortal';

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
 * The engine's POST /admin/leads accepts `requirements_summary` but not the
 * structured `transaction_type`/`commune`/`price_min`/`price_max`/`bedrooms`
 * columns, so the form's real values are composed into one readable summary
 * string (buildRequirementsSummary) rather than silently dropped.
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
    return { status: 'error', message: 'Choisissez d’abord si vous souhaitez acheter ou louer.' };
  }
  if (communes.length === 0) {
    return { status: 'error', message: 'Sélectionnez au moins une commune.' };
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

  try {
    await createLead({
      waId: customer.phone,
      name: customer.full_name || null,
      source: 'espace-client-request',
      requirementsSummary,
    });
  } catch (error) {
    console.warn('[compte/client] submitPropertyRequestAction failed:', error.message);
    return {
      status: 'error',
      message: "Votre demande n'a pas pu être envoyée. Réessayez dans un instant.",
    };
  }

  revalidatePath('/compte/client/demandes');
  revalidatePath('/compte/client/messages');
  revalidatePath('/compte/client');
  revalidatePath('/compte/demandes');

  return { status: 'success', message: 'Votre demande a été transmise aux agences partenaires.' };
}
