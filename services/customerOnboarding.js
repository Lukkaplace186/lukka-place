/**
 * A CUSTOMER account created from one WhatsApp message (growth plan item 23),
 * the mirror of agent onboarding (services/agentOnboarding.js).
 *
 * The storefront's "Créer mon compte via WhatsApp" opens WhatsApp with
 * "Inscription Lukka Place" pre-typed (web/lib/whatsappSignup.js), plus
 * "— Code : NADIA01" when a partner's link brought the visitor. That message,
 * FROM the number, is the proof the number is theirs — stronger than a code
 * sent TO it — so the account is created already verified, and the reply
 * carries a single-use link (72 h, only its SHA-256 stored) where the
 * customer sets a password: web /compte/activer.
 *
 * It also opens the 24-hour window, so the alerts that customer sets up next
 * actually reach them.
 *
 * Deterministic and narrow: only the pre-typed wording is matched (it must
 * START with "Inscription Lukka Place"), never "parrainage" (the sales reps'
 * wording, services/salesReferral.js). Everything here runs in one Postgres
 * transaction; a failure answers "réessayez" and creates nothing.
 */

const crypto = require('crypto');
const chakra = require('./chakra');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const ACTIVATION_TTL_HOURS = 72;
const SIGNUP_RE = /^\s*inscription\s+(?:sur\s+)?lukka\s*place\b/i;
const CODE_RE = /\bcode\s*[:：-]?\s*([A-Za-z]{3,10}\d{2})\b/i;

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '');

function isSignupMessage(text) {
  return SIGNUP_RE.test(String(text || '')) && String(text).length <= 240;
}

function codeIn(text) {
  const match = CODE_RE.exec(String(text || ''));
  return match ? match[1].toUpperCase() : null;
}

function activationLink(digits, token) {
  return `${SITE_URL}/compte/activer?phone=${encodeURIComponent(digits)}&token=${encodeURIComponent(token)}`;
}

function welcomeText(link) {
  return [
    '✅ *Votre compte Lukka Place est créé !*',
    '',
    `Choisissez votre mot de passe ici (lien valable 3 jours) : ${link}`,
    '',
    'Ensuite : enregistrez les biens qui vous plaisent et créez une alerte — vous recevrez les nouveaux biens ici, sur WhatsApp.',
  ].join('\n');
}

function existingText() {
  return [
    'Vous avez déjà un compte Lukka Place avec ce numéro.',
    `Connectez-vous ici : ${SITE_URL}/compte/connexion`,
    `Mot de passe oublié ? ${SITE_URL}/mot-de-passe-oublie`,
  ].join('\n');
}

const FAILED_TEXT = 'Désolé, votre compte n’a pas pu être créé pour le moment. Réessayez dans quelques minutes.';

/**
 * Creates the account (or finds it), credits the partner the code names, and
 * records where the account came from. Exported for the tests.
 *
 * @returns {Promise<{created: boolean, customerId: number, token: string|null, partnerCode: string|null}>}
 */
async function createCustomerFromWhatsApp({ waId, code = null }, pool = require('./postgres').getPool()) {
  const digits = digitsOf(waId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`customer-phone:${digits}`]);
    const existing = await client.query('SELECT id FROM customers WHERE phone = $1', [digits]);
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { created: false, customerId: Number(existing.rows[0].id), token: null, partnerCode: null };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
    // No usable password until the link sets one: '!' is never a valid hash.
    const inserted = await client.query(
      `INSERT INTO customers (phone, password_hash, phone_verified_at, activation_token_hash, activation_expires_at, signup_channel)
       VALUES ($1, '!whatsapp', NOW(), $2, $3, 'whatsapp')
       RETURNING id`,
      [digits, tokenHash, expiresAt],
    );
    const customerId = Number(inserted.rows[0].id);

    let partnerCode = null;
    let partnerId = null;
    if (code) {
      await client.query('SAVEPOINT customer_partner');
      try {
        const { rows } = await client.query(
          `SELECT p.id, p.code, p.kind, a.phone AS agent_phone
             FROM partners p LEFT JOIN agents a ON a.id = p.agent_id
            WHERE p.code = $1 AND p.status = 'active'
              AND (p.agent_id IS NULL OR (a.deleted_at IS NULL AND a.status = 1))`,
          [code],
        );
        const partner = rows[0];
        // Never the agent's own number (web lib/referralRules.js "never earns").
        if (partner && !(partner.kind === 'agent' && digitsOf(partner.agent_phone) === digits)) {
          await client.query(
            `INSERT INTO partner_conversions (partner_id, account_type, account_id, event, via)
             VALUES ($1, 'customer', $2, 'signup', 'form_code')
             ON CONFLICT (account_type, account_id, event) DO NOTHING`,
            [partner.id, customerId],
          );
          partnerCode = partner.code;
          partnerId = Number(partner.id);
        }
        await client.query('RELEASE SAVEPOINT customer_partner');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT customer_partner').catch(() => {});
        if (err?.code !== '42P01') console.error(`[customer-onboarding] partner ${code} not credited: ${err.message}`);
      }
    }

    await client.query('SAVEPOINT customer_acquisition');
    try {
      await client.query(
        `INSERT INTO account_acquisitions (account_type, account_id, channel, ref_code, partner_id)
         VALUES ('customer', $1, 'whatsapp', $2, $3)
         ON CONFLICT (account_type, account_id) DO NOTHING`,
        [customerId, partnerCode || code || null, partnerId],
      );
      await client.query('RELEASE SAVEPOINT customer_acquisition');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT customer_acquisition').catch(() => {});
      if (err?.code !== '42P01') console.error(`[customer-onboarding] acquisition for #${customerId} not recorded: ${err.message}`);
    }

    await client.query('COMMIT');
    return { created: true, customerId, token, partnerCode };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The webhook branch. `handled: false` for anything that is not the signup
 * wording, so it falls through untouched.
 *
 * @returns {Promise<{handled: boolean}>}
 */
async function handleCustomerSignupMessage({ from, text, primaryWamid = null }, deps = {}) {
  if (!isSignupMessage(text)) return { handled: false };
  const send = deps.send || chakra.sendWhatsAppMessage;
  const digits = digitsOf(from);
  let reply;
  try {
    const result = await createCustomerFromWhatsApp({ waId: digits, code: codeIn(text) }, deps.pool);
    reply = result.created ? welcomeText(activationLink(digits, result.token)) : existingText();
    console.log(`[customer-onboarding] ${result.created ? 'created' : 'existing'} customer #${result.customerId} from …${digits.slice(-4)}${result.partnerCode ? ` (code ${result.partnerCode})` : ''}`);
  } catch (err) {
    console.error(`[customer-onboarding] ${primaryWamid || ''} from …${digits.slice(-4)} failed: ${err.message}`);
    reply = FAILED_TEXT;
  }
  await send(digits, reply).catch((err) => console.error(`[customer-onboarding] reply failed: ${err.message}`));
  return { handled: true };
}

module.exports = {
  isSignupMessage,
  codeIn,
  activationLink,
  welcomeText,
  createCustomerFromWhatsApp,
  handleCustomerSignupMessage,
  ACTIVATION_TTL_HOURS,
};
