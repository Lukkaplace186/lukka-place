'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { confirmListingAvailable } from '@/lib/listingAvailability';
import { getT } from '@/lib/i18n/server';
import { updateListingPriceAction } from './actions';

/**
 * "Toujours disponible ?" — two of the three one-tap answers. The third,
 * "Loué / vendu", is not here on purpose: the prompt opens the existing
 * MarkListingSoldDialog, so a closed listing still requires a real price and
 * date through markListingSoldAction, the only path to 'closed'.
 *
 * Both return {ok, error?} for an imperative call from the prompt card.
 */

/**
 * The badge lives on the public detail page, the prompt on Mes biens, the
 * overview (to-do list) and the listing's editor. The detail page is dynamic
 * (it reads the locale cookie), so this is about the client router cache: a
 * confirm must show up on the next visit, not after a hard reload.
 */
function revalidateAvailabilitySurfaces(propertyId) {
  revalidatePath('/compte/agent');
  revalidatePath('/compte/agent/biens');
  revalidatePath(`/compte/agent/biens/${propertyId}/edit`);
  revalidatePath(`/listings/${propertyId}`);
}

function refusal(t, reason) {
  return {
    ok: false,
    error: reason === 'unavailable'
      ? t('agent.availability.errors.unavailable')
      : t('errors.listingNotFoundOrNotYours'),
  };
}

/** "Toujours disponible": stamp availability_confirmed_at = NOW(). */
export async function confirmListingAvailableAction(propertyId) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.availability.errors.session') };

  const result = await confirmListingAvailable(agentId, propertyId);
  if (!result.ok) return refusal(t, result.reason);

  revalidateAvailabilitySurfaces(propertyId);
  return { ok: true, confirmedAt: result.confirmedAt };
}

/**
 * "Prix modifié": the new price goes through updateListingPriceAction — the
 * same validation, FC→USD conversion, ownership check and revalidation the
 * Mes biens price cell uses — and only once it is written is the listing
 * stamped as confirmed. A refused price confirms nothing.
 */
export async function confirmListingPriceChangedAction(propertyId, formData) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, error: t('agent.availability.errors.session') };

  const priced = await updateListingPriceAction(propertyId, formData);
  if (!priced?.ok) return priced;

  const result = await confirmListingAvailable(agentId, propertyId);
  if (!result.ok) {
    // The price IS saved; only the stamp failed (column not migrated yet, or
    // the listing left the live set in between). Say so rather than
    // reporting the whole answer as a failure.
    return { ok: true, price: priced.price, confirmed: false };
  }

  revalidateAvailabilitySurfaces(propertyId);
  return { ok: true, price: priced.price, confirmed: true, confirmedAt: result.confirmedAt };
}
