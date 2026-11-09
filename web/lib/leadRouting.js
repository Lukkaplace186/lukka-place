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
export const ROUTING_TYPES = Object.freeze({ direct: 'DIRECT_WA', central: 'CENTRAL_FALLBACK', viaLukka: 'VIA_LUKKA' });

/**
 * VIA_LUKKA (2026-11-09, owner decision): a verified agent's listing button
 * opens the Lukka Place number with the same pre-typed message, not the
 * agent's own WhatsApp. The engine (services/listingEnquiry.js) records the
 * customer and a lead, alerts the agent, and replies at once with the agent's
 * name and WhatsApp — one extra tap for the customer, and the contact is no
 * longer invisible (102 direct taps in 30 days had left nothing behind).
 * The agent's number stays on the page for calls.
 *
 * `NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=on` (build time) restores the direct
 * link; it also applies whenever no central number is configured, since there
 * would be nothing to route through.
 */
export function routesViaLukka() {
  return process.env.NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT !== 'on' && Boolean(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER);
}

/**
 * Any other "write to this agent / developer" WhatsApp button — the agent
 * profile, the agent directory, a project page, the Espace Client's visit and
 * proposal cards (2026-11-09). The message ends with the page's own link
 * (`/agents/<id>`, `/projets/<slug>`, `/listings/<id>`), which is how the
 * engine (services/contactRelay.js, services/listingEnquiry.js) knows who the
 * customer wants and hands them that agent's WhatsApp. With VIA_LUKKA off and
 * a routable agent, the agent's own number as before; with no routable agent,
 * our number either way.
 *
 * @param {{agentPhone?: string|null, message: string, link: string}} p
 * @returns {string|null}
 */
export function contactWhatsAppHref({ agentPhone, message, link }) {
  const text = link ? `${message}\n\n${link}` : message;
  const phone = String(agentPhone || '').replace(/\D/g, '');
  if (phone && !routesViaLukka()) return buildWhatsAppLink(phone, text);
  return getCentralWhatsAppHref(text) || (phone ? buildWhatsAppLink(phone, text) : null);
}

export function listingWhatsAppMessage(listing) {
  return buildWhatsAppMessage({
    reference: listing?.reference,
    id: listing?.id,
    propertyType: listing?.category_name,
    quartier: listing?.quartier,
    commune: listing?.commune,
    price: listing?.price,
    purpose: listing?.purpose,
    pricePeriod: listing?.price_period,
  });
}

/**
 * @param {Object} listing A row from lib/listings.js.
 * @returns {{routingType: 'DIRECT_WA'|'CENTRAL_FALLBACK'|'VIA_LUKKA', href: string|null}}
 *   `href` is null only when routing is central and no central number is
 *   configured — callers render their honest disabled state for that.
 */
export function resolveWhatsAppRouting(listing) {
  const message = listingWhatsAppMessage(listing);
  const agentPhone = String(listing?.agent_phone || '').replace(/\D/g, '');
  if (agentPhone && routesViaLukka()) {
    return { routingType: ROUTING_TYPES.viaLukka, href: getCentralWhatsAppHref(message) };
  }
  if (agentPhone) {
    return { routingType: ROUTING_TYPES.direct, href: buildWhatsAppLink(agentPhone, message) };
  }
  return { routingType: ROUTING_TYPES.central, href: getCentralWhatsAppHref(message) };
}
