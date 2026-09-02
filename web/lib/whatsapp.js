import { formatPrice } from './format';
import { SITE_URL } from './constants';

/**
 * Message template exactly as specified in CLAUDE.md's Lead Routing Rules,
 * extended with the real listing price and a real link to the detail page
 * (Ref/type/commune, then price, then link — so the agent sees everything
 * needed to answer without opening a second app), with graceful fallbacks
 * for fields that are commonly still null on existing listings (see
 * PLAN.md §0 — `reference` and the commune-via-amenity tag were both added
 * after most currently-live listings were synced):
 *   - No `reference` yet -> fall back to the listing's slug, then its id,
 *     so the message never literally reads "Ref: null".
 *   - No `commune` yet -> drop the " à {commune}" clause rather than send
 *     "(Appartement à )" with a dangling preposition.
 *   - `price`/`purpose` are optional — omitted entirely if not passed
 *     (callers outside a specific listing, e.g. Footer.js/ValueProposition.js's
 *     generic "contact us" links, pass their own plain string to
 *     getCentralWhatsAppHref below and never call this at all).
 *
 * Always quotes the listing's real stored USD price, deliberately never a
 * currency-toggled CDF estimate — see components/Price.js's doc comment.
 */
export function buildWhatsAppMessage({ reference, slug, id, propertyType, commune, price, purpose }) {
  const ref = reference || slug || `#${id}`;
  const location = commune ? ` à ${commune}` : '';
  const priceText = price != null ? ` — ${formatPrice(price, purpose)}` : '';
  const link = id != null ? `\nVoir l'annonce : ${SITE_URL}/listings/${id}` : '';
  return `Bonjour, je suis intéressé par l'annonce Ref: ${ref} (${propertyType}${location})${priceText}. Est-elle toujours disponible ?${link}`;
}

export function buildWhatsAppLink(phoneNumber, message) {
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * A share-to-anyone WhatsApp link — `wa.me/?text=` with no recipient, which
 * opens WhatsApp's own contact picker instead of a fixed conversation. Used
 * by the "Partager sur WhatsApp" action on a listing row: this is a
 * marketing share (the agent sends their own listing to whoever they pick),
 * not a lead contact, so it deliberately doesn't reuse buildWhatsAppLink's
 * fixed-number shape.
 */
export function buildWhatsAppShareLink(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * The share text for "Partager sur WhatsApp" on a listing row — title,
 * price and a real link to the public listing page, so whoever receives it
 * can open the exact same detail page the agent is looking at. Reuses
 * formatPrice for the same real stored price every other surface shows,
 * never a currency-toggled estimate — same reasoning buildWhatsAppMessage
 * above already documents.
 */
export function buildListingShareMessage({ title, price, purpose, pricePeriod, id }) {
  const priceText = price != null ? ` — ${formatPrice(price, purpose, pricePeriod)}` : '';
  const link = id != null ? `\n${SITE_URL}/listings/${id}` : '';
  return `${title}${priceText}${link}`;
}

/**
 * The one real central WhatsApp number (CLAUDE.md's Lead Routing Rules),
 * resolved to a link or `null`. Every CTA on the site that isn't routing to
 * a specific per-listing/per-agent number (Footer, ValueProposition,
 * TrustSection, TransactionTypesGrid, contact/messages/compte pages,
 * EnquiryCard, MobileListingBar) was re-deriving
 * `process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ? buildWhatsAppLink(...) : null`
 * by hand — same risk `lib/listingView.js`'s doc comment already warns
 * about for card values: N copies of one condition drift the moment one of
 * them doesn't get updated. Callers still own the message text and the
 * disabled-state markup; this only centralises the number lookup + null
 * fallback.
 */
export function getCentralWhatsAppHref(message) {
  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  return phoneNumber ? buildWhatsAppLink(phoneNumber, message) : null;
}
