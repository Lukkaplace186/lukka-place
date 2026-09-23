import 'server-only';
import { randomInt } from 'node:crypto';
import { getPool } from './db';

/**
 * "Vérifier via WhatsApp" — reverse phone verification.
 *
 * The verify screen shows a 6-digit code and a wa.me link that sends it FROM
 * the person's WhatsApp TO the Lukka Place number. The engine
 * (services/phoneChallenges.js) marks the challenge verified when that code
 * arrives from that exact number; this module then lets the verify page
 * finish the job with the same consumeAgentOtp / consumeCustomerOtp a typed
 * code would use.
 *
 * It replaces what AUTH_OTP_BYPASS used to do — skip proof altogether, which
 * let anyone register an agency's number and claim its WhatsApp listings —
 * and needs no Meta template: an inbound message always reaches us.
 *
 * Table: migrations/20260923_phone_verification_challenges.sql (engine repo).
 */

export const CHALLENGE_TTL_MS = 30 * 60 * 1000;

/** The prefilled message. The engine matches any 6-digit run from the right number. */
export function challengeMessage(code) {
  return `Code Lukka Place : ${code}`;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * The open challenge for this attempt, created if there is none. Reusing an
 * open one keeps the code on screen stable across a refresh, so a message the
 * person already sent still counts.
 *
 * @param {{role: 'agent'|'customer', id: number, phone: string}} attempt
 * @returns {Promise<{id: number, code: string, verified: boolean}>}
 */
export async function ensureChallenge({ role, id, phone }) {
  const pool = getPool();
  const number = digits(phone);
  const { rows } = await pool.query(
    `SELECT id, code, verified_at FROM phone_verification_challenges
      WHERE role = $1 AND account_id = $2 AND phone = $3 AND consumed_at IS NULL
        AND (expires_at > NOW() OR verified_at IS NOT NULL)
      ORDER BY created_at DESC LIMIT 1`,
    [role, id, number],
  );
  if (rows[0]) return { id: Number(rows[0].id), code: rows[0].code, verified: Boolean(rows[0].verified_at) };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { rows: created } = await pool.query(
    `INSERT INTO phone_verification_challenges (role, account_id, phone, code, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' milliseconds')::interval)
     RETURNING id`,
    [role, id, number, code, String(CHALLENGE_TTL_MS)],
  );
  return { id: Number(created[0].id), code, verified: false };
}

/**
 * Mark this attempt's verified challenge used. True exactly once — the caller
 * then verifies the account and opens the session.
 */
export async function consumeVerifiedChallenge({ role, id, phone }) {
  const { rows } = await getPool().query(
    `UPDATE phone_verification_challenges SET consumed_at = NOW()
      WHERE id = (
        SELECT id FROM phone_verification_challenges
         WHERE role = $1 AND account_id = $2 AND phone = $3
           AND verified_at IS NOT NULL AND consumed_at IS NULL
         ORDER BY verified_at DESC LIMIT 1
      ) AND consumed_at IS NULL
      RETURNING id`,
    [role, id, digits(phone)],
  );
  return rows.length > 0;
}

/** The wa.me link that sends the code, or null when no central number is configured. */
export function whatsappVerifyHref(code) {
  const number = digits(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(challengeMessage(code))}`;
}
