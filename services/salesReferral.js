/**
 * services/salesReferral.js
 *
 * The WhatsApp half of the launch sales-rep referral policy (web half:
 * web/lib/salesLaunch.js, web/lib/salesReferral.js).
 *
 * A rep hands an agent a wa.me link whose pre-typed first message ends with
 * "Code parrainage : JEAN01". This module:
 *   1. recognises that phrase DETERMINISTICALLY — a regex plus a lookup of
 *      the real code in Postgres, never the model;
 *   2. remembers the first VALID code per sender in SQLite
 *      (`sales_referral_captures`), because the agent account does not exist
 *      yet — WhatsApp onboarding creates it only after their first listing and
 *      their name (services/agentOnboarding.js);
 *   3. turns that capture into the permanent `sales_agent_attributions` row
 *      inside the same transaction that creates the account, so an account is
 *      never attributed that was not new.
 *
 * Refusals (unknown or inactive code, self-referral, an existing agent) are
 * recorded in `sales_referral_refusals` for the disputes page and never
 * credited. Nothing here can stop a listing from being processed: a message
 * that is more than the referral phrase always falls through to intake.
 */

const db = require('./db');
const chakra = require('./chakra');
const { getPool, isConfigured } = require('./postgres');

/**
 * Only the "parrain…" wording, never "réf": listings carry "Réf: LKP-2026-0091"
 * all the time. Same code format as web/lib/launchCommission.js's
 * REFERRAL_CODE_PATTERN (3–10 letters, 2 digits) — change one, change the other.
 */
