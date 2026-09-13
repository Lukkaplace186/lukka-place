import 'server-only';

/**
 * Storefront WhatsApp taps, with the routing each one actually took.
 *
 * Written to the EXISTING `whatsapp_clicks` table, not a new one: every tap is
 * still a WhatsApp click, and lib/analytics.js's getWhatsAppConversionRate
 * divides that table by listing views. A second table would either split the
 * conversion rate or double-count it. `routing_type` and `agent_id` are the
 * two columns migrations/20260913_lead_routing_and_price_capture.sql added.
 *
 * `agent_id` is read from `properties` in the INSERT itself, never from the
 * request body: the body is the client's claim about what it did, and letting
 * it name an agent would let anyone pad an agency's lead count. It is filled
 * for central clicks too — "an unverified agent's listing drew 14 taps this
 * week" is exactly who the desk should call to get verified.
 */
export const LEAD_CLICK_ROUTING_TYPES = ['DIRECT_WA', 'CENTRAL_FALLBACK'];

export const RECORD_LEAD_CLICK_SQL = `
  INSERT INTO whatsapp_clicks (listing_id, commune, device, source, price, routing_type, agent_id)
  VALUES ($1, $2, $3, $4, $5, $6, (SELECT agent_id FROM properties WHERE id = $1))
`;

/**
 * @param {import('pg').Pool} pool
 * @param {{listingId: number, commune: string|null, device: string|null, source: string|null,
 *          price: number|null, routingType: 'DIRECT_WA'|'CENTRAL_FALLBACK'}} click
 */
export async function recordLeadClick(pool, { listingId, commune, device, source, price, routingType }) {
  if (!LEAD_CLICK_ROUTING_TYPES.includes(routingType)) {
    throw new Error(`recordLeadClick: unknown routing type '${routingType}'`);
  }
  await pool.query(RECORD_LEAD_CLICK_SQL, [listingId, commune || null, device, source, price, routingType]);
}
