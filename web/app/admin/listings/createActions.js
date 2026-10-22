'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { can } from '@/lib/adminRoles';
import { adminUpdateListing, getListingForAdmin, getCategoriesForAdmin } from '@/lib/adminListings';
import { createListing, setListingGallery, attachListingPhotos } from '@/lib/agentListings';
import { uploadListingPhoto } from '@/lib/listingStorage';
import { getAgentById } from '@/lib/agents';
import { getPool } from '@/lib/db';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { validatePhotoSelection } from '@/lib/uploadLimits.mjs';
import { getT } from '@/lib/i18n/server';
import { normaliseArea } from '@/lib/listingView';
import { NO_PHOTO_URL } from '@/lib/constants';
import { approveListingAction } from './actions';

const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_MIME = Object.keys(PHOTO_TYPES);
const CURRENCIES = ['USD', 'CDF'];
const PERIODS = ['mois', 'an', 'jour', 'semaine'];

function photosFrom(formData) {
  return formData.getAll('photos').filter((f) => f && typeof f !== 'string' && f.size > 0);
}

async function uploadAll(files, propertyId) {
  const urls = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    urls.push(await uploadListingPhoto(buffer, propertyId, PHOTO_TYPES[file.type]));
  }
  return urls;
}

function intOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * "Créer une annonce" from the console — a listing typed by the team, on
 * behalf of an agent or of nobody (central contact). Same write path as the
 * agent's own form (lib/agentListings.js createListing: city from the commune,
 * commune amenity from location_communes, approve_status 0), and the same
 * lists the form was built from are re-read here, never trusted from the
 * browser. "Publier directement" then runs the moderator's own approval,
 * with its publish checks, and only for a role that may moderate.
 */
export async function adminCreateListingAction(formData) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('listings.edit');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const title = String(formData.get('title') || '').trim().slice(0, 150);
  const description = String(formData.get('description') || '').trim().slice(0, 4000);
  const purpose = String(formData.get('purpose') || '');
  const commune = String(formData.get('commune') || '');
  const categoryId = Number.parseInt(formData.get('category_id'), 10);
  const price = Number.parseFloat(formData.get('price'));
  const currency = String(formData.get('currency') || 'USD');
  const pricePeriod = String(formData.get('price_period') || '');
  const beds = intOrNull(formData.get('beds'));
  const bath = intOrNull(formData.get('bath'));
  const area = normaliseArea(formData.get('area'));
  const quartier = String(formData.get('quartier') || '').trim().slice(0, 160) || null;
  const reference = String(formData.get('reference') || '').trim().slice(0, 120) || null;
  const agentIdRaw = String(formData.get('agent_id') || '').trim();
  const publishNow = formData.get('publish_now') === 'on';
  const photos = photosFrom(formData);

  if (!title) return { ok: false, error: t('errors.titleRequired') };
  if (description.length < 15) return { ok: false, error: t('errors.descriptionTooShort') };
  if (!['rent', 'sale'].includes(purpose)) return { ok: false, error: t('errors.chooseRentOrSale') };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: t('errors.invalidPrice') };
  if (!CURRENCIES.includes(currency)) return { ok: false, error: t('errors.invalidPrice') };
  if ([beds, bath].some((n) => Number.isNaN(n))) return { ok: false, error: t('errors.invalidBedrooms') };
  if (Number.isNaN(area)) return { ok: false, error: t('errors.invalidArea') };
  if (!photos.length) return { ok: false, error: t('errors.addAtLeastOnePhoto') };
  const photoProblem = validatePhotoSelection(photos, { allowedTypes: PHOTO_MIME });
  if (photoProblem) return { ok: false, error: t(photoProblem.key, photoProblem.vars) };

  const [{ communes }, categories] = await Promise.all([
    getLocationHierarchyWithFallback({ city: 'all' }),
    getCategoriesForAdmin(),
  ]);
  if (!communes.includes(commune)) return { ok: false, error: t('errors.invalidCommune') };
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return { ok: false, error: t('errors.invalidPropertyType') };

  let agent = null;
  if (agentIdRaw) {
    agent = await getAgentById(Number.parseInt(agentIdRaw, 10));
    if (!agent) return { ok: false, error: t('errors.agentNotFound') };
  }

  let propertyId;
  try {
    propertyId = await createListing({
      agentId: agent ? Number(agent.id) : null,
      vendorId: agent?.vendor_id || 0,
      category,
      title,
      description,
      commune,
      price,
      purpose,
      beds: category.type === 'commercial' ? null : beds,
      bath,
      area,
      quartier,
      reference,
    });
  } catch (err) {
    console.error(`[admin/listings] create failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }

  // Currency and period are not part of createListing's insert; set them the
  // way the editor does. A failure here leaves a USD / monthly listing the
  // team can correct in the editor, so it is reported, not fatal.
  const extra = {};
  if (currency !== 'USD') extra.currency = currency;
  if (PERIODS.includes(pricePeriod)) extra.pricePeriod = pricePeriod;
  if (Object.keys(extra).length) {
    try {
      await adminUpdateListing(propertyId, extra);
    } catch (err) {
      console.error(`[admin/listings] #${propertyId} currency/period not saved: ${err.message}`);
    }
  }

  let uploaded = 0;
  try {
    const urls = await uploadAll(photos, propertyId);
    uploaded = urls.length;
    await attachListingPhotos(propertyId, urls);
  } catch (err) {
    console.error(`[admin/listings] photo upload failed for new listing #${propertyId}: ${err.message}`);
  }

  await recordAudit(session, {
    action: 'listing.create',
    entityType: 'listing',
    entityId: propertyId,
    details: { agentId: agent ? Number(agent.id) : null, categoryId, purpose, commune, photos: uploaded, publishNow },
  });

  let published = false;
  let publishError = null;
  if (publishNow && can(session.role, 'listings.moderate')) {
    try {
      await approveListingAction(propertyId);
      published = true;
    } catch (err) {
      publishError = err.message;
    }
  }

  revalidatePath('/admin/listings');
  return { ok: true, propertyId, published, publishError, photoWarning: uploaded < photos.length };
}

