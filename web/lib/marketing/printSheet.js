import { formatPrice, formatPriceParts, usablePrice } from '../format';
import { hasArea, listingImages } from '../listingView';
import { roomSpecs } from '../listingShareCopy';
import { coordinateText, mapPinUrl, printListingUrl } from '../listingShareRules';
import { optimisableImageSrc, optimisedImageUrl, purposeLabel } from './sharePackData';

/**
 * The window poster and the technical sheet (each ONE A4 page) —
 * the pure half: every string both pages print, from a getFlyerListing row
 * plus the extras lib/marketing/printSheetData.js reads.
 *
 * FRENCH ALWAYS, like the captions and the flyer: the paper is read by the
 * agent's customers in Kinshasa, not by the agent. Only the screen toolbar
 * around the sheet follows the dashboard's language.
 *
 * ONLY REAL FIELDS. A fact that is not stated is left out, never printed as a
 * zero or a dash; a section with nothing in it is not printed at all. The
 * three entry costs stay three lines (deposit, advance, commission) and are
 * never summed — "Garantie : 5 mois" is the bug the split fixed. Landmarks are
 * labelled "Référence", the product's one word for them.
 */

export const POSTER_PHOTO_WIDTH = 1920;
export const SHEET_PHOTO_WIDTH = 1080;
export const SHEET_MAX_PHOTOS = 3;
const MAX_FEATURES = 12;
const MAX_AMENITIES = 24;
// The one-page sheet's "Points forts & équipements" column holds this many
// lines before it would run into the contact block (2026-09-28: the sheet was
// two pages, the second mostly empty).
export const SHEET_MAX_HIGHLIGHTS = 10;

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function monthsValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const months = Number(value);
  return Number.isFinite(months) && months >= 0 ? months : null;
}

/**
 * The entry costs, one line each, in the order the "3 + 1 + 1" notation uses.
 * A line is printed only when its own figure is stated (NULL = not stated,
 * which is not 0). With a real monthly rent, each line also shows its amount.
 */
export function entryCostLines(listing) {
  const monthly = listing?.purpose === 'rent' && listing?.price_period !== 'an' ? usablePrice(listing?.price) : null;
  return [
    { key: 'deposit', label: 'Garantie (remboursable)', months: monthsValue(listing?.deposit_months) },
    { key: 'advance', label: 'Loyer d’avance', months: monthsValue(listing?.advance_months) },
    { key: 'commission', label: 'Commission d’agence', months: monthsValue(listing?.commission_months) },
  ]
    .filter((line) => line.months !== null)
    .map((line) => ({
      key: line.key,
      label: line.label,
      value: plural(line.months, 'mois', 'mois'),
      amount: monthly !== null && line.months > 0 ? formatPriceParts(line.months * monthly, 'sale').amount : null,
    }));
}

/** Labelled facts for the sheet's table. */
export function keyFactRows(listing, typeText) {
  const rows = [];
  if (typeText) rows.push({ label: 'Type de bien', value: typeText });
  const purpose = listing.purpose === 'rent' ? 'Location' : listing.purpose === 'sale' ? 'Vente' : null;
  if (purpose) rows.push({ label: 'Transaction', value: purpose });
  rows.push({ label: 'Prix', value: formatPrice(listing.price, listing.purpose, listing.price_period) });
  const beds = Number(listing.beds);
  if (beds > 0) rows.push({ label: 'Chambres', value: String(beds) });
  const bath = Number(listing.bath);
  if (bath > 0) rows.push({ label: 'Salles de bain', value: String(bath) });
  if (hasArea(listing.area)) rows.push({ label: 'Surface', value: `${listing.area} m²` });
  const units = Number(listing.units_count);
  if (listing.units_count != null && units > 0) rows.push({ label: 'Portes', value: String(units) });
  return rows;
}

/**
 * The sheet's strip of big figures under the photos: type, rooms, bathrooms,
 * surface, doors — only the real ones. Price and transaction are in the
 * header, so they are not repeated here.
 */
