import { formatPrice } from './format';
import { SITE_URL } from './constants';

/**
 * The message a customer sends when they tap a listing's WhatsApp button
 * (CLAUDE.md "Message Format (both paths)"):
 *
 *   Bonjour, je vous contacte via Lukka Place au sujet de ce bien :
 *   Appartement à Limete — 700 $ / mois
 *   Réf. Petit Boulevard
 *
 *   Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?
 *
 *   https://lukkaplace.com/listings/286
 *
 * Shaped for the agent reading it on a phone:
 *   - "via Lukka Place" first: on the direct path the agent has no other way
 *     to know where the lead came from.
 *   - One fact line, stated once. WhatsApp unfurls the link into a card that
 *     already carries the title, so the old "(Appartement à Limete) — 700 $"
 *     parenthetical made the same facts read three times in one bubble. The
 *     line stays because the chat list and a client with previews off show
 *     only the text.
 *   - The `Réf.` line only when the listing has a REAL `reference` — the
 *     value KeyFacts shows on the page. There is deliberately no fallback:
 *     the slug fallback is what put "2-chambres-appartement-a-louer-a-limete-286"
 *     in front of agents, and an invented "LUK-286" would be exactly the "id
 *     dressed up as a reference" KeyFacts refuses. The link identifies the
 *     listing already.
 *   - The link last and alone on its line, so it is tappable, and so the
 *     engine's services/listingEnquiry.js — which recognises this message by
 *     that link — keeps finding it.
 *   - No emoji: this is sent as the customer's own words, and a bulleted
 *     emoji block reads as a bot to the agent receiving it.
 *
 * Always quotes the listing's real stored USD price, deliberately never a
 * currency-toggled CDF estimate — see components/Price.js's doc comment.
 */
export function buildWhatsAppMessage({ reference, id, propertyType, commune, price, purpose, pricePeriod }) {
  const what = [propertyType, commune].filter(Boolean).join(' à ');
  const priceText = price != null ? formatPrice(price, purpose, pricePeriod) : '';
  const facts = [what, priceText].filter(Boolean).join(' — ');
  const ref = typeof reference === 'string' ? reference.trim() : '';

  const lines = ['Bonjour, je vous contacte via Lukka Place au sujet de ce bien :'];
  if (facts) lines.push(facts);
  if (ref) lines.push(`Réf. ${ref}`);
  lines.push('', 'Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?');
  if (id != null) lines.push('', `${SITE_URL}/listings/${id}`);
  return lines.join('\n');
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
