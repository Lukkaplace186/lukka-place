import 'server-only';
import { getPool } from './db';

/**
 * Backs /api/cron/search-alerts — the proactive WhatsApp side of the
 * existing pull-model saved-search alerts (web/lib/alerts.js). That module
 * re-checks matches only when a customer opens the Alertes tab; this is the
 * push equivalent, tracked separately (saved_search_notifications) so the
 * two never interfere: viewing the Alertes tab doesn't mark anything as
 * "already texted", and a WhatsApp send doesn't affect the tab's own
 * created_at/last_viewed_at badge count.
 */

/**
 * Every saved search paired with its owner's real phone (for the WhatsApp
 * send). `created_at` is included so the cron route can exclude listings
 * that already existed when the search was saved — without it, a
 * brand-new saved search would fire an alert for every pre-existing match
 * on its very first run, which isn't "a new listing", just an old one the
 * customer hadn't seen the WhatsApp message for yet.
 */
export async function getSavedSearchesWithPhone() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT css.id, css.customer_id, css.query, css.label, css.created_at, c.phone
     FROM customer_saved_searches css
     JOIN customers c ON c.id = css.customer_id
     WHERE c.phone IS NOT NULL`,
  );
  return rows;
}

/** @returns {Promise<Set<number>>} property ids already notified for this saved search. */
export async function getNotifiedPropertyIds(savedSearchId) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT property_id FROM saved_search_notifications WHERE saved_search_id = $1',
    [savedSearchId],
  );
  return new Set(rows.map((r) => Number(r.property_id)));
}

/** Idempotent per (saved_search_id, property_id) — the table's own UNIQUE constraint backs this, ON CONFLICT DO NOTHING rather than erroring on a race with a concurrent run. */
export async function recordNotifiedProperties(savedSearchId, propertyIds) {
  if (!propertyIds.length) return;
  const pool = getPool();
  const values = propertyIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO saved_search_notifications (saved_search_id, property_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [savedSearchId, ...propertyIds],
  );
}
