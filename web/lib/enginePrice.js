import 'server-only';
import { getPool } from './db';
import { setEnginePrice } from './adminApi';

/**
 * Every asking-price change made on lukkaplace.com goes through the engine
 * (lib/adminApi.js setEnginePrice → engine setListingPrice), because a listing
 * that arrived over WhatsApp also lives in the engine's SQLite, and the
 * engine's next sync of that listing rewrote Postgres from SQLite — putting a
 * price changed here back to the old one (root CLAUDE.md, "Toujours disponible ?
 * on WhatsApp"). The caller's own UPDATE then writes the same values, which is
 * a no-op for the price.
 *
 * Only a real change calls the engine: an editor save that leaves the price
 * alone must keep working while the engine is down. A change the engine
 * cannot take is refused (PriceSyncError) rather than written to Postgres
 * alone — that is exactly the write that used to be undone later.
 */

export class PriceSyncError extends Error {
  constructor(message) {
    super(message);
    this.code = 'PRICE_SYNC_UNAVAILABLE';
  }
}

const same = (a, b) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));

/** Did anything a price change consists of actually change? */
export function priceChanged(current, next) {
  if (!current) return true;
  return !same(current.price, next.price)
    || !same(current.price_original, next.priceOriginal)
    || String(current.currency || 'USD').toUpperCase() !== String(next.currency || 'USD').toUpperCase();
}

/**
 * @param {{propertyId: number, price: number, priceOriginal?: number|null, currency?: string,
 *          agentId?: number|null, source: 'AGENT_DASHBOARD'|'ADMIN_DASHBOARD'}} change
 * @returns {Promise<{owned: boolean, changed: boolean}>}
 */
export async function applyPriceChange({ propertyId, price, priceOriginal = null, currency = 'USD', agentId = null, source }) {
  const id = Number(propertyId);
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return { owned: true, changed: false };
  const { rows } = await getPool().query(
    `SELECT price, price_original, currency FROM properties WHERE id = $1 AND ($2::bigint IS NULL OR agent_id = $2::bigint)`,
    [id, agentId == null ? null : Number(agentId)],
  );
  if (!rows.length) return { owned: false, changed: false };
  const next = { price: amount, priceOriginal: priceOriginal ?? amount, currency: String(currency || 'USD').toUpperCase() };
  if (!priceChanged(rows[0], next)) return { owned: true, changed: false };

  let result;
  try {
    result = await setEnginePrice(id, { ...next, source, agentId });
  } catch (err) {
    throw new PriceSyncError(`engine unreachable: ${err.message}`);
  }
  if (result.status === 404) return { owned: false, changed: false };
  if (result.status !== 200 || !result.body?.success) {
    throw new PriceSyncError(`engine refused the price (${result.status}): ${result.body?.error || 'unknown'}`);
  }
  return { owned: true, changed: true };
}
