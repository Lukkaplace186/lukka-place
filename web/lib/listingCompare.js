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
  const firstPhotos = new Set(photoSet(first));
  return listings.map((listing, index) => {
    if (index === 0) return { same: [], sharedPhotos: [] };
    return {
      same: COMPARE_FIELDS.filter((field) => sameValue(first, listing, field)),
      sharedPhotos: photoSet(listing).filter((src) => firstPhotos.has(src)),
    };
  });
}

/** `/admin/listings/compare?ids=…` for a listing and the listings its flag points at. */
export function compareHref(id, others) {
  const ids = [id, ...(others || [])].filter((n) => Number.isInteger(Number(n)) && Number(n) > 0);
  return `/admin/listings/compare?ids=${[...new Set(ids.map(Number))].join(',')}`;
}
