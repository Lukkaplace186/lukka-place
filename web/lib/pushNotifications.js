import 'server-only';
import { getPool } from './db';
import { INBOX_PAGE_SIZE, PUSH_USER_TYPES } from './pushRules';

/**
 * The account side of the app's push notifications, for agents and
 * customers: registering a phone, revoking it, and the in-app inbox the
 * engine fills (services/pushNotify.js writes `notifications`;
 * migrations/20261110_push_notifications.sql).
 *
 * Every statement names the person (`user_type = $n AND user_id = $m`),
 * whose id always comes from that side's own session, never from the request.
 *
 * Before the migration runs, 42P01 reads as "nothing" (empty inbox, zero
 * unread) and a registration answers 'unavailable' — the app then simply
 * keeps receiving WhatsApp, as before.
 */

const MISSING = new Set(['42P01', '42703']);

function missingTable(err) {
  return MISSING.has(err?.code);
}

function assertUserType(userType) {
  if (!PUSH_USER_TYPES.includes(userType)) throw new Error(`unknown user type: ${userType}`);
}

/**
 * Record (or move) this phone's token to this account. A token that belonged
 * to another account on the same phone is re-pointed: one phone, one account.
 * @returns {Promise<'ok'|'unavailable'>}
 */
export async function registerDevice(userType, userId, { token, platform, appVersion }) {
  assertUserType(userType);
  try {
    await getPool().query(
      `INSERT INTO push_devices (user_type, user_id, platform, fcm_token, app_version)
       VALUES ($5, $1, $2, $3, $4)
       ON CONFLICT (fcm_token) DO UPDATE
          SET user_type = EXCLUDED.user_type, user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
              app_version = EXCLUDED.app_version, last_seen_at = NOW(),
              revoked_at = NULL, revoked_reason = NULL`,
      [userId, platform, token, appVersion, userType],
    );
    return 'ok';
  } catch (err) {
    if (missingTable(err)) return 'unavailable';
    throw err;
  }
}

/**
 * Stop pushing to this phone for this account (logout, or alerts turned off
 * in the app). Another account's row with the same token is untouched.
 * @returns {Promise<boolean>} whether a live row was revoked
 */
export async function revokeDevice(userType, userId, token, reason = 'logout') {
  assertUserType(userType);
  try {
    const { rowCount } = await getPool().query(
      `UPDATE push_devices SET revoked_at = NOW(), revoked_reason = $4
        WHERE fcm_token = $1 AND user_type = $3 AND user_id = $2 AND revoked_at IS NULL`,
      [token, userId, userType, String(reason).slice(0, 120)],
    );
    return rowCount > 0;
  } catch (err) {
    if (missingTable(err)) return false;
    throw err;
  }
}

