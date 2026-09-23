/**
 * services/phoneChallenges.js
 *
 * The engine half of "Vérifier via WhatsApp" (web/lib/whatsappVerify.js,
 * migrations/20260923_phone_verification_challenges.sql).
 *
 * The web verify screen shows a 6-digit code; the person sends it from their
 * own WhatsApp. When a message from number X carries a code that matches an
 * open challenge FOR X, the challenge is marked verified. The web page, which
 * polls, then verifies the account exactly as a typed OTP would.
 *
 * The rule that makes this safe: the challenge is matched on the SENDER's
 * number and the code together. A code alone proves nothing; a number alone
 * would let an agent's ordinary messages verify an account somebody else
 * opened on their number (root CLAUDE.md, "Why the phone_verified_at gate is
 * the same one twice").
 *
 * Deterministic and ahead of the model: only messages holding a 6-digit run
 * pay a query, and only a real open challenge claims the message — a price of
 * "150000" from an agent with no challenge falls straight through.
 */

const pg = require('./postgres');

const VERIFIED_REPLY =
  '✅ Numéro vérifié ! Retournez sur lukkaplace.com : votre compte s’ouvre automatiquement.';

/** A redelivered verification message within this window is absorbed, not re-processed as a listing. */
const REDELIVERY_WINDOW = '15 minutes';

function candidateCodes(text) {
  return [...new Set((String(text || '').match(/(?<!\d)\d{6}(?!\d)/g) || []))].slice(0, 5);
}

/**
 * @param {{from: string, text: string}} message
 * @returns {Promise<{handled: boolean, reply?: string, challengeId?: number}>}
 */
async function matchPhoneChallenge({ from, text }) {
  const codes = candidateCodes(text);
  const phone = String(from || '').replace(/\D/g, '');
  if (!codes.length || !phone || !pg.isConfigured()) return { handled: false };

  try {
    const { rows } = await pg.getPool().query(
      `UPDATE phone_verification_challenges
          SET verified_at = COALESCE(verified_at, NOW())
        WHERE phone = $1 AND code = ANY($2::text[])
          AND consumed_at IS NULL
          AND (
            (verified_at IS NULL AND expires_at > NOW())
            OR verified_at > NOW() - INTERVAL '${REDELIVERY_WINDOW}'
          )
        RETURNING id`,
      [phone, codes],
    );
    if (!rows.length) return { handled: false };
    console.log(`[verify] ${phone} proved their number (challenge #${rows[0].id})`);
    return { handled: true, reply: VERIFIED_REPLY, challengeId: Number(rows[0].id) };
  } catch (err) {
    // Table missing (migration not run) or Postgres down: never block intake.
    if (err.code !== '42P01') console.warn(`[verify] challenge lookup failed: ${err.message}`);
    return { handled: false };
  }
}

module.exports = { matchPhoneChallenge, candidateCodes, VERIFIED_REPLY };
