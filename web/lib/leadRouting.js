import { buildWhatsAppLink, buildWhatsAppMessage, getCentralWhatsAppHref } from './whatsapp';

/**
 * Where a listing's WhatsApp button goes — the one decision EnquiryCard,
 * MobileListingBar and WhatsAppCTA used to each make for themselves (and made
 * differently: the mobile bar always went central, the desktop card went to
 * the agent, so one listing offered two contacts depending on screen width).
 *
 *   DIRECT_WA        a verified agent whose direct routing is on — the chat
 *                    opens with them and Lukka Place is not in the middle.
 *   CENTRAL_FALLBACK anyone else — the central number, where the engine's
 *                    services/listingEnquiry.js answers instantly, logs the
 *                    lead and alerts the desk.
 *
 * "Verified" is decided server-side, not here: lib/listings.js only returns
 * `agent_phone` when the number is verified and routing is enabled, so a
 * non-null `agent_phone` IS the verified case. Re-checking a flag in the
 * browser would be a second definition that could disagree with the SQL.
 *
 * The message is the same on both paths (CLAUDE.md "Message Format (both
 * paths)"): the central bot recognises a storefront enquiry by the listing
 * link inside it, so a different message for the direct path would be
 * harmless today and a silent break the day an agent forwards one to the
 * central number.
 */
export const ROUTING_TYPES = Object.freeze({ direct: 'DIRECT_WA', central: 'CENTRAL_FALLBACK' });

export function listingWhatsAppMessage(listing) {
  return buildWhatsAppMessage({
    reference: listing?.reference,
    id: listing?.id,
    propertyType: listing?.category_name,
    commune: listing?.commune,
    price: listing?.price,
    purpose: listing?.purpose,
    pricePeriod: listing?.price_period,
  });
}

/**
 * @param {Object} listing A row from lib/listings.js.
 * @returns {{routingType: 'DIRECT_WA'|'CENTRAL_FALLBACK', href: string|null}}
 *   `href` is null only when routing is central and no central number is
 *   configured — callers render their honest disabled state for that.
 */
export function resolveWhatsAppRouting(listing) {
  const message = listingWhatsAppMessage(listing);
  const agentPhone = String(listing?.agent_phone || '').replace(/\D/g, '');
  if (agentPhone) {
    return { routingType: ROUTING_TYPES.direct, href: buildWhatsAppLink(agentPhone, message) };
  }
  return { routingType: ROUTING_TYPES.central, href: getCentralWhatsAppHref(message) };
}