/** How many phones receive this account's alerts. 0 before the migration. */
export async function countDevices(userType, userId) {
  assertUserType(userType);
  try {
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM push_devices
        WHERE user_type = $2 AND user_id = $1 AND revoked_at IS NULL`,
      [userId, userType],
    );
    return Number(rows[0]?.n) || 0;
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

function inboxRow(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    read: Boolean(row.read_at),
  };
}

/**
 * One page of this account's alerts, newest first.
 * @returns {Promise<{items: Array, nextCursor: number|null, available: boolean}>}
 */
export async function listNotifications(userType, userId, { before = null, limit = INBOX_PAGE_SIZE } = {}) {
  assertUserType(userType);
  const size = Math.min(Math.max(Number(limit) || INBOX_PAGE_SIZE, 1), 100);
  try {
    const { rows } = await getPool().query(
      `SELECT id, kind, title, body, url, created_at, read_at
         FROM notifications
        WHERE user_type = $3 AND user_id = $1 ${before ? 'AND id < $4' : ''}
        ORDER BY id DESC
        LIMIT $2`,
      before ? [userId, size + 1, userType, before] : [userId, size + 1, userType],
    );
    const items = rows.slice(0, size).map(inboxRow);
    return { items, nextCursor: rows.length > size ? items[items.length - 1].id : null, available: true };
  } catch (err) {
    if (missingTable(err)) return { items: [], nextCursor: null, available: false };
    throw err;
  }
}

/** Unread alerts for the badge. 0 before the migration. */
export async function countUnreadNotifications(userType, userId) {
  assertUserType(userType);
  try {
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notifications
        WHERE user_type = $2 AND user_id = $1 AND read_at IS NULL`,
      [userId, userType],
    );
    return Number(rows[0]?.n) || 0;
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

/**
 * Mark one alert read and return where it points (its stored path), or null
 * when it is not this account's. Reading it also stops its late WhatsApp copy
 * (the engine's push-fallback job skips read rows).
 */
export async function openNotification(userType, userId, notificationId) {
  assertUserType(userType);
  try {
    const { rows } = await getPool().query(
      `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_type = $3 AND user_id = $2
        RETURNING url`,
      [notificationId, userId, userType],
    );
    return rows[0] ? { url: rows[0].url } : null;
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

/** "Tout marquer comme lu". @returns {Promise<number>} rows marked */
export async function markAllNotificationsRead(userType, userId) {
  assertUserType(userType);
  try {
    const { rowCount } = await getPool().query(
      `UPDATE notifications SET read_at = NOW()
        WHERE user_type = $2 AND user_id = $1 AND read_at IS NULL`,
      [userId, userType],
    );
    return rowCount;
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-category push switches (notification_preferences; no row = on)
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{prefs: Object<string, boolean>, available: boolean}>}
 *   `prefs[category]` is false only for a category the person turned off.
 */
export async function getNotificationPreferences(userType, userId) {
  assertUserType(userType);
  try {
    const { rows } = await getPool().query(
      `SELECT category, push_enabled FROM notification_preferences
        WHERE user_type = $2 AND user_id = $1`,
      [userId, userType],
    );
    const prefs = {};
    for (const row of rows) prefs[row.category] = row.push_enabled !== false;
    return { prefs, available: true };
  } catch (err) {
    if (missingTable(err)) return { prefs: {}, available: false };
    throw err;
  }
}

/** @returns {Promise<'ok'|'unavailable'>} */
export async function setNotificationPreference(userType, userId, category, enabled) {
  assertUserType(userType);
  try {
    await getPool().query(
      `INSERT INTO notification_preferences (user_type, user_id, category, push_enabled)
       VALUES ($4, $1, $2, $3)
       ON CONFLICT (user_type, user_id, category) DO UPDATE
          SET push_enabled = EXCLUDED.push_enabled, updated_at = NOW()`,
      [userId, category, Boolean(enabled), userType],
    );
    return 'ok';
  } catch (err) {
    if (missingTable(err)) return 'unavailable';
    throw err;
  }
}

// The three tables keyed by (user_type, user_id); none has a foreign key to
// agents or customers, so an account deletion clears them itself.
const PUSH_ACCOUNT_TABLES = ['push_devices', 'notifications', 'notification_preferences'];

/**
 * Inside an account deletion's transaction: remove this account's phones
 * (their FCM tokens are personal data), its inbox and its alert settings.
 * Each table runs under its own SAVEPOINT, so a database where the push
 * migration has not run (42P01) deletes the account all the same.
 * @param {import('pg').PoolClient} client  a client with an open transaction
 * @returns {Promise<number>} rows removed
 */
export async function forgetPushAccount(client, userType, userId) {
  assertUserType(userType);
  let removed = 0;
  for (const table of PUSH_ACCOUNT_TABLES) {
    await client.query('SAVEPOINT forget_push');
    try {
      const { rowCount } = await client.query(`DELETE FROM ${table} WHERE user_type = $1 AND user_id = $2`, [userType, userId]);
      removed += rowCount || 0;
      await client.query('RELEASE SAVEPOINT forget_push');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT forget_push');
      if (!missingTable(err)) throw err;
    }
  }
  return removed;
}
