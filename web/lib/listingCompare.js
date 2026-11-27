/**
 * What the duplicate comparison marks as "same as the listing you came from"
 * (/admin/listings/compare). Pure, no DB: the page reads the rows, this says
 * which facts match the first one and which photos they share.
 *
 * Matching is literal on purpose. A moderator decides; "same" only ever means
 * the stored values are equal (text compared ignoring case and spaces at the
 * ends), never a guess that two different values describe the same place.
 */

export const COMPARE_FIELDS = ['title', 'price', 'reference', 'commune', 'quartier', 'beds', 'agent'];

function norm(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text === '' ? null : text;
}

function fieldValue(listing, field) {
  if (field === 'agent') return listing.agent_id ?? null;
  if (field === 'price') return listing.price == null ? null : `${Number(listing.price)}|${listing.purpose || ''}|${listing.price_period || ''}`;
  return listing[field];
}

/** True when both have a value and the values are equal; two blanks are not "the same". */
export function sameValue(a, b, field) {
  const left = norm(fieldValue(a, field));
  const right = norm(fieldValue(b, field));
  return left !== null && left === right;
}

/**
 * The content fingerprint in a stored photo's name: the engine names a
 * WhatsApp photo `whatsapp_<md5[0:13]>` of its bytes (services/supabaseStorage.js),
 * web an agent upload `agent_<md5[0:13]>` (lib/listingStorage.js). The same
 * photo on two listings has the same fingerprint, while the full URL always
 * differs (it carries the listing id). Engine twin: services/resendGuard.js.
 */
export const PHOTO_FINGERPRINT_PATTERN = '(?:whatsapp|agent)_([0-9a-f]{13})';
const FINGERPRINT = new RegExp(PHOTO_FINGERPRINT_PATTERN);

/** What makes two photos "the same file": the fingerprint, else the URL itself. */
export function photoKey(src) {
  const match = typeof src === 'string' ? src.match(FINGERPRINT) : null;
  return match ? `fp:${match[1]}` : String(src || '').trim();
}

/** The photo URLs a listing shows: featured first, then the gallery, no repeats. */
export function photoSet(listing) {
  const out = [];
  for (const src of [listing.featured_image, ...(listing.gallery || [])]) {
    if (typeof src !== 'string') continue;
    const value = src.trim();
    if (!value || value.includes('noimage') || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

/**
 * For every listing after the first: the fields equal to the first's and the
 * photos it shares with it. The first gets an empty result (it is the reference).
 *
 * @returns {Array<{ same: string[], sharedPhotos: string[] }>}
 */
export function compareToFirst(listings) {
  if (!listings.length) return [];
  const [first] = listings;
  const firstPhotos = new Set(photoSet(first).map(photoKey));
  return listings.map((listing, index) => {
    if (index === 0) return { same: [], sharedPhotos: [] };
    return {
      same: COMPARE_FIELDS.filter((field) => sameValue(first, listing, field)),
      sharedPhotos: photoSet(listing).filter((src) => firstPhotos.has(photoKey(src))),
    };
  });
}

/**
 * The photos to show on a compare card, the ones in `sharedKeys` first, so a
 * shared photo is never hidden past the few thumbnails a card shows
 * (2026-11-25: #1429's one photo in common with #1408 was its 8th of 11).
 */
export function photosSharedFirst(photos, sharedKeys) {
  const shared = photos.filter((src) => sharedKeys.has(photoKey(src)));
  return [...shared, ...photos.filter((src) => !sharedKeys.has(photoKey(src)))];
}

/**
 * "Same" on the place: the quartier must match, or both have none and the
 * commune matches. A commune alone is not the same place — on 2026-11-25
 * GB and Macampagne, both in Ngaliema, were marked "Same".
 */
export function samePlace(mark, first, listing) {
  if (mark.same.includes('quartier')) return true;
  return mark.same.includes('commune') && !norm(first.quartier) && !norm(listing.quartier);
}

/** `/admin/listings/compare?ids=…` for a listing and the listings its flag points at. */
export function compareHref(id, others) {
  const ids = [id, ...(others || [])].filter((n) => Number.isInteger(Number(n)) && Number(n) > 0);
  return `/admin/listings/compare?ids=${[...new Set(ids.map(Number))].join(',')}`;
}