export function specStrip(listing, typeText) {
  const specs = [];
  if (typeText) specs.push({ label: 'Type', value: typeText });
  const beds = Number(listing.beds);
  if (beds > 0) specs.push({ label: beds > 1 ? 'Chambres' : 'Chambre', value: String(beds) });
  const bath = Number(listing.bath);
  if (bath > 0) specs.push({ label: bath > 1 ? 'Salles de bain' : 'Salle de bain', value: String(bath) });
  if (hasArea(listing.area)) specs.push({ label: 'Surface', value: `${listing.area} m²` });
  const units = Number(listing.units_count);
  if (listing.units_count != null && units > 0) specs.push({ label: units > 1 ? 'Portes' : 'Porte', value: String(units) });
  return specs;
}

function cleanList(values, max) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Points forts, then equipment not already said in the agent's words, within SHEET_MAX_HIGHLIGHTS lines. */
export function sheetHighlights(extras) {
  const sheetFeatures = cleanList(extras?.features, SHEET_MAX_HIGHLIGHTS);
  const said = new Set(sheetFeatures.map((f) => f.toLowerCase()));
  const sheetAmenities = cleanList(extras?.amenities, MAX_AMENITIES)
    .filter((a) => !said.has(a.toLowerCase()))
    .slice(0, SHEET_MAX_HIGHLIGHTS - sheetFeatures.length);
  return { sheetFeatures, sheetAmenities };
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '') || null;

/**
 * @param {object} listing  getFlyerListing row.
 * @param {{features?: string[]|null, amenities?: string[], address?: string|null,
 *          latitude?: string|null, longitude?: string|null}} extras
 * @param {{typeText: string|null, brand: {name, phone}, supabaseHost?: string|null,
 *          medium: 'poster'|'fiche'}} options
 */
export function buildPrintSheet(listing, extras, { typeText, brand, supabaseHost = null, medium }) {
  const commune = trimmed(listing.commune);
  const quartier = trimmed(listing.quartier);
  const reference = trimmed(listing.reference);
  const address = trimmed(extras?.address);
  const place = [quartier, commune].filter(Boolean).join(', ') || null;
  const headline = typeText && commune ? `${typeText} à ${commune}` : typeText || place || trimmed(listing.title);
  const images = listingImages(listing).filter((src) => optimisableImageSrc(src, { supabaseHost }));

  const location = [];
  if (quartier) location.push({ label: 'Quartier', value: quartier });
  if (commune) location.push({ label: 'Commune', value: commune });
  if (reference) location.push({ label: 'Référence', value: reference });
  if (address && address !== place) location.push({ label: 'Adresse', value: address });

  return {
    listingId: Number(listing.id),
    medium,
    title: trimmed(listing.title),
    headline: headline || null,
    purposeLabel: purposeLabel(listing.purpose),
    priceText: formatPrice(listing.price, listing.purpose, listing.price_period),
    place,
    reference,
    rooms: roomSpecs(listing),
    keyFacts: keyFactRows(listing, typeText),
    entryCosts: entryCostLines(listing),
    features: cleanList(extras?.features, MAX_FEATURES),
    amenities: cleanList(extras?.amenities, MAX_AMENITIES),
    // The one-page sheet's column: the agent's points forts and the tagged
    // equipment stay TWO lists (never merged — CLAUDE.md, `features`), sharing
    // one line budget, points forts first.
    ...sheetHighlights(extras),
    specs: specStrip(listing, typeText),
    location,
    mapUrl: mapPinUrl(extras?.latitude, extras?.longitude),
    coordinates: coordinateText(extras?.latitude, extras?.longitude),
    cover: images[0] ? optimisedImageUrl(images[0], medium === 'poster' ? POSTER_PHOTO_WIDTH : SHEET_PHOTO_WIDTH) : null,
    photos: images.slice(0, SHEET_MAX_PHOTOS).map((src) => optimisedImageUrl(src, SHEET_PHOTO_WIDTH)),
    agentName: brand?.name || null,
    // Only a number the public listing page itself would publish (verified AND
    // direct routing on) — agentContactPhone, via agentBrandFields.
    agentPhone: brand?.phone || null,
    url: printListingUrl(listing.id, medium),
    displayUrl: `lukkaplace.com/listings/${Number(listing.id)}`,
  };
}
