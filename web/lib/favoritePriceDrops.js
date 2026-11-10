import 'server-only';
import { getPool } from './db';
import { PRICE_DROP_LATERAL } from './listings';

/**
 * Price cuts on listings a customer has SAVED (2026-11-03) — the WhatsApp
 * message (lib/favoritePriceDropSweep.js, run by the search-alerts cron) and
 * the dot on the Espace Client's "Enregistrés" tab.
 *
 * Same definition of a cut as the card badge (lib/listings.js
 * PRICE_DROP_LATERAL: the latest recorded change, within 14 days, after
 * publication, still the current price) and the same 1–50 % band as
 * lib/listingView.js cardPromoBadge — a "cut" over 50 % is a corrected typo.
 * Only a cut made AFTER the customer saved the listing counts: one that was
 * already there when they saved it is not news to them.
 */

const PERCENT_BAND_SQL = `(pd.price_drop_from - p.price) / NULLIF(pd.price_drop_from, 0) BETWEEN 0.01 AND 0.5`;

function cutFavoritesFrom(extraJoins = '') {
  return `
  FROM customer_favorites cf
  ${extraJoins}
  JOIN properties p ON p.id = cf.property_id AND p.status = 1 AND p.approve_status = 1
  ${PRICE_DROP_LATERAL}
 WHERE pd.price_drop_from IS NOT NULL
   AND ${PERCENT_BAND_SQL}
   AND cf.created_at < pd.price_drop_at
   AND COALESCE(p.listing_status, 'active') = 'active'`;
}

/**
 * Cuts not yet WhatsApped, for customers who can be told: a verified number,
 * WhatsApp alerts not switched off. Oldest customers first, bounded.
 *
 * @returns {Promise<Array<{customer_id: number, phone: string, property_id: number,
 *   title: string, price: string, price_drop_from: string, price_drop_at: Date,
 *   purpose: string, price_period: string|null}>>}
 */
export async function getUnnotifiedFavoritePriceDrops({ limit = 500 } = {}) {
  const { rows } = await getPool().query(
    `SELECT cf.customer_id, c.phone, p.id AS property_id, pc.title, p.price, p.purpose, p.price_period,
            pd.price_drop_from, pd.price_drop_at,
            -- 2026-11-10: read for the app even when WhatsApp alerts are off; never WhatsApped then.
            (to_jsonb(c) ->> 'whatsapp_alerts_opted_out_at') IS NOT NULL AS whatsapp_opted_out
       ${cutFavoritesFrom(`JOIN customers c ON c.id = cf.customer_id
  LEFT JOIN property_contents pc ON pc.property_id = cf.property_id AND pc.language_id = 20`)}
        AND c.phone IS NOT NULL
        -- Any customer number, confirmed or not (2026-11-06, owner decision).
        AND NOT EXISTS (
          SELECT 1 FROM customer_price_drop_notifications n
           WHERE n.customer_id = cf.customer_id AND n.property_id = p.id AND n.price_drop_at = pd.price_drop_at
        )
      ORDER BY cf.customer_id, pd.price_drop_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/** Recorded only after the send was accepted, so a failed send is retried next day. */
export async function recordFavoritePriceDropsNotified(customerId, drops) {
  if (!drops.length) return;
  const values = [];
  const params = [customerId];
  for (const d of drops) {
    params.push(d.property_id, d.price_drop_at, d.price_drop_from, d.price);
    const i = params.length;
    values.push(`($1, $${i - 3}, $${i - 2}, $${i - 1}, $${i})`);
  }
  await getPool().query(
    `INSERT INTO customer_price_drop_notifications (customer_id, property_id, price_drop_at, price_from, price_to)
     VALUES ${values.join(', ')}
     ON CONFLICT DO NOTHING`,
    params,
  );
}

/**
 * How many of this customer's saved listings had a cut since `seenAt` (the
 * last time they opened Enregistrés; null = never). Never throws: the dot is
 * decoration, and the tab must render without it.
 */
export async function countUnseenFavoritePriceDrops(customerId, seenAt = null) {
  try {
    const seen = seenAt ? new Date(seenAt) : null;
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n ${cutFavoritesFrom()}
          AND cf.customer_id = $1
          AND ($2::timestamptz IS NULL OR pd.price_drop_at > $2::timestamptz)`,
      [customerId, seen && !Number.isNaN(seen.getTime()) ? seen.toISOString() : null],
    );
    return rows[0]?.n || 0;
  } catch (err) {
    console.warn(`[favorite-price-drops] count failed for customer ${customerId}: ${err.message}`);
    return 0;
  }
}

export const __test = { cutFavoritesFrom, PERCENT_BAND_SQL };
