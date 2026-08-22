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
 *     generic "contact us" links, use buildWhatsAppLink directly and never
 *     call this at all).
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