/**
 * New photos for a listing, from the console editor. Appended after the
 * gallery already there (the cover stays the cover); the editor's own photo
 * manager then reorders or removes them.
 */
export async function adminAddListingPhotosAction(propertyId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('listings.edit');
    const listing = await getListingForAdmin(propertyId);
    if (!listing) return { ok: false, error: t('errors.listingNotFound') };

    const existing = (listing.gallery && listing.gallery.length ? listing.gallery : [listing.featured_image])
      .filter((url) => url && url !== NO_PHOTO_URL);
    const photos = photosFrom(formData);
    if (!photos.length) return { ok: false, error: t('errors.addAtLeastOnePhoto') };
    const problem = validatePhotoSelection(photos, { keptCount: existing.length, allowedTypes: PHOTO_MIME });
    if (problem) return { ok: false, error: t(problem.key, problem.vars) };

    const urls = await uploadAll(photos, listing.id);
    const gallery = [...new Set([...existing, ...urls])];
    await setListingGallery(listing.id, gallery);
    await recordAudit(session, {
      action: 'listing.gallery',
      entityType: 'listing',
      entityId: listing.id,
      details: { added: urls.length, before: existing.length },
    });
    revalidatePath(`/admin/listings/${listing.id}`);
    revalidatePath(`/listings/${listing.id}`);
    return { ok: true, added: urls.length, gallery, message: t('admin.listings.photosAdded', { count: urls.length }) };
  } catch (err) {
    console.error(`[admin/listings] add photos to #${propertyId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/**
 * Attach a listing to an agent, or detach it (agentId null) — from the
 * listing's own page in the console. The agent must exist and not be deleted;
 * the listing follows the agent's agency (vendor_id) so plan counting and the
 * agency's roster agree. The public page shows the agent's number only under
 * its usual rule (verified, direct routing on), which this does not change.
 */
export async function adminAssignListingAgentAction(propertyId, agentId) {
  const t = await getT();
  try {
    const session = await requireAdmin('listings.edit');
    const listing = await getListingForAdmin(propertyId);
    if (!listing) return { ok: false, error: t('errors.listingNotFound') };

    let agent = null;
    if (agentId != null && agentId !== '') {
      agent = await getAgentById(Number.parseInt(agentId, 10));
      if (!agent) return { ok: false, error: t('errors.agentNotFound') };
    }
    const nextId = agent ? Number(agent.id) : null;
    if ((listing.agent_id ?? null) === nextId) return { ok: true, message: t('admin.listings.agentUnchanged') };

    const pool = getPool();
    await pool.query('UPDATE properties SET agent_id = $1, vendor_id = $2, updated_at = NOW() WHERE id = $3', [
      nextId,
      agent?.vendor_id || 0,
      listing.id,
    ]);
    await recordAudit(session, {
      action: 'listing.assign_agent',
      entityType: 'listing',
      entityId: listing.id,
      details: { from: listing.agent_id ?? null, to: nextId },
    });
    revalidatePath(`/admin/listings/${listing.id}`);
    revalidatePath(`/listings/${listing.id}`);
    revalidatePath('/admin/listings');
    if (nextId) revalidatePath(`/admin/agents/${nextId}`);
    return { ok: true, message: nextId ? t('admin.listings.agentAssigned') : t('admin.listings.agentRemoved') };
  } catch (err) {
    console.error(`[admin/listings] assign agent on #${propertyId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
