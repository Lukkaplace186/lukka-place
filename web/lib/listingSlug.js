/**
 * A listing's public address with the words people search for in it:
 * /listings/509-appartement-1-chambre-a-louer-limete instead of /listings/509
 * (2026-11-10, SEO pass: mediacongo, which outranks us for "maison à louer à
 * Kinshasa", carries the words in every listing URL).
 *
 * - The id stays first and is the only part that is read back
 *   (lib/listings.js getListingById parses the leading integer), so a slug
 *   built from yesterday's facts, a truncated link or a bare /listings/509 all
 *   open the same page. The page declares the slug URL canonical; nothing
 *   redirects, because a redirect hop costs a Kinshasa phone ~330 ms and
 *   WhatsApp messages, dashboards and old shares all carry the bare id.
 * - Built only from the listing's structured facts (kind, rooms, rent/sale,
 *   commune), in French whatever the reader's language: one URL per listing,
 *   and these are the words searched in the DRC. Never the agent's free text.
 *   A fact that is missing is left out, never guessed.
 * - Pure, no dictionary: PropertyCard and the map previews are client
 *   components and must not pull fr.json into the bundle.
 *
 * Analytics are unaffected: ListingViewTracker records `/listings/<id>`
 * whatever the address, and listingIdFromPath (lib/analyticsClient.js) reads
 * either form.
 */

const SUBTYPE_WORDS = { villa: 'villa', maison_type_locataire: 'maison', terrain_nu: 'terrain' };
const PURPOSE_WORDS = { rent: 'a-louer', sale: 'a-vendre' };
const MAX_SLUG = 80;

/** "Kasa-Vubu, Bâtiment / Entrepôt" → "kasa-vubu-batiment-entrepot". */
export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function kindWord(listing) {
  return SUBTYPE_WORDS[listing?.parcelle_subtype] || slugify(listing?.category_name);
}

/** "appartement-1-chambre-a-louer-limete", or '' when no fact is known. */
export function listingSlug(listing) {
  if (!listing) return '';
  const beds = Number(listing.beds);
  const parts = [
    kindWord(listing),
    Number.isInteger(beds) && beds > 0 ? `${beds}-chambre${beds > 1 ? 's' : ''}` : '',
    PURPOSE_WORDS[listing.purpose] || '',
    slugify(listing.commune || listing.quartier || listing.city_name),
  ];
  let slug = slugify(parts.filter(Boolean).join('-'));
  if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG).replace(/-[^-]*$/, '');
  return slug;
}

/** "/listings/509-appartement-1-chambre-a-louer-limete" (or "/listings/509"). */
export function listingPath(listing) {
  const id = Number.parseInt(listing?.id, 10);
  if (!Number.isFinite(id)) return '/listings';
  const slug = listingSlug(listing);
  return slug ? `/listings/${id}-${slug}` : `/listings/${id}`;
}

/** The URL segment of a listing page: "509" or "509-appartement-…". */
export const LISTING_SEGMENT = /^\d{1,18}(?:-[a-z0-9-]*)?$/;
