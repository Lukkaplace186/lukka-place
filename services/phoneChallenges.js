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

const EXPIRED_REPLY =
  'Ce code n’est plus valable (il expire après 30 minutes). Retournez sur lukkaplace.com : '
  + 'la page de vérification affiche un nouveau code à envoyer.';

const SIGNUP_PATHS = {
  customer: 'https://lukkaplace.com/compte/inscription',
  agent: 'https://lukkaplace.com/compte/agent/inscription',
};

/**
 * The code is right but the sender is not: the account was opened on one
 * number and the person's WhatsApp runs on another (2026-10-26: a customer
 * registered on her Congolese number, her WhatsApp on her French one, and
 * every code she sent got the agent how-to reply). Only last digits are
 * named — the verify page already shows those to whoever holds the code.
 */
function wrongNumberReply({ challengePhone, senderPhone, role }) {
  return `Ce code a été créé pour le numéro se terminant par ${challengePhone.slice(-4)}, `
    + `mais vous écrivez depuis un WhatsApp qui se termine par ${senderPhone.slice(-4)}.\n\n`
    + 'Le code doit être envoyé depuis le WhatsApp du numéro de votre compte. '
    + 'Si votre WhatsApp est sur un autre numéro, créez votre compte avec ce numéro-là : '
    + (SIGNUP_PATHS[role] || SIGNUP_PATHS.customer);
}

function candidateCodes(text) {
  return [...new Set((String(text || '').match(/(?<!\d)\d{6}(?!\d)/g) || []))].slice(0, 5);
}

/**
 * The verify page's own prefilled wording (web/lib/whatsappVerify.js). Only
 * a message that says it is a verification code is explained when it fails;
 * any other 6-digit run (a price) still falls through to intake untouched.
 */
function isVerificationMessage(text) {
  return /code\s+lukka\s*place/i.test(String(text || ''));
}

/** Why a verification message matched nothing: wrong sender, or no open code. */
async function explainMiss({ phone, codes }) {
  const { rows } = await pg.getPool().query(
    `SELECT phone, role FROM phone_verification_challenges
      WHERE code = ANY($1::text[]) AND phone <> $2
        AND consumed_at IS NULL AND verified_at IS NULL AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [codes, phone],
  );
  if (rows[0]) {
    console.log(`[verify] ${phone} sent a code opened for …${String(rows[0].phone).slice(-4)} — wrong number`);
    return { handled: true, reply: wrongNumberReply({ challengePhone: String(rows[0].phone), senderPhone: phone, role: rows[0].role }) };
  }
  console.log(`[verify] ${phone} sent a code with no open challenge — expired or unknown`);
  return { handled: true, reply: EXPIRED_REPLY };
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
    if (!rows.length) return isVerificationMessage(text) ? await explainMiss({ phone, codes }) : { handled: false };
    console.log(`[verify] ${phone} proved their number (challenge #${rows[0].id})`);
    return { handled: true, reply: VERIFIED_REPLY, challengeId: Number(rows[0].id) };
  } catch (err) {
    // Table missing (migration not run) or Postgres down: never block intake.
    if (err.code !== '42P01') console.warn(`[verify] challenge lookup failed: ${err.message}`);
    return { handled: false };
  }
}

module.exports = { matchPhoneChallenge, candidateCodes, isVerificationMessage, wrongNumberReply, VERIFIED_REPLY, EXPIRED_REPLY };
