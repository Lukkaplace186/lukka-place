import 'server-only';
import { getPool } from './db';
import { buildPriceHistory } from './priceHistoryRules';

/**
 * A public listing's price history (lib/priceHistoryRules.js has what is
 * shown and why). The public gate is applied here too, so a crafted id of a
 * pending listing reads nothing. Never throws: a failed read shows no
 * section, never a broken page. "After publication" is decided in SQL with
 * the same expression as the "Prix en baisse" badge (lib/listings.js).
 */
export async function getPriceHistory(propertyId) {
  const id = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    const { rows } = await getPool().query(
      `SELECT h.price, h.currency, h.purpose, h.price_period, h.changed_at,
              h.changed_at > GREATEST(p.created_at, COALESCE(p.moderated_at, p.created_at)) AS after_publish,
              GREATEST(p.created_at, COALESCE(p.moderated_at, p.created_at)) AS published_at
         FROM property_price_history h
         JOIN properties p ON p.id = h.property_id
        WHERE h.property_id = $1
          AND p.status = 1 AND p.approve_status = 1
        ORDER BY h.changed_at ASC, h.id ASC
        LIMIT 60`,
      [id],
    );
    if (!rows.length) return null;
    return buildPriceHistory(rows, rows[0].published_at);
  } catch (err) {
    console.warn(`[price-history] #${id}: ${err.message}`);
    return null;
  }
}
