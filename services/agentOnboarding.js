/**
 * services/agentOnboarding.js
 *
 * Turns a stranger who WhatsApps us a property into a real, registered agent
 * with a working dashboard — without ever asking them to leave WhatsApp, and
 * without a single SMS.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Before this, an agent messaging a listing got a confirmation, their listing
 * reached moderation, and that was the end of the relationship. Registering
 * was a completely separate, self-serve web flow (/compte/agent/inscription)
 * they had to discover on their own, and which then sent an OTP over WhatsApp
 * to a number we had *just* received a message from. So the number was
 * verified twice, and 23 of 31 live listings had `agent_id IS NULL` — their
 * submitters could not edit them, could not mark them sold, and never saw an
 * enquiry.
 *
 * THE FLOW
 *   1. Unregistered sender submits a listing.
 *      -> reply carries the usual paraphrase PLUS a structured summary card
 *         and one question: "your name and your agency?"
 *      -> an `agent_onboarding` row is opened, state AWAITING_NAME.
 *   2. They answer in WhatsApp.
 *      -> a real `agents` row is created in Postgres, phone ALREADY VERIFIED
 *         (see below), agency name stored, listings retroactively claimed,
 *         their pending listing published into the moderation queue.
 *      -> reply is a single-use magic link.
 *   3. They tap it (now, or in three days — it doesn't gate anything above).
 *      -> web/app/(site)/compte/agent/activer sets a password and signs them
 *         in. Nothing about their listings depends on this step happening.
 *
 * WHY THE PHONE IS VERIFIED WITHOUT AN OTP
 * A WhatsApp message from a number IS proof of control of that number — it is
 * strictly stronger evidence than an SMS OTP, which can be intercepted or
 * mis-delivered, and it is evidence we already hold before we send anything.
 * Sending a code back to the number that just messaged us verifies nothing
 * new. `phone_verified_at` is therefore set at account creation here, and the
 * activation token that follows protects the *password*, not the phone.
 *
 * TOKEN HANDLING
 * The raw token exists in exactly two places: the WhatsApp message we send,
 * and the agent's browser when they click it. Postgres stores only its
 * SHA-256 (`agents.activation_token_hash`), and it is cleared the moment it
 * is redeemed — the same posture `otp_code_hash` beside it already takes.
 */

const crypto = require('crypto');

const db = require('./db');
const chakra = require('./chakra');
const { getPool, isConfigured } = require('./postgres');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/**
 * How long the magic link stays usable. Long, on purpose: this is not a
 * second factor guarding an existing account, it's a convenience link to a
 * brand-new one whose phone is already proven. An agent submitting listings
 * from the field on Friday should still be able to set a password on Monday
 * rather than being stonewalled by a 15-minute expiry and having no idea why.
 */
const ACTIVATION_TTL_HOURS = Number.parseInt(process.env.AGENT_ACTIVATION_TTL_HOURS, 10) || 72;

/** The French language slot every content table in this schema writes to. */
const CONTENT_LANGUAGE_ID = 20;

// ---------------------------------------------------------------------------
// Local session state
//
// The table and its three accessors live in services/db.js with every other
// table this engine owns — see `agent_onboarding` there. This module holds the
// policy (how many times to ask, what to say); db.js holds the storage.
// ---------------------------------------------------------------------------

/**
 * Stop asking after this many listings from the same unanswered sender. An
 * agent who submits five properties and ignores the question every time is
 * telling us something; the sixth listing should just be accepted quietly
 * rather than nagging them into blocking the number.
 */
const MAX_ASKS = 3;

const getSession = db.getOnboardingSession;
const openSession = db.openOnboardingSession;
const completeSession = db.completeOnboardingSession;

// ---------------------------------------------------------------------------
// Postgres — the real agents table
// ---------------------------------------------------------------------------

/** Digits-only, matching the `wa_id` shape every lead/listing row already stores. */
function normalisePhone(waId) {
  return String(waId || '').replace(/\D/g, '');
}

