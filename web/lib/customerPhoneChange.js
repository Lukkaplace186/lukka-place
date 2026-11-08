import 'server-only';
import { cache } from 'react';
import { getPool } from './db';
import { generateOtpCode, hashOtp, verifyOtp, otpExpiresAt } from './authCrypto';
import { sendOtpViaWhatsApp } from './otpDelivery';
import { normalizeStoredPhone } from './phone';
import {
  PHONE_CHANGE_MAX_ATTEMPTS,
  PHONE_CHANGE_MAX_SENDS_PER_HOUR,
  phoneChangeCodeText,
} from './customerPhoneChangeRules';

/**
 * "Changer de numéro" (2026-11-08, owner request): a signed-in customer moves
 * the account to a new WhatsApp number. The only proof asked is a code sent
 * to the NEW number — the usual reason to change is a lost or replaced SIM,
 * so asking the old number would block exactly those people, and being
 * signed in already says who they are.
 *
 * Columns: customers.phone_change_* (one change in flight) and
 * customer_phone_history (every number the account left), from the engine's
 * migrations/20261108_customer_phone_change.sql. Before it runs, every
 * function here answers "unavailable" / falls back to the current number.
 */

const MISSING = new Set(['42703', '42P01']);

/**
 * Step 1: remember the new number and WhatsApp it a code.
 *
 * @param {number} customerId from the session, never from the form
 * @param {string} newPhone digits-only E.164, already normalized by the caller
 * @returns {Promise<{ok: true, phone: string}|{ok: false, error: 'phone'|'same'|'taken'|'rate'|'send_failed'|'unavailable'|'gone'}>}
 */
export async function requestPhoneChange(customerId, newPhone) {
  const phone = normalizeStoredPhone(newPhone);
  if (!phone) return { ok: false, error: 'phone' };
  const pool = getPool();
  const code = generateOtpCode();

  try {
    const { rows: own } = await pool.query('SELECT phone FROM customers WHERE id = $1', [customerId]);
    if (!own[0]) return { ok: false, error: 'gone' };
    if (own[0].phone === phone) return { ok: false, error: 'same' };
    const { rows: taken } = await pool.query('SELECT 1 FROM customers WHERE phone = $1 AND id <> $2', [phone, customerId]);
    if (taken.length > 0) return { ok: false, error: 'taken' };

    // The send counter and the pending change are written in one statement,
    // and only when this hour still has a send left: two taps at once can
    // never both slip past the cap.
    const { rows } = await pool.query(
      `UPDATE customers
       SET phone_change_sends = CASE
             WHEN phone_change_window_at IS NULL OR phone_change_window_at < NOW() - INTERVAL '1 hour' THEN 1
             ELSE phone_change_sends + 1 END,
           phone_change_window_at = CASE
             WHEN phone_change_window_at IS NULL OR phone_change_window_at < NOW() - INTERVAL '1 hour' THEN NOW()
             ELSE phone_change_window_at END,
           phone_change_to = $2,
           phone_change_code_hash = $3,
           phone_change_expires_at = $4,
           phone_change_attempts = 0
       WHERE id = $1
         AND (phone_change_window_at IS NULL
              OR phone_change_window_at < NOW() - INTERVAL '1 hour'
              OR phone_change_sends < $5)
       RETURNING id`,
      [customerId, phone, hashOtp(code), otpExpiresAt(), PHONE_CHANGE_MAX_SENDS_PER_HOUR],
    );
    if (rows.length === 0) return { ok: false, error: 'rate' };
  } catch (error) {
    if (MISSING.has(error?.code)) return { ok: false, error: 'unavailable' };
    throw error;
  }

  try {
    await sendOtpViaWhatsApp(phone, code, { label: 'phone-change', fallbackText: phoneChangeCodeText(code) });
  } catch (error) {
    console.error(`[phone-change] code not sent to ${phone} for customer ${customerId}: ${error.message}`);
    return { ok: false, error: 'send_failed' };
  }
  console.log(`[phone-change] code sent to ${phone} for customer ${customerId}`);
  return { ok: true, phone };
}

/**
 * Step 2: the code is right → the account's number is the new one, the old
 * one goes to customer_phone_history, every session ends (the caller signs
 * this device back in with the returned token version), and the number
 * counts as confirmed — the code just proved it.
 *
 * @returns {Promise<{ok: true, phone: string, previousPhone: string, tokenVersion: number}
 *   |{ok: false, error: 'none'|'expired'|'invalid'|'too_many'|'taken'|'unavailable'}>}
 */
