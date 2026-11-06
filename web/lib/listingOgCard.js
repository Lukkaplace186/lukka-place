import { formatPriceParts } from './format';
import { placeLabel } from './placeLabel';
import { specItems, typeLabel } from './listingView';
import { cityOfListing, communeLabel } from './cities';
import { roomSpecs } from './listingShareCopy';

/**
 * What the link preview card says about a listing (app/(site)/listings/[id]/
 * opengraph-image.js draws it) — the image WhatsApp, Facebook and X show when
 * somebody pastes a listing link. Pure, so tests/unit/listing-og-card.test.js
 * pins every line against real rows; `t` is passed in (always French: the
 * crawler sends no locale cookie, and the people the link is sent to read
 * the market's language).
 *
 * The layout follows the design canvas ("og:image — pleine photo"): the cover
 * photo full bleed, the white logo top-left, a dark capsule with the price and
 * "Appartement · 3 ch · 2 sdb" in the MIDDLE, a white box at the bottom with
 * the heading and, when the team verified the property, the badge.
 *
 * Why the capsule is centred: a chat app that shows only a small square
 * thumbnail keeps the CENTRE of the image (the middle 630×630), so the price
 * is placed where that crop still shows it; the logo and the heading may be
 * cut, and the app prints og:title beside the thumbnail anyway.
 *
 * Every line is a real field or it is left out: no specs line when no count is
 * stated, no badge without `verified_at`, "Prix sur demande" when there is no
 * usable price — never "0 $".
 */

export const OG_SIZE = Object.freeze({ width: 1200, height: 630 });

/** The bottom box holds two lines of the heading at 34px. */
export const OG_HEADING_MAX = 80;

/** A plain space: Plus Jakarta Sans draws U+202F / U+00A0 too narrow on a card. */
function plainSpaces(text) {
  return String(text ?? '').replace(/[  ]/g, ' ');
}

/** Cut at a word boundary with "…", like the card layouts' one-line wrap. */
export function clipHeading(text, max = OG_HEADING_MAX) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

/**
 * @param {object} listing  A lib/listings.js getListingById row.
 * @param {Function} t      A French translator.
 * @returns {{amount: string, period: string|null, purposeBadge: string|null, typeText: string|null,
 *            specs: Array<{icon: 'bed'|'bath'|'area'|'door', text: string}>, heading: string,
 *            eyebrow: string|null, verified: boolean, alt: string}}
 */
export function ogCardModel(listing, t) {
  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  const purpose = listing.purpose === 'rent'
    ? t('listings.transaction.rent')
    : listing.purpose === 'sale' ? t('listings.transaction.sale') : null;
  const typeText = typeLabel(listing, t) || null;

  // Two counts at most, beds and baths first: the capsule has to stay inside
  // the centre square a thumbnail keeps.
  const icons = { beds: 'bed', bath: 'bath', area: 'area', units: 'door' };
  const specs = specItems(listing, t)
    .filter((item) => icons[item.key])
    .slice(0, 2)
    .map((item) => ({ icon: icons[item.key], text: plainSpaces(`${item.value} ${item.label}`) }));

  // The listing page's own h1: "Appartement à louer — GB / Hôtel Diplomate, Ngaliema".
  const where = placeLabel(listing);
  const kindAndPurpose = [typeText, purpose ? purpose.toLowerCase() : null].filter(Boolean).join(' ');
  const heading = clipHeading(
    kindAndPurpose && where ? `${kindAndPurpose} — ${where}` : where || kindAndPurpose || listing.title || 'Lukka Place',
  );

  const city = cityOfListing(listing);
  const commune = listing.commune ? communeLabel(listing.commune) : null;
  const eyebrowParts = [commune, city].filter(Boolean);
  const eyebrow = eyebrowParts.length
    ? eyebrowParts.filter((part, i) => eyebrowParts.indexOf(part) === i).join(' · ').toUpperCase()
    : null;

  const price = plainSpaces(period ? `${amount} ${period}` : amount);

  // The "Éditorial" card (2026-11-06): one small line above the price
  // ("À LOUER · GOMBE"), the period in words under it ("par mois"), the type
  // and the counts in full words below a rule ("2 chambres · 2 salles de bain").
  const place = commune || city;
  const lineParts = [purpose ? purpose.toUpperCase() : null, place ? place.toUpperCase() : null].filter(Boolean);
  const rooms = roomSpecs(listing).slice(0, 2);

  return {
    amount: plainSpaces(amount),
    period,
    purposeBadge: purpose ? purpose.toUpperCase() : null,
    typeText,
    specs,
    heading,
    eyebrow,
    verified: Boolean(listing.verified_at),
    alt: `${heading} — ${price}`,
    line: lineParts.length ? lineParts.join(' · ') : null,
    periodWords: period ? period.replace(/^\/\s*/, 'par ') : null,
    roomsLine: rooms.length ? plainSpaces(rooms.join(' · ')) : null,
    priceSize: ogPriceSize(plainSpaces(amount)),
  };
}

/**
 * Where the photos go on the Éditorial card (the photo block is 766×630, the
 * gaps 6px of the column's ivory): three photos = one tall on the left and two
 * stacked on the right; two = side by side; one = the whole block; none = no
 * slots (the card draws the blue block with the logo, never a stand-in photo).
 * The first slot always takes the brightest photo.
 */
export const OG_PHOTO_BLOCK = Object.freeze({ width: 766, height: 630, gap: 6 });

export function ogPhotoSlots(count) {
  const { width, height, gap } = OG_PHOTO_BLOCK;
  if (count >= 3) {
    const small = { width: width - 494 - gap, height: (height - gap) / 2 };
    return [
      { left: 0, top: 0, width: 494, height },
      { left: 494 + gap, top: 0, ...small },
      { left: 494 + gap, top: small.height + gap, ...small },
    ];
  }
  if (count === 2) {
    const half = (width - gap) / 2;
    return [
      { left: 0, top: 0, width: half, height },
      { left: half + gap, top: 0, width: half, height },
    ];
  }
  if (count === 1) return [{ left: 0, top: 0, width, height }];
  return [];
}

/**
 * The serif price's size on the Éditorial card, so it stays on one line in
 * the 340px text column: "1 300 $" at full size, "250 000 $" and
 * "2 500 000 FC" smaller, "Prix sur demande" smallest.
 */
export function ogPriceSize(amount) {
  const length = String(amount || '').length;
  if (length <= 7) return 106;
  if (length <= 9) return 84;
  if (length <= 11) return 70;
  return 50;
}
