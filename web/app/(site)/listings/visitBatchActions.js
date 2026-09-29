'use server';

import { phoneFromForm } from '@/lib/phone';
import { createViewingBatch } from '@/lib/adminApi';
import { getListingById } from '@/lib/listings';
import { VISIT_CART_MAX, validatePickedSlot } from '@/lib/visitSlots';
import { getT } from '@/lib/i18n/server';

/**
 * "Mes visites" (components/VisitCartSheet.js): up to four listings, one slot
 * each, sent in one go. Every listing is re-read under the public gate
 * (getListingById) and every slot re-checked (lib/visitSlots.js) — the cart
 * is the browser's claim. The engine creates one ordinary request per listing
 * and alerts each listing's own agent about their listing only; it refuses a
 * second batch from the same number within the hour (429).
 *
 * FormData: `name`, the phone pair PhoneField posts, and `items` — JSON
 * `[{ id, slot }]`.
 *
 * @returns {Promise<{ok: boolean, error?: string, requests?: {id: number, title: string, phrase: string}[]}>}
 */
export async function submitVisitBatchAction(formData) {
  const t = await getT();
  const name = String(formData.get('name') || '').trim().slice(0, 120);
  const phone = phoneFromForm(formData);
  if (!phone) return { ok: false, error: t('enquiry.cart.errors.phone') };

  let items;
  try {
    items = JSON.parse(String(formData.get('items') || '[]'));
  } catch {
    items = [];
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > VISIT_CART_MAX) {
    return { ok: false, error: t('enquiry.cart.errors.items', { max: VISIT_CART_MAX }) };
  }

  const now = new Date();
  const seen = new Set();
  const checked = [];
  for (const item of items) {
    const id = Number.parseInt(item?.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) return { ok: false, error: t('enquiry.cart.errors.items', { max: VISIT_CART_MAX }) };
    seen.add(id);
    const slot = validatePickedSlot(item?.slot, now);
    if (slot.error) return { ok: false, error: t('enquiry.cart.errors.slot') };
    const listing = await getListingById(id);
    if (!listing) return { ok: false, error: t('enquiry.cart.errors.gone'), goneId: id };
    checked.push({ listing, slot });
  }

  try {
    await createViewingBatch({
      waId: phone,
      name: name || null,
      items: checked.map(({ listing, slot }) => ({ propertyId: listing.id, preferredSlotAt: slot.iso, requestedTime: slot.phrase })),
    });
  } catch (err) {
    if (err?.status === 429) return { ok: false, error: t('enquiry.cart.errors.hour') };
    console.error(`[visit-batch] ${err.message}`);
    return { ok: false, error: t('enquiry.cart.errors.failed') };
  }

  return {
    ok: true,
    requests: checked.map(({ listing, slot }) => ({ id: listing.id, title: listing.title, phrase: slot.phrase })),
  };
}
