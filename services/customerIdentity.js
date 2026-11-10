/**
 * services/customerIdentity.js
 *
 * Is this sender a CUSTOMER we already know, rather than an agent? (2026-11-10)
 *
 * Since 2026-11-09 every storefront WhatsApp button lands on the intake
 * number, so customers and agents write to the same chat. The intake's
 * defaults are agent-first (a photo is a listing, an unknown number is a new
 * agent, the next sentence is their name), and on 2026-11-10 two customers
 * were onboarded as verified agents and their screenshots sent to moderation
 * (listings #806 and #811). A customer we know is now kept out of that path:
 * their text goes to the customer assistant, a bare photo gets a question
 * back, and an acknowledgment stays silent (routes/webhook.js).
 *
 * KNOWN CUSTOMER = a customer signal and no agent signal.
 *   Customer: a lead from this number in the last LEAD_WINDOW_DAYS (an
 *   enquiry, a visit request, a profile message…), an open visit, or a
 *   `customers` account on this phone.
 *   Agent: an `agents` row on this number (own phone or a linked number,
 *   not soft-deleted — services/agentOnboarding.js findAgentByPhone), or a
 *   listing from this number already published here. Either wins over every
 *   customer signal, so a real agent's path never changes.
 * Postgres unreachable: the SQLite signals decide alone.
 */

const db = require('./db');

const LEAD_WINDOW_DAYS = 60;

function digitsOf(waId) {
  return String(waId || '').replace(/\D/g, '');
}

function sqliteTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/** What this engine's own SQLite knows about the number. */
function localSignals(waId) {
  const wa = digitsOf(waId);
  const reasons = [];
  if (!wa) return { reasons, publishedListing: false };
  const since = sqliteTime(new Date(Date.now() - LEAD_WINDOW_DAYS * 24 * 3600 * 1000));
  const lead = db.db
    .prepare('SELECT id FROM leads WHERE wa_id = ? AND datetime(created_at) >= datetime(?) LIMIT 1')
    .get(wa, since);
  if (lead) reasons.push('lead');
  const visit = db.db
    .prepare(
      `SELECT v.id FROM viewing_requests v JOIN leads l ON l.id = v.lead_id
        WHERE l.wa_id = ? AND v.status IN ('PENDING', 'RESCHEDULED', 'CONFIRMED') LIMIT 1`,
    )
    .get(wa);
  if (visit) reasons.push('open-visit');
  const published = db.db
    .prepare("SELECT id FROM listings WHERE wa_id = ? AND status = 'published' LIMIT 1")
    .get(wa);
  return { reasons, publishedListing: Boolean(published) };
}

/**
 * Postgres: an agent account on this number, a customer account on this
 * phone. `checked: false` when Postgres is not configured. Throws on a query
 * error (the caller decides). Exported so the tests can stand in for it.
 */
async function remoteSignals(waId) {
  const postgres = require('./postgres');
  if (!postgres.isConfigured()) return { checked: false, agent: null, customerId: null };
  const agent = await require('./agentOnboarding').findAgentByPhone(waId);
  const { rows } = await postgres.getPool().query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [digitsOf(waId)]);
  return { checked: true, agent: agent || null, customerId: rows[0]?.id ?? null };
}

/**
 * @param {string} waId
 * @returns {Promise<{role: 'agent'|'customer'|'unknown', reasons: string[]}>}
 */
async function senderRole(waId) {
  if (!digitsOf(waId)) return { role: 'unknown', reasons: [] };
  const local = localSignals(waId);
  if (local.publishedListing) return { role: 'agent', reasons: ['published-listing'] };

  let remote = { checked: false, agent: null, customerId: null };
  try {
    remote = await module.exports.remoteSignals(waId);
  } catch (err) {
    console.warn(`[customer] account lookup for ${waId} failed, deciding on local signals: ${err.message}`);
  }
  if (remote.agent && !remote.agent.deleted_at) return { role: 'agent', reasons: ['agent-account'] };

  const reasons = [...local.reasons];
  if (remote.customerId) reasons.push('customer-account');
  return reasons.length ? { role: 'customer', reasons } : { role: 'unknown', reasons };
}

/**
 * The answer to a bare photo from a known customer — usually a screenshot of
 * a listing. Asks for what lets us act, and says how to publish in case they
 * really are offering a property.
 */
const CUSTOMER_PHOTO_REPLY =
  'Merci pour votre photo 🙏 Pour retrouver ce bien, envoyez-nous le *lien de l’annonce* '
  + '(bouton « Partager » sur la page Lukka Place), ou dites-nous ce que vous cherchez : commune, budget, nombre de chambres.\n\n'
  + 'Vous souhaitez plutôt publier un bien ? Envoyez sa description avec le prix.';

/** Senders who got CUSTOMER_PHOTO_REPLY, and when — one process, memory is enough. */
const photoReplySentAt = new Map();
const PHOTO_REPLY_QUIET_MS = 30 * 60 * 1000;

/** Should a photo reply go out now? Records it when it does. */
function claimPhotoReply(waId, now = Date.now()) {
  const last = photoReplySentAt.get(digitsOf(waId));
  if (last && now - last < PHOTO_REPLY_QUIET_MS) return false;
  photoReplySentAt.set(digitsOf(waId), now);
  return true;
}

module.exports = {
  senderRole,
  localSignals,
  remoteSignals,
  claimPhotoReply,
  CUSTOMER_PHOTO_REPLY,
  LEAD_WINDOW_DAYS,
  PHOTO_REPLY_QUIET_MS,
};
