'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { adminUpdateListing, adminSetListingVisible, getListingForAdmin } from '@/lib/adminListings';
import { setListingGallery } from '@/lib/agentListings';
import { getT } from '@/lib/i18n/server';

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
 * Granular metadata override on any listing. Every enum is validated against a
 * real allow-list, the commune against the canonical list bound at render time,
 * and sold figures are only accepted with `listing_status = 'closed'`.
 */
export async function adminUpdateListingAction(propertyId, validCommunes, validCategoryIds, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('listings.edit');

    const listingStatus = String(formData.get('listing_status') || '');
    if (listingStatus && !LISTING_STATUSES.includes(listingStatus)) {
      return { ok: false, error: `Statut invalide : ${listingStatus}` };
    }

    const purpose = String(formData.get('purpose') || '');
    if (purpose && !PURPOSES.includes(purpose)) return { ok: false, error: t('errors.invalidTransaction') };

    const currency = String(formData.get('currency') || '');
    if (currency && !CURRENCIES.includes(currency)) return { ok: false, error: t('errors.invalidCurrency') };

    const pricePeriod = String(formData.get('price_period') || '');
    if (!PRICE_PERIODS.includes(pricePeriod)) return { ok: false, error: t('errors.invalidPeriodicity') };

    const commune = text(formData, 'commune', 60);
    if (commune && !validCommunes.includes(commune)) return { ok: false, error: t('errors.invalidCommune') };

    const categoryId = int(formData, 'category_id');
    if (categoryId != null && !validCategoryIds.includes(categoryId)) {
      return { ok: false, error: t('errors.invalidPropertyType') };
    }

    const price = decimal(formData, 'price');
    if (price != null && price <= 0) return { ok: false, error: t('errors.priceMustBePositive') };

    const soldPrice = decimal(formData, 'sold_price');
    const soldAt = text(formData, 'sold_at', 10);
    if ((soldPrice != null || soldAt != null) && listingStatus !== 'closed') {
      return { ok: false, error: t('errors.soldFieldsNeedClosedStatus') };
    }
    if (soldAt && Number.isNaN(new Date(`${soldAt}T12:00:00Z`).getTime())) {
      return { ok: false, error: t('errors.invalidTransactionDate') };
    }

    const before = await getListingForAdmin(propertyId);
    const patch = {
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
      // `area` is TEXT storing '0' for unknown — a cleared field becomes NULL, not '0'.
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
    };
    const updated = await adminUpdateListing(propertyId, patch);
    if (!updated) return { ok: false, error: t('errors.listingNotFound') };

    // Record which fields actually changed, with before/after for the ones an
    // audit is most often asked about (price, commune, status, sold figures).
    const tracked = { price: 'price', commune: 'commune', listingStatus: 'listing_status', soldPrice: 'sold_price', title: 'title' };
    const changes = {};
    for (const [key, column] of Object.entries(tracked)) {
      if (patch[key] === undefined || !before) continue;
      const was = before[column] == null ? null : String(before[column]);
      const now = patch[key] == null ? null : String(patch[key]);
      if (was !== now && !(was && now && Number(was) === Number(now))) changes[column] = { from: was, to: now };
    }
    await recordAudit(session, { action: 'listing.update', entityType: 'listing', entityId: propertyId, details: { changes } });

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

/** Suspend / restore — operational and reversible, distinct from a rejection. */
export async function adminSetListingVisibleAction(propertyId, visible) {
  const t = await getT();
  try {
    const session = await requireAdmin('listings.moderate');
    const ok = await adminSetListingVisible(propertyId, visible);
    if (!ok) return { ok: false, error: t('errors.listingNotFound') };
    await recordAudit(session, {
      action: visible ? 'listing.restore' : 'listing.suspend',
      entityType: 'listing',
      entityId: propertyId,
    });
    revalidatePath('/admin/listings');
    revalidatePath(`/admin/listings/${propertyId}`);
    revalidatePath('/listings');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || "L'action a échoué." };
  }
}

/**
 * Reorder, re-cover or remove a listing's photos. Only URLs ALREADY on this
 * listing are accepted — an admin session must not be a way to attach an
 * arbitrary image to someone's listing. Uploading new photos stays with the
 * agent's own editor, which owns the Storage pipeline.
 */
export async function adminSetListingGalleryAction(propertyId, urls) {
  const t = await getT();
  try {
    const session = await requireAdmin('listings.edit');
    const listing = await getListingForAdmin(propertyId);
    if (!listing) return { ok: false, error: t('errors.listingNotFound') };

    const current = new Set([listing.featured_image, ...(listing.gallery || [])].filter(Boolean));
    const next = [...new Set((urls || []).map(String))];
    const foreign = next.filter((url) => !current.has(url));
    if (foreign.length) return { ok: false, error: t('admin.photos.foreignUrl') };

    await setListingGallery(listing.id, next);
    await recordAudit(session, {
      action: 'listing.gallery',
      entityType: 'listing',
      entityId: propertyId,
      details: { before: (listing.gallery || []).length, after: next.length, coverChanged: next[0] !== listing.featured_image },
    });
    revalidatePath(`/admin/listings/${propertyId}`);
    revalidatePath(`/listings/${propertyId}`);
    revalidatePath('/admin/listings');
    return { ok: true, message: t('admin.photos.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
