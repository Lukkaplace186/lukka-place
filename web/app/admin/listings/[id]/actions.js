'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { adminUpdateListing, adminSetListingVisible } from '@/lib/adminListings';

/** Same defense-in-depth pattern as every other admin write path. */
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

const LISTING_STATUSES = ['active', 'under_offer', 'closed'];
const PURPOSES = ['rent', 'sale'];
const CURRENCIES = ['USD', 'CDF'];
const PRICE_PERIODS = ['month', 'year', 'day', ''];

/** '' -> null, so clearing a field in the form genuinely clears the column. */
function text(formData, name, max = 300) {
  const value = formData.get(name);
  if (value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function int(formData, name) {
  const value = formData.get(name);
  if (value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(formData, name) {
  const value = formData.get(name);
  if (value === null) return undefined;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Granular metadata override on any listing — the "edit anything" the admin
 * console was missing entirely. Until now a moderator could only approve or
 * reject: a listing with a typo'd price or a missing commune had to be
 * rejected outright and re-submitted by the agent over WhatsApp.
 *
 * Every enum is validated against a real allow-list, and the commune against
 * the real canonical list passed in from the page (bound at render time from
 * the engine's own hierarchy, same pattern createListingAction uses) — an
 * admin session is powerful, but it still must not be able to write a
 * commune that doesn't exist and silently break the map, the filters and the
 * lead matcher at once.
 *
 * `sold_price` / `sold_at` are editable here on purpose: the market export is
 * a commercial product, and a mistyped final price is exactly the kind of
 * thing that has to be correctable by someone other than the agent who typed
 * it. They are only accepted alongside `listing_status = 'closed'` — a sale
 * price on an active listing would be a contradiction the export would
 * happily publish.
 */
export async function adminUpdateListingAction(propertyId, validCommunes, validCategoryIds, formData) {
  try {
    await assertAdminSession();

    const listingStatus = String(formData.get('listing_status') || '');
    if (listingStatus && !LISTING_STATUSES.includes(listingStatus)) {
      return { ok: false, error: `Statut invalide : ${listingStatus}` };
    }

    const purpose = String(formData.get('purpose') || '');
    if (purpose && !PURPOSES.includes(purpose)) return { ok: false, error: 'Transaction invalide.' };

    const currency = String(formData.get('currency') || '');
    if (currency && !CURRENCIES.includes(currency)) return { ok: false, error: 'Devise invalide.' };

    const pricePeriod = String(formData.get('price_period') || '');
    if (!PRICE_PERIODS.includes(pricePeriod)) return { ok: false, error: 'Périodicité invalide.' };

    const commune = text(formData, 'commune', 60);
    if (commune && !validCommunes.includes(commune)) return { ok: false, error: 'Commune invalide.' };

    const categoryId = int(formData, 'category_id');
    if (categoryId != null && !validCategoryIds.includes(categoryId)) {
      return { ok: false, error: 'Type de bien invalide.' };
    }

    const price = decimal(formData, 'price');
    if (price != null && price <= 0) return { ok: false, error: 'Le prix doit être supérieur à zéro.' };

    const soldPrice = decimal(formData, 'sold_price');
    const soldAt = text(formData, 'sold_at', 10);
    if ((soldPrice != null || soldAt != null) && listingStatus !== 'closed') {
      return {
        ok: false,
        error: 'Un prix ou une date de transaction ne peut être enregistré que sur un bien « Loué / Vendu ».',
      };
    }
    if (soldAt && Number.isNaN(new Date(`${soldAt}T12:00:00Z`).getTime())) {
      return { ok: false, error: 'Date de transaction invalide.' };
    }

    const updated = await adminUpdateListing(propertyId, {
      title: text(formData, 'title', 150),
      description: text(formData, 'description', 4000),
      commune,
      quartier: text(formData, 'quartier', 120),
      reference: text(formData, 'reference', 60),
      parcelleSubtype: text(formData, 'parcelle_subtype', 60),
      purpose: purpose || undefined,
      currency: currency || undefined,
      pricePeriod: pricePeriod || null,
      categoryId,
      price,
      priceOriginal: decimal(formData, 'price_original'),
      beds: int(formData, 'beds'),
      bath: int(formData, 'bath'),
      // `area` is TEXT and stores '0' for unknown (CLAUDE.md's own gotcha) —
      // a cleared field becomes NULL here rather than '0', so nothing
      // downstream reads it back as a real 0 m² measurement.
      area: (() => {
        const value = int(formData, 'area');
        return value === undefined ? undefined : value == null ? null : String(value);
      })(),
      unitsCount: int(formData, 'units_count'),
      depositMonths: int(formData, 'deposit_months'),
      listingStatus: listingStatus || undefined,
      soldPrice: listingStatus === 'closed' ? soldPrice : null,
      soldAt: listingStatus === 'closed' ? soldAt : null,
      latitude: text(formData, 'latitude', 32),
      longitude: text(formData, 'longitude', 32),
    });

    if (!updated) return { ok: false, error: 'Annonce introuvable.' };

    revalidatePath('/admin/listings');
    revalidatePath(`/admin/listings/${propertyId}`);
    revalidatePath(`/listings/${propertyId}`);
    revalidatePath('/listings');
    return { ok: true };
  } catch (err) {
    console.error(`[admin/listings] update #${propertyId} failed: ${err.message}`);
    return { ok: false, error: err.message || 'La mise à jour a échoué.' };
  }
}

/**
 * Suspend / restore — take an approved listing off the public site without
 * rejecting it.
 *
 * Distinct from Rejeter on purpose. Rejection is a moderation verdict that
 * notifies the agent their listing was refused; suspension is an operational
 * action ("this is under dispute", "the photos are someone else's", "the
 * owner asked us to pause it") that leaves approval intact and is reversible
 * in one click. Conflating them meant every temporary problem had to be
 * handled by telling an agent their listing was rejected.
 */
export async function adminSetListingVisibleAction(propertyId, visible) {
  try {
    await assertAdminSession();
    const ok = await adminSetListingVisible(propertyId, visible);
    if (!ok) return { ok: false, error: 'Annonce introuvable.' };
    revalidatePath('/admin/listings');
    revalidatePath(`/admin/listings/${propertyId}`);
    revalidatePath('/listings');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "L'action a échoué." };
  }
}