const REFERRAL_PHRASE = /(?:code\s+(?:de\s+)?parrain\w*|parrain\w*)\s*[:#=\-–]?\s*([A-Za-z]{3,10}\s?[0-9]{2})(?![0-9A-Za-z])/i;
const CODE_FORMAT = /^[A-Z]{3,10}[0-9]{2}$/;

/** Longest message still treated as "just the referral" rather than content to process. */
const REFERRAL_ONLY_MAX_CHARS = 240;

function normaliseDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** @returns {string|null} the code, uppercased */
function extractReferralCode(text) {
  const match = REFERRAL_PHRASE.exec(String(text || ''));
  if (!match) return null;
  const code = match[1].replace(/\s/g, '').toUpperCase();
  return CODE_FORMAT.test(code) ? code : null;
}

/** The text without the referral phrase — so "Jean Kabeya, Agence X, code parrainage JEAN01" still parses as a name. */
function stripReferralPhrase(text) {
  return String(text || '')
    .replace(REFERRAL_PHRASE, ' ')
    .replace(/[\s,;.:\-–]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Is this message nothing but the rep's pre-typed greeting and the code? Short,
 * and no digits left once the phrase is gone — a property advert always has a
 * price, a room count or a phone number in it.
 */
function isReferralOnlyMessage(text) {
  const rest = stripReferralPhrase(text);
  return String(text || '').length <= REFERRAL_ONLY_MAX_CHARS && !/\d/.test(rest);
}

async function findRep(code) {
  const { rows } = await getPool().query(
    'SELECT id, full_name, phone, status FROM sales_reps WHERE referral_code = $1',
    [code],
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

async function findExistingAgentId(digits) {
  const { rows } = await getPool().query(
    "SELECT id FROM agents WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1",
    [digits],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function recordRefusal({ repId = null, code, agentId = null, reason }, client = null) {
  try {
    await (client || getPool()).query(
      `INSERT INTO sales_referral_refusals (rep_id, referral_code, agent_id, channel, reason) VALUES ($1, $2, $3, 'whatsapp', $4)`,
      [repId, code ? String(code).slice(0, 40) : null, agentId, reason],
    );
  } catch (err) {
    console.warn(`[sales-referral] could not record refusal (${reason}): ${err.message}`);
  }
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

const REPLIES = {
  welcome: (code, repName) => [
    'Bienvenue sur Lukka Place ! 👋',
    code ? `Code parrainage *${code}*${repName ? ` (${repName})` : ''} bien noté.` : null,
    '',
    'Pour créer votre compte agent, envoyez-nous simplement votre premier bien : des photos et une description (type de bien, commune, prix, nombre de chambres).',
    'Nous vous demanderons ensuite votre nom et celui de votre agence — tout se fait ici, sur WhatsApp.',
  ].filter((line) => line !== null).join('\n'),
  alreadyCaptured: (code) => [
    'Bienvenue sur Lukka Place ! 👋',
    `Votre numéro est déjà associé au code parrainage *${code}* : c’est celui-ci qui sera retenu.`,
    '',
    'Envoyez-nous votre premier bien (photos + description) pour créer votre compte agent.',
  ].join('\n'),
  unknown: (code) => [
    `Nous ne reconnaissons pas le code parrainage *${code}*.`,
    'Vérifiez-le auprès de votre commercial Lukka Place et renvoyez-le, ou envoyez directement votre premier bien pour vous inscrire sans code.',
  ].join('\n'),
  existingAgent: () => [
    'Votre compte agent Lukka Place existe déjà ✅',
    'Un code de parrainage ne s’applique qu’à une première inscription. Vous pouvez continuer à nous envoyer vos biens ici.',
  ].join('\n'),
};

/**
 * Called from routes/webhook.js for every text message. Returns
 * `{ handled: true }` only when the message was nothing but the referral and
 * a reply was sent; everything else falls through to ordinary processing.
 *
 * @param {{from: string, text: string, canReply: boolean, midOnboarding?: boolean, primaryWamid?: string}} input
 */
async function handleReferralMessage({ from, text, canReply, midOnboarding = false, primaryWamid = null }) {
  const code = extractReferralCode(text);
  if (!code) return { handled: false };
  const digits = normaliseDigits(from);
  const replyAllowed = canReply && !midOnboarding && isReferralOnlyMessage(text);

  async function reply(message) {
    await chakra.sendWhatsAppMessage(from, message, { replyToMessageId: primaryWamid || undefined });
    return { handled: true, code };
  }

  // Without Postgres the code cannot be checked; remember it and let the
  // account-creation step validate it later.
  if (!isConfigured()) {
    db.recordReferralCapture(digits, code);
    return { handled: false, code };
  }

  let rep;
  let existingAgentId;
  try {
    [rep, existingAgentId] = await Promise.all([findRep(code), findExistingAgentId(digits)]);
  } catch (err) {
    console.warn(`[sales-referral] lookup failed for ${from}, keeping ${code} for later: ${err.message}`);
    db.recordReferralCapture(digits, code);
    return { handled: false, code };
  }

  if (existingAgentId) {
    await recordRefusal({ repId: rep?.id ?? null, code, agentId: existingAgentId, reason: 'existing_agent' });
    console.log(`[sales-referral] ${from} sent ${code} but already has agent #${existingAgentId} — not credited`);
    return replyAllowed ? reply(REPLIES.existingAgent()) : { handled: false, code };
  }

  if (!rep || rep.status !== 'active') {
    await recordRefusal({ repId: rep?.id ?? null, code, reason: rep ? 'inactive_rep' : 'unknown_code' });
    console.log(`[sales-referral] ${from} sent ${rep ? 'an inactive' : 'an unknown'} code ${code}`);
    return replyAllowed ? reply(REPLIES.unknown(code)) : { handled: false, code };
  }

  if (rep.phone && normaliseDigits(rep.phone) === digits) {
    await recordRefusal({ repId: rep.id, code, reason: 'self_referral' });
    console.log(`[sales-referral] ${from} tried their own code ${code} — not credited`);
    return replyAllowed ? reply(REPLIES.welcome(null)) : { handled: false, code };
  }

  const capture = db.recordReferralCapture(digits, code);
  if (capture && capture.referral_code !== code) {
    console.log(`[sales-referral] ${from} sent ${code}; keeping first code ${capture.referral_code}`);
    return replyAllowed ? reply(REPLIES.alreadyCaptured(capture.referral_code)) : { handled: false, code };
  }
  console.log(`[sales-referral] ${from} referred by ${code} (rep #${rep.id})`);
  return replyAllowed ? reply(REPLIES.welcome(code, firstName(rep.full_name))) : { handled: false, code };
}

/**
 * Writes the permanent attribution for an agent account created THIS
 * transaction (services/agentOnboarding.js's upsertAgentFromWhatsApp). Inside a
 * SAVEPOINT: a missing table or a bad code must never cost the agent their
 * account. The code is re-checked here — the capture may be days old.
 *
 * @returns {Promise<{attributed: boolean, repId?: number, reason?: string}>}
 */
async function attributeNewAgentInTransaction(client, { agentId, waId }) {
  const digits = normaliseDigits(waId);
  const capture = db.getReferralCapture(digits);
  if (!capture) return { attributed: false, reason: 'no_code' };

  await client.query('SAVEPOINT sales_referral');
  try {
    const { rows } = await client.query('SELECT id, phone, status FROM sales_reps WHERE referral_code = $1', [capture.referral_code]);
    const rep = rows[0];
    let reason = null;
    if (!rep) reason = 'unknown_code';
    else if (rep.status !== 'active') reason = 'inactive_rep';
    else if (rep.phone && normaliseDigits(rep.phone) === digits) reason = 'self_referral';

    if (reason) {
      await recordRefusal({ repId: rep ? Number(rep.id) : null, code: capture.referral_code, agentId, reason }, client);
      await client.query('RELEASE SAVEPOINT sales_referral');
      console.log(`[sales-referral] agent #${agentId} not attributed (${reason}, code ${capture.referral_code})`);
      return { attributed: false, reason };
    }

    const inserted = await client.query(
      `INSERT INTO sales_agent_attributions (agent_id, rep_id, referral_code, source, attributed_at, credit_from, agent_registered_at)
       VALUES ($1, $2, $3, 'whatsapp_code', NOW(), NOW(), NOW())
       ON CONFLICT (agent_id) DO NOTHING
       RETURNING agent_id`,
      [agentId, rep.id, capture.referral_code],
    );
    if (inserted.rowCount > 0) {
      await client.query(
        `INSERT INTO sales_account_assignments (rep_id, agent_id, credit_from)
         SELECT $1, $2, NOW()
         WHERE NOT EXISTS (SELECT 1 FROM sales_account_assignments WHERE agent_id = $2 AND ended_at IS NULL)`,
        [rep.id, agentId],
      );
    }
    await client.query('RELEASE SAVEPOINT sales_referral');
    console.log(`[sales-referral] agent #${agentId} attributed to rep #${rep.id} (${capture.referral_code})`);
    return { attributed: inserted.rowCount > 0, repId: Number(rep.id) };
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT sales_referral').catch(() => {});
    console.error(`[sales-referral] attribution failed for agent #${agentId}: ${err.message}`);
    return { attributed: false, reason: 'error' };
  }
}

module.exports = {
  extractReferralCode,
  stripReferralPhrase,
  isReferralOnlyMessage,
  handleReferralMessage,
  attributeNewAgentInTransaction,
  REPLIES,
  REFERRAL_ONLY_MAX_CHARS,
};