export async function confirmPhoneChange(customerId, code) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT phone, phone_change_to, phone_change_code_hash, phone_change_expires_at, phone_change_attempts
       FROM customers WHERE id = $1 FOR UPDATE`,
      [customerId],
    );
    const row = rows[0];
    if (!row || !row.phone_change_to || !row.phone_change_code_hash) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'none' };
    }
    if (!row.phone_change_expires_at || new Date(row.phone_change_expires_at) <= new Date()) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'expired' };
    }
    if (Number(row.phone_change_attempts) >= PHONE_CHANGE_MAX_ATTEMPTS) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'too_many' };
    }
    if (!verifyOtp(String(code || '').replace(/\D/g, ''), row.phone_change_code_hash)) {
      await client.query('UPDATE customers SET phone_change_attempts = phone_change_attempts + 1 WHERE id = $1', [customerId]);
      await client.query('COMMIT');
      const left = PHONE_CHANGE_MAX_ATTEMPTS - Number(row.phone_change_attempts) - 1;
      return { ok: false, error: left > 0 ? 'invalid' : 'too_many' };
    }

    await client.query('INSERT INTO customer_phone_history (customer_id, phone) VALUES ($1, $2)', [customerId, row.phone]);
    const { rows: updated } = await client.query(
      `UPDATE customers
       SET phone = phone_change_to,
           phone_verified_at = NOW(),
           phone_change_to = NULL, phone_change_code_hash = NULL,
           phone_change_expires_at = NULL, phone_change_attempts = 0,
           reset_otp_code_hash = NULL, reset_otp_expires_at = NULL,
           failed_login_count = 0, locked_until = NULL,
           token_version = token_version + 1
       WHERE id = $1
       RETURNING phone, token_version`,
      [customerId],
    );
    await client.query('COMMIT');
    return { ok: true, phone: updated[0].phone, previousPhone: row.phone, tokenVersion: updated[0].token_version };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Someone signed up on that number between the code and now.
    if (error?.code === '23505') return { ok: false, error: 'taken' };
    if (MISSING.has(error?.code)) return { ok: false, error: 'unavailable' };
    throw error;
  } finally {
    client.release();
  }
}

/** Drops the change in flight ("Changer le numéro saisi"). */
export async function cancelPhoneChange(customerId) {
  const pool = getPool();
  try {
    await pool.query(
      `UPDATE customers
       SET phone_change_to = NULL, phone_change_code_hash = NULL, phone_change_expires_at = NULL, phone_change_attempts = 0
       WHERE id = $1`,
      [customerId],
    );
  } catch (error) {
    if (!MISSING.has(error?.code)) throw error;
  }
}

/**
 * The change waiting for its code, if its code is still valid. Read through
 * to_jsonb so the page renders before the migration (it then has none).
 * @returns {Promise<{phone: string, expiresAt: string}|null>}
 */
export async function getPendingPhoneChange(customerId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT to_jsonb(c) ->> 'phone_change_to' AS phone,
            to_jsonb(c) ->> 'phone_change_expires_at' AS expires_at
     FROM customers c WHERE c.id = $1`,
    [customerId],
  );
  const row = rows[0];
  if (!row?.phone || !row.expires_at || new Date(row.expires_at) <= new Date()) return null;
  return { phone: row.phone, expiresAt: row.expires_at };
}

/**
 * Every number this account has held, current first. Requests and visits
 * live in the engine keyed by wa_id, so the account reads them under each.
 * An unreadable history (table missing) is just the current number.
 * Memoised per request.
 *
 * @returns {Promise<string[]>}
 */
export const getAccountPhones = cache(async (customerId, currentPhone) => {
  const phones = currentPhone ? [currentPhone] : [];
  try {
    const { rows } = await getPool().query(
      `SELECT phone FROM customer_phone_history WHERE customer_id = $1 ORDER BY changed_at DESC LIMIT 10`,
      [customerId],
    );
    for (const { phone } of rows) if (phone && !phones.includes(phone)) phones.push(phone);
  } catch (error) {
    if (!MISSING.has(error?.code)) console.warn('[phone-change] history unreadable:', error.message);
  }
  return phones;
});
