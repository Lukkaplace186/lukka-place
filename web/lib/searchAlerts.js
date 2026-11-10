import 'server-only';
import { getPool } from './db';
import { DEFAULT_ALERT_FREQUENCY } from './alertPreferences';

/**
 * Backs /api/cron/search-alerts — the proactive WhatsApp side of the
 * existing pull-model saved-search alerts (web/lib/alerts.js). That module
 * re-checks matches only when a customer opens the Alertes tab; this is the
 * push equivalent, tracked separately (saved_search_notifications) so the
 * two never interfere: viewing the Alertes tab doesn't mark anything as
 * "already texted", and a WhatsApp send doesn't affect the tab's own
 * created_at/last_viewed_at badge count.
 *
 * `alert_frequency`, `last_alerted_at` and `whatsapp_alerts_opted_out_at` are
 * read through `to_jsonb(row) ->> '...'` so these reads keep working on a
 * database where migrations/20260918_customer_alert_preferences.sql has not
 * run yet — the same technique lib/listings.js uses for verification_level.
 */

const FREQUENCY_SQL = `COALESCE(to_jsonb(css) ->> 'alert_frequency', '${DEFAULT_ALERT_FREQUENCY}')`;
const LAST_ALERTED_SQL = `(to_jsonb(css) ->> 'last_alerted_at')`;

/**
 * The next page of saved searches the sweep should look at, keyset-paged by
 * id so a sweep over 100,000 searches is a series of short reads rather than
 * one table load (the previous version SELECTed every saved search at once).
 *
 * Only searches that could produce an alert right now:
 *  - any customer number, confirmed or not (2026-11-06, owner decision: customers sign up with a number and a password, nothing else); a mistyped
 *    number reaches a stranger, who stops it with the link in every message;
 *  - an account that has not opted out of WhatsApp alerts;
 *  - a frequency other than 'off', and a last alert old enough for it
 *    (20h for daily, 6 days for weekly — each a little under its period so a
 *    sweep starting a few minutes early still sends);
 *  - saved before the newest new listing — a search saved after every new
 *    listing cannot have a new match.
 *
 * @param {{afterId?: number, limit?: number, newestPublishedAt: Date|string}} options
 */
export async function getSavedSearchesDueForAlerts({ afterId = 0, limit = 200, newestPublishedAt }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT css.id, css.customer_id, css.query, css.label, css.created_at, c.phone,
            ${FREQUENCY_SQL} AS alert_frequency,
            -- 2026-11-10: a customer who turned WhatsApp alerts off is still
            -- read, for the app only (cron search-alerts: never WhatsApped).
            (to_jsonb(c) ->> 'whatsapp_alerts_opted_out_at') IS NOT NULL AS whatsapp_opted_out
       FROM customer_saved_searches css
       JOIN customers c ON c.id = css.customer_id
      WHERE css.id > $1
        AND c.phone IS NOT NULL
        AND css.created_at < $2
        AND ${FREQUENCY_SQL} <> 'off'
        AND (
          ${LAST_ALERTED_SQL} IS NULL
          OR ${LAST_ALERTED_SQL}::timestamptz < now() - CASE
               WHEN ${FREQUENCY_SQL} = 'daily' THEN interval '20 hours'
               ELSE interval '6 days'
             END
        )
      ORDER BY css.id
      LIMIT $3`,
    [afterId, newestPublishedAt, limit],
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

/**
 * Stamps the search as alerted, which is what gates its frequency. Throws on
 * a database the preferences migration has not reached; the sweep catches that
 * and carries on (per-listing dedupe still holds).
 */
export async function markSavedSearchAlerted(savedSearchId) {
  await getPool().query('UPDATE customer_saved_searches SET last_alerted_at = now() WHERE id = $1', [savedSearchId]);
}

// ---------------------------------------------------------------------------
// C1 — instant matches for customers with the Lukka Place app
// (lib/instantMatchSweep.js, /api/cron/instant-alerts)
// ---------------------------------------------------------------------------

const MISSING_TABLE = new Set(['42P01', '42703']);

/**
 * Saved searches of customers who have the app (a live push_devices row) and
 * did not switch the search off. Before the push migration there are none.
 * The WhatsApp opt-out does not apply: nothing here is WhatsApped.
 */
export async function getAppCustomerSearches({ limit = 2000 } = {}) {
  try {
    const { rows } = await getPool().query(
      `SELECT css.id, css.customer_id, css.query, css.label, css.created_at
         FROM customer_saved_searches css
        WHERE ${FREQUENCY_SQL} <> 'off'
          AND EXISTS (
            SELECT 1 FROM push_devices d
             WHERE d.user_type = 'customer' AND d.user_id = css.customer_id AND d.revoked_at IS NULL
          )
        ORDER BY css.id
        LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (err) {
    if (MISSING_TABLE.has(err?.code)) return [];
    throw err;
  }
}

/** Instant-match pushes this customer got in the last 24 h (notifications, kind instant_match). */
export async function countInstantMatchesToday(customerId) {
  try {
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE user_type = 'customer' AND user_id = $1 AND kind = 'instant_match'
          AND push_sent_at IS NOT NULL AND created_at > now() - interval '24 hours'`,
      [customerId],
    );
    return Number(rows[0]?.n) || 0;
  } catch (err) {
    if (MISSING_TABLE.has(err?.code)) return 0;
    throw err;
  }
}
