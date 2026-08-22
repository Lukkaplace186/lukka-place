import { PARCELLE_SUBTYPES } from './constants';

/**
 * Derived view values shared by the three listing card designs.
 *
 * The cards stay separate components on purpose (see web/CLAUDE.md — they're
 * tuned for different contexts), but they were each re-deriving the same
 * things from the same raw DB row: which images to show, whether a listing
 * is new, how to phrase the spec line. That duplication is how the
 * "Just Added" / "Nouveau" split happened — the same condition rendered in
 * two languages in two files. One source of truth fixes that class of bug.
 *
 * Everything here reads real columns only. Nothing is inferred or invented.
 */

const PARCELLE_SUBTYPE_LABELS = Object.fromEntries(
  PARCELLE_SUBTYPES.map(({ value, label }) => [value, label]),
);

const NEW_WINDOW_DAYS = 14;

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** featured_image first, then the rest of the gallery, de-duplicated. */
export function listingImages(listing) {
  const gallery = listing.gallery || [];
  const featured = listing.featured_image;
  return featured ? [featured, ...gallery.filter((src) => src !== featured)] : gallery;
}

export function isNewListing(createdAt) {
  if (!createdAt) return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs >= 0 && ageMs <= NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function formatAddedOn(createdAt) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

/**
 * `area` is a TEXT column and carries '0' rather than NULL when unknown, so
 * a naive render produces "0 m²" on a listing whose surface nobody recorded.
 */
export function hasArea(area) {
  return Number(area) > 0;
}

/** The parcelle sub-type when there is one, otherwise the real category. */
export function typeLabel(listing) {
  return PARCELLE_SUBTYPE_LABELS[listing.parcelle_subtype] || listing.category_name || null;
}

/**
 * Spec items as structured pairs rather than a pre-joined string, so each
 * card can choose its own separator (hairline dividers, icons, or pipes).
 */
export function specItems(listing) {
  const items = [];
  if (listing.beds != null) items.push({ key: 'beds', value: listing.beds, label: 'ch' });
  if (listing.bath != null) items.push({ key: 'bath', value: listing.bath, label: 'sdb' });
  if (hasArea(listing.area)) items.push({ key: 'area', value: listing.area, label: 'm²' });
  if (listing.units_count != null) items.push({ key: 'units', value: listing.units_count, label: 'portes' });
  return items;
}

/** "Quartier, Commune", falling back to the free-text address. */
export function locationLine(listing) {
  const parts = [listing.quartier, listing.commune].filter(Boolean);
  return parts.length ? parts.join(', ') : listing.address || null;
}

/**
 * "{quartier}, {commune}" for the feed cards' compact location row —
 * quartier-first, comma-separated: the neighbourhood is the more useful,
 * hyper-local signal for someone navigating Kinshasa, and commune (a
 * broader administrative division) is the secondary confirmation, not the
 * headline. Falls back to the free-text address when both are absent, same
 * as locationLine() — real, not optional:
 * `quartier` (dedicated column) and `commune` (amenity tag) were both
 * added 2026-08-15 (see services/postgres.js's buildPropertyValues doc
 * comment, engine repo) and were never backfilled onto listings synced
 * before that, so a meaningful share of real, currently-live listings have
 * both null while still carrying a real address string. Without this
 * fallback those cards would show no location line at all — confirmed
 * directly against the live site, not a hypothetical. Renders whichever
 * half is present when both structured fields exist; the separator only
 * appears when both do, so there's never a dangling ", " or trailing comma.
 *
 * The address fallback gets the same comma treatment (it's already stored
 * comma-separated) plus one real cleanup: the engine always appends a
 * literal ", Kinshasa" when building this address (buildAddress(),
 * services/postgres.js), so a listing whose commune genuinely IS
 * "Kinshasa" ends up with a doubled "..., Kinshasa, Kinshasa" — confirmed
 * directly against a real live listing, not a hypothetical. Collapsed to
 * one "Kinshasa" rather than shown verbatim. It's also naturally
 * quartier-first already, since that's the order buildAddress() writes it
 * in — the structured branch above matches that ordering on purpose rather
 * than disagreeing with its own fallback.
 *
 * The structured branch also ends in ", Kinshasa" now, matching the
 * fallback's own trailing city — every listing on this platform genuinely
 * is in Kinshasa (there is no other city here), so this is a true constant,
 * not an invented one, and it's what lets the two branches read as one
 * consistent hierarchy instead of the fallback alone naming the city. Same
 * dedup guard as the fallback: a commune literally named "Kinshasa" does
 * not get a second one appended.
 */
export function feedLocationLine(listing) {
  const parts = [listing.quartier, listing.commune].filter(Boolean);
  if (parts.length) {
    if (listing.commune && /^kinshasa$/i.test(listing.commune.trim())) return parts.join(', ');
    return [...parts, 'Kinshasa'].join(', ');
  }
  if (!listing.address) return null;
  const deduped = listing.address.replace(/,\s*Kinshasa\s*,\s*Kinshasa$/i, ', Kinshasa');
  return deduped.split(',').map((s) => s.trim()).filter(Boolean).join(', ');
}

/**
 * Description snippet for a result card. The DB guarantees a non-null
 * description of at least 15 characters, so there is no empty case to
 * design around — but collapse whitespace, since these are transcribed from
 * WhatsApp messages and carry hard line breaks.
 */
export function descriptionSnippet(description, maxLength = 180) {
  if (!description) return null;
  const flat = description.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  if (flat.length <= maxLength) return flat;
  return flat.slice(0, maxLength).replace(/\s+\S*$/, '') + '…';
}
