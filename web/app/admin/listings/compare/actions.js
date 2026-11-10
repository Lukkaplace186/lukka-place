'use server';

import { revalidatePath } from 'next/cache';
import { notifyListingModeration } from '@/lib/adminApi';
import { recordAudit } from '@/lib/adminAudit';
import { adminSetListingVisible } from '@/lib/adminListings';
import { requireAdmin } from '@/lib/adminSession';

/**
 * Take a live copy offline because the same agent has the same property
 * online twice (owner decision 2026-11-10). It is the reversible "hidden"
 * state Suspendre uses (status 0 + archived_at, approval kept), so nothing
 * is lost; the agent is told which listing stays (engine
 * MODERATION_MESSAGES.withdrawn_duplicate). Notifying is best effort.
 */
export async function withdrawDuplicateAction({ id, keepId }) {
  try {
    const session = await requireAdmin('listings.moderate');
    const listingId = Number.parseInt(id, 10);
    const keep = Number.parseInt(keepId, 10);
    if (!Number.isInteger(listingId) || listingId <= 0) return { ok: false, error: 'Annonce inconnue.' };
    if (!Number.isInteger(keep) || keep <= 0 || keep === listingId) {
      return { ok: false, error: 'Indiquez l’annonce qui reste en ligne.' };
    }
    if (!(await adminSetListingVisible(listingId, false))) return { ok: false, error: `Annonce #${listingId} introuvable.` };
    await recordAudit(session, {
      action: 'listing.withdraw_duplicate',
      entityType: 'listing',
      entityId: listingId,
      details: { keepId: keep },
    });
    try {
      await notifyListingModeration(listingId, 'withdrawn_duplicate', { keepId: keep });
    } catch (err) {
      console.error(`[admin/listings] duplicate withdrawal notify for #${listingId} failed: ${err.message}`);
    }
    revalidatePath('/admin/listings');
    revalidatePath(`/admin/listings/${listingId}`);
    revalidatePath(`/listings/${listingId}`);
    revalidatePath('/listings');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "L'action a échoué." };
  }
}
