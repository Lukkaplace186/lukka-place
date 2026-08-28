import { PARCELLE_SUBTYPES, AMENITY_KEYWORDS } from './constants';
import { abbreviationVariants } from './textVariants';

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

export function formatAddedOn(createdAt) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FORMATTER.format(date);
}

// A listing counts as new for its first two weeks. Real `created_at`, and
// the same window app/(site)/agents/[id]/page.js's "Nouveautés" tab already
// filters on — defined here so the badge and that tab can never drift apart
// (exactly the class of bug this module's own doc comment describes).
const NEW_LISTING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isNewListing(createdAt) {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= NEW_LISTING_WINDOW_MS;
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
  // Same gotcha hasArea() exists for: bath can carry '' rather than a real
  // NULL, and '' != null is true, so a naive check rendered a bare "sdb"
  // with no number on any listing whose bathroom count was never recorded
  // — confirmed live on the homepage's "Derniers biens publiés" cards.
  if (Number(listing.bath) > 0) items.push({ key: 'bath', value: listing.bath, label: 'sdb' });
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

/**
 * Real match context for a listing card: finds the first place the current
 * free-text search term (or one of its known real spelling variants — see
 * lib/textVariants.js's abbreviationVariants, the exact same set the
 * server-side ILIKE fallback in lib/listings.js already searched with)
 * actually appears in *this listing's own* description, and returns the
 * real surrounding text with the match isolated so a card can highlight it.
 *
 * Returns null — render nothing — when this listing's description doesn't
 * actually contain the term. A listing can satisfy the page's overall
 * search via title/address/quartier/reference/commune instead of its
 * description (see lib/listings.js's free-text fallback, which checks all
 * of those); this must never imply a description match that isn't real.
 *
 * @param {string} description
 * @param {string} searchTerm
 * @param {number} [contextChars=40]
 * @returns {{before: string, match: string, after: string}|null}
 */
export function matchSnippet(description, searchTerm, contextChars = 40) {
  const term = typeof searchTerm === 'string' ? searchTerm.trim() : '';
  if (!description || !term) return null;

  const flat = description.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  const lower = flat.toLowerCase();

  let matchIndex = -1;
  let matchLength = 0;
  for (const candidate of abbreviationVariants(term)) {
    const idx = lower.indexOf(candidate.toLowerCase());
    if (idx !== -1) {
      matchIndex = idx;
      matchLength = candidate.length;
      break;
    }
  }
  if (matchIndex === -1) return null;

  const start = Math.max(0, matchIndex - contextChars);
  const end = Math.min(flat.length, matchIndex + matchLength + contextChars);

  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, matchIndex),
    match: flat.slice(matchIndex, matchIndex + matchLength),
    after: flat.slice(matchIndex + matchLength, end) + (end < flat.length ? '…' : ''),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Real amenity feature pills for a listing card — reuses AMENITY_KEYWORDS
 * (lib/constants.js), the exact same word-boundary keyword list the
 * "Plus de filtres" checkboxes already filter with server-side
 * (lib/listings.js's buildFilters). No structured amenity column exists on
 * `properties` (see web/CLAUDE.md's "No fabricated data" section), so this
 * is a real match against the listing's own title/description text, not an
 * invented flag — the same honesty posture the filter already uses, just
 * surfaced as a badge. A listing that has a feature but never mentioned it
 * in the text is a real false negative, same tradeoff the filter accepts.
 *
 * Capped at `max` (default 2) — a card photo has room for a couple of
 * pills, not the full eight-key list.
 */
export function matchedAmenityKeys(listing, max = 2) {
  const text = `${listing.title || ''} ${listing.description || ''}`;
  if (!text.trim()) return [];

  const matches = [];
  for (const key of Object.keys(AMENITY_KEYWORDS)) {
    const isMatch = AMENITY_KEYWORDS[key].some((keyword) => (
      new RegExp(`\\b${escapeRegex(keyword)}`, 'i').test(text)
    ));
    if (isMatch) matches.push(key);
    if (matches.length >= max) break;
  }
  return matches;
}