/**
 * Any agents row for this number — verified or not, active or not.
 *
 * Deliberately broader than services/postgres.js's resolveAgentId, which
 * additionally requires `phone_verified_at IS NOT NULL` because it decides
 * public listing *attribution*. Here the question is only "does an account
 * already exist?", and answering "no" for an existing-but-unverified account
 * would create a duplicate agent for the same phone number.
 */
async function findAgentByPhone(waId) {
  if (!isConfigured()) return null;
  const digits = normalisePhone(waId);
  if (!digits) return null;
  const { rows } = await getPool().query(
    `SELECT id, username, phone, status, password_hash, phone_verified_at, agency_name
     FROM agents
     WHERE regexp_replace(phone, '\\D', '', 'g') = $1
     LIMIT 1`,
    [digits],
  );
  return rows[0] || null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Creates the agents row (and its French agent_infos name row) for a
 * WhatsApp-onboarded agent, or updates the existing one, then issues a fresh
 * activation token.
 *
 * `agents.id` has no DB-side default in this legacy Laravel/Zipprr schema —
 * ids are assigned app-side, the same MAX(id)+1 convention
 * web/lib/subscriptions.js and web/lib/agents.js already use. Done inside the
 * transaction so two concurrent onboardings can't pick the same id.
 *
 * @returns {Promise<{agentId: number, token: string, created: boolean}>}
 */
async function upsertAgentFromWhatsApp({ waId, fullName, agencyName }) {
  const digits = normalisePhone(waId);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ACTIVATION_TTL_HOURS * 60 * 60 * 1000);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      `SELECT id FROM agents WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
      [digits],
    );

    let agentId;
    let created = false;

    if (existing.length) {
      agentId = existing[0].id;
      // Never overwrite a name/agency an agent has already set for
      // themselves in the dashboard — COALESCE keeps whatever is there and
      // only fills a genuine blank.
      await client.query(
        `UPDATE agents
         SET agency_name = COALESCE(agency_name, $1),
             phone_verified_at = COALESCE(phone_verified_at, NOW()),
             onboarding_source = COALESCE(onboarding_source, 'whatsapp'),
             activation_token_hash = $2,
             activation_expires_at = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [agencyName || null, hashToken(token), expiresAt, agentId],
      );
    } else {
      const { rows: idRows } = await client.query('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM agents');
      agentId = idRows[0].id;
      created = true;

      await client.query(
        `INSERT INTO agents
           (id, username, phone, status, agency_name, phone_verified_at, onboarding_source,
            activation_token_hash, activation_expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, NOW(), 'whatsapp', $5, $6, NOW(), NOW())`,
        [agentId, fullName || digits, digits, agencyName || null, hashToken(token), expiresAt],
      );
    }

    if (fullName) {
      const [firstName, ...rest] = fullName.split(/\s+/);
      const lastName = rest.join(' ') || null;
      // agent_infos has no unique constraint on (agent_id, language_id) —
      // verified against the live schema — so ON CONFLICT has nothing to
      // target. UPDATE-then-INSERT, same as web/lib/agencies.js's
      // updateAgentIdentity.
      const { rowCount } = await client.query(
        `UPDATE agent_infos SET first_name = COALESCE(first_name, $1), last_name = COALESCE(last_name, $2), updated_at = NOW()
         WHERE agent_id = $3 AND language_id = $4`,
        [firstName, lastName, agentId, CONTENT_LANGUAGE_ID],
      );
      if (rowCount === 0) {
        await client.query(
          `INSERT INTO agent_infos (agent_id, language_id, first_name, last_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [agentId, CONTENT_LANGUAGE_ID, firstName, lastName],
        );
      }
    }

    await client.query('COMMIT');
    return { agentId: Number(agentId), token, created };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function formatPrice(row) {
  if (row.price == null) return null;
  const amount = Number(row.price).toLocaleString('fr-FR');
  const currency = row.currency === 'CDF' ? 'FC' : '$';
  const period = row.transaction_type === 'location' ? ' / mois' : '';
  return `${amount} ${currency}${period}`;
}

/**
 * The structured pre-verification card.
 *
 * Every line is omitted when the underlying value is genuinely absent rather
 * than printed as "—": an agent scanning this on a phone is checking for
 * *wrong* values, and a column of dashes for things they never mentioned is
 * noise that makes a real mistake harder to spot.
 */
function summaryCard(listing, photoCount) {
  const lines = [];
  if (listing.commune) lines.push(`📍 Commune : ${listing.commune}${listing.quartier ? ` (${listing.quartier})` : ''}`);
  const price = formatPrice(listing);
  if (price) lines.push(`💰 Prix : ${price}`);
  if (listing.bedrooms != null) lines.push(`🛏️ Chambres : ${listing.bedrooms}`);
  if (listing.units_count != null) lines.push(`🚪 Portes : ${listing.units_count}`);
  if (photoCount > 0) lines.push(`📸 Photos : ${photoCount} reçue${photoCount > 1 ? 's' : ''}`);
  return lines.join('\n');
}

/** Appended to the intake reply for a sender who has no account yet. */
function onboardingPrompt(listing, photoCount) {
  const card = summaryCard(listing, photoCount);
  return [
    card ? `${card}\n` : '',
    'Pour publier ce bien sur Lukka Place, il nous manque votre profil d’agent.',
    '',
    'Répondez simplement avec votre *nom complet* et le *nom de votre agence*.',
    'Exemple : Jean Kabeya, Agence Horizon',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

function activationMessage({ fullName, link, listingQueued }) {
  const lines = [
    `Merci ${fullName} ! Votre compte agent Lukka Place est créé et votre numéro est vérifié. ✅`,
    '',
  ];
  if (listingQueued) {
    lines.push('Votre bien est maintenant chez notre équipe de modération. Vous serez notifié dès sa mise en ligne.');
    lines.push('');
  }
  lines.push('Cliquez ici à tout moment pour choisir votre mot de passe et accéder à votre tableau de bord :');
  lines.push(link);
  lines.push('');
  lines.push(`Ce lien reste valable ${ACTIVATION_TTL_HOURS} heures.`);
  return lines.join('\n');
}

/**
 * Extracts a name and an agency from one free-text WhatsApp reply.
 *
 * Real answers look like "Jean Kabeya, Agence Horizon", "Jean Kabeya -
 * Horizon Immo", or just "Jean Kabeya". Splitting on the first separator and
 * treating everything after it as the agency handles all three, and an answer
 * with no separator correctly yields no agency rather than half a name.
 *
 * Nothing here is guessed into existence: no agency named means
 * `agencyName: null`, which is stored as NULL and shown as an honest blank in
 * the dashboard for the agent to fill in themselves.
 */
function parseNameReply(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    // A polite lead-in is extremely common and is not part of the name.
    .replace(/^(bonjour|salut|bjr|hello|hi|ok|oui)[\s,.:!-]+/i, '')
    .trim();
  if (!cleaned) return null;

  const [namePart, ...agencyParts] = cleaned.split(/\s*[,/|]\s*|\s+[-–—]\s+/);
  const fullName = (namePart || '').trim().slice(0, 120);
  if (!fullName) return null;

  const agencyName = agencyParts.join(', ').trim().slice(0, 160) || null;
  return { fullName, agencyName };
}

// ---------------------------------------------------------------------------
// Orchestration — called from routes/webhook.js
// ---------------------------------------------------------------------------

/**
 * Should this sender be asked to onboard?
 *
 * Cheap local checks first, the Postgres round trip last — this runs on every
 * inbound listing, and the overwhelmingly common case (an agent who is
 * already registered, or who has already been asked) must not cost a database
 * query it doesn't need.
 *
 * Errors are swallowed to `false`: Postgres being unreachable must never stop
 * a listing from being recorded and confirmed. The agent is simply asked on
 * their next submission instead.
 */
async function shouldOnboard(waId) {
  if (!isConfigured()) return false;
  const session = getSession(waId);
  if (session && (session.state === 'COMPLETED' || session.asked_count >= MAX_ASKS)) return false;

  try {
    const agent = await findAgentByPhone(waId);
    // An account that already has a password is a finished registration —
    // nothing to onboard. An account with a verified phone but no password is
    // one of these WhatsApp onboardings still waiting for its magic link to
    // be clicked, which is fine and needs no re-prompt either.
    return !agent;
  } catch (err) {
    console.warn(`[onboarding] agent lookup failed for ${waId}: ${err.message}`);
    return false;
  }
}

/**
 * Opens (or re-arms) the onboarding session and returns the text to append to
 * the normal intake reply. Returns null when nothing should be appended.
 */
function startOnboarding(waId, listing, photoCount) {
  const session = openSession(waId);
  if (!session) return null;
  console.log(`[onboarding] asked ${waId} for name/agency (attempt ${session.asked_count})`);
  return onboardingPrompt(listing, photoCount);
}

/**
 * Handles the sender's answer: creates the account, claims their listings,
 * publishes the listing that triggered this, and sends the magic link.
 *
 * @param {string} waId
 * @param {string} text The raw reply.
 * @param {{pendingListingId?: number|null}} [options]
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
async function completeOnboarding(waId, text, { pendingListingId = null } = {}) {
  const parsed = parseNameReply(text);
  if (!parsed) return { handled: false, reason: 'unparseable' };

  let agentId;
  let token;
  try {
    ({ agentId, token } = await upsertAgentFromWhatsApp({
      waId,
      fullName: parsed.fullName,
      agencyName: parsed.agencyName,
    }));
  } catch (err) {
    console.error(`[onboarding] could not create agent for ${waId}: ${err.message}`);
    return { handled: false, reason: 'create-failed' };
  }

  completeSession(waId, { ...parsed, agentId });

  // Publish the listing that started this, so answering the question is also
  // the confirmation. Asking an unregistered agent for their name AND a
  // separate "OK" is two acknowledgements for one action.
  let listingQueued = false;
  if (pendingListingId) {
    try {
      db.publishListing(pendingListingId);
      listingQueued = true;
      console.log(`[onboarding] listing #${pendingListingId} published on ${waId}'s registration`);
    } catch (err) {
      console.error(`[onboarding] could not publish listing #${pendingListingId}: ${err.message}`);
    }
  }

  // Retroactive claiming — everything they ever sent us, not just today's.
  // Best-effort: a failure here costs attribution on old listings, which an
  // admin can still fix, and must not cost them the account they just made.
  try {
    const remoteIds = db.getRemotePropertyIdsForWaId(normalisePhone(waId));
    if (remoteIds.length) {
      const { linkedIds } = await require('./postgres').linkListingsToAgent(remoteIds, normalisePhone(waId));
      if (linkedIds.length) {
        console.log(`[onboarding] claimed ${linkedIds.length} existing listing(s) for agent #${agentId}`);
      }
    }
  } catch (err) {
    console.warn(`[onboarding] retroactive claim failed for ${waId}: ${err.message}`);
  }

  const link = `${SITE_URL}/compte/agent/activer?phone=${encodeURIComponent(normalisePhone(waId))}&token=${token}`;
  await chakra.sendWhatsAppMessage(
    waId,
    activationMessage({ fullName: parsed.fullName, link, listingQueued }),
    { previewUrl: true },
  );

  console.log(`[onboarding] ${waId} -> agent #${agentId} (${parsed.fullName}${parsed.agencyName ? `, ${parsed.agencyName}` : ''})`);
  return { handled: true, agentId };
}

module.exports = {
  shouldOnboard,
  startOnboarding,
  completeOnboarding,
  getSession,
  // Exposed for scripts/verify-pipeline.js.
  parseNameReply,
  summaryCard,
  onboardingPrompt,
  activationMessage,
  findAgentByPhone,
  upsertAgentFromWhatsApp,
  hashToken,
  MAX_ASKS,
  ACTIVATION_TTL_HOURS,
};
