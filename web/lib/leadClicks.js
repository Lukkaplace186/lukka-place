import 'server-only';
import { VIEWER_KINDS, viewerKindSql } from './trackIngest';

/**
 * Storefront WhatsApp taps, with the routing each one actually took.
 *
 * Written to the EXISTING `whatsapp_clicks` table, not a new one: every tap is
 * still a WhatsApp click, and lib/analytics.js's getWhatsAppConversionRate
 * divides that table by listing views. A second table would either split the
 * conversion rate or double-count it. `routing_type` and `agent_id` are the
 * two columns migrations/20260913_lead_routing_and_price_capture.sql added;
 * `visitor_id` is migrations/20260929_engagement_tracking.sql's.
 *
 * `agent_id` is read from `properties` in the INSERT itself, never from the
 * request body: the body is the client's claim about what it did, and letting
 * it name an agent would let anyone pad an agency's lead count. It is filled
 * for central clicks too — "an unverified agent's listing drew 14 taps this
 * week" is exactly who the desk should call to get verified.
 *
 * Every tap is stored, the listing's own agent's and the team's included,
 * with its `viewer_kind` (lib/trackIngest.js decides it; `owner` is resolved
 * in the INSERT). Before the engagement migration runs, the INSERT is retried
 * without `visitor_id` / `viewer_kind`.
 */
export const LEAD_CLICK_ROUTING_TYPES = ['DIRECT_WA', 'CENTRAL_FALLBACK'];

export const RECORD_LEAD_CLICK_SQL = `
  INSERT INTO whatsapp_clicks (listing_id, commune, device, source, price, routing_type, agent_id, visitor_id, viewer_kind)
  VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::numeric, $6::text,
          (SELECT agent_id FROM properties WHERE id = $1::bigint), $7::text, ${viewerKindSql('$8', '$1', '$9')})
`;

export const RECORD_LEAD_CLICK_LEGACY_SQL = `
  INSERT INTO whatsapp_clicks (listing_id, commune, device, source, price, routing_type, agent_id)
  VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::numeric, $6::text,
          (SELECT agent_id FROM properties WHERE id = $1::bigint))
`;

/**
 * @param {import('pg').Pool} pool
 * @param {{listingId: number, commune: string|null, device: string|null, source: string|null,
 *          price: number|null, routingType: 'DIRECT_WA'|'CENTRAL_FALLBACK',
 *          visitorId?: string|null, viewerKind?: string, agentId?: number|null}} click
 * @returns {Promise<boolean>} whether a row was written.
 */
export async function recordLeadClick(pool, {
  listingId, commune, device, source, price, routingType, visitorId = null, viewerKind = 'visitor', agentId = null,
}) {
  if (!LEAD_CLICK_ROUTING_TYPES.includes(routingType)) {
    throw new Error(`recordLeadClick: unknown routing type '${routingType}'`);
  }
  const base = [listingId, commune || null, device, source, price, routingType];
  try {
    const kind = VIEWER_KINDS.includes(viewerKind) ? viewerKind : 'visitor';
    const result = await pool.query(RECORD_LEAD_CLICK_SQL, [...base, visitorId || null, kind, agentId || null]);
    return result.rowCount > 0;
  } catch (err) {
    if (err?.code !== '42703') throw err;
    const result = await pool.query(RECORD_LEAD_CLICK_LEGACY_SQL, base);
    return result.rowCount > 0;
  }
}
