/**
 * services/agentReviews.js
 *
 * "Notez l'agent" — a customer's 1 to 5 star rating of the AGENT who showed
 * them a property, asked after every visit booked through Lukka Place.
 *
 * WHAT IS RATED
 * The agent, never the property (product decision 2026-10-18). Whether the
 * house suited is already the check-in's 👍/👎 and the customer's
 * fall-through reason (services/viewingSweeps.js); those stay separate, so a
 * disappointing house never drags down the agent who showed it well.
 *
 * WHO MAY RATE
 * Only the customer of a real viewing request, matched on the lead's own
 * wa_id (the same rule as the check-in, and for the same reason), and only
 * once the check-in said the visit happened (GOOD or BAD — "agent absent" is
 * a no-show, recorded as such, not a star). One rating per visit, never
 * edited: `agent_reviews.viewing_request_id` is UNIQUE. There is no open
 * "leave a review" form anywhere — a contest prize would fill one with the
 * agent's friends and competitors.
 *
 * WHERE IT LIVES
 * Postgres `agent_reviews` (migrations/20261018_agent_reviews.sql) is the
 * record the storefront reads. SQLite `viewing_requests.agent_rating` is a
 * copy stamped only after Postgres accepted the row, so the Espace Client and
 * the WhatsApp flow can tell a visit is rated. Postgres unreachable → the
 * rating is refused with "réessayez", never half-written.
 *
 * PUBLIC DISPLAY
 * web/lib/agentReviews.js shows an average only from MIN_PUBLIC_REVIEWS (5)
 * ratings, and a comment only once a moderator approved it.
 */

const crypto = require('crypto');
const dbService = require('./db');
const postgres = require('./postgres');
const propertyRepository = require('./propertyRepository');

/** Shared with web/lib/agentReviews.js — change one, change the other. */
const MIN_PUBLIC_REVIEWS = 5;

const COMMENT_MAX = 500;
const COMMENT_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'];
const CHANNELS = ['WHATSAPP', 'WEB'];

const PENDING_RATING_KIND = 'AGENT_RATING';
const PENDING_COMMENT_KIND = 'AGENT_REVIEW_COMMENT';

/**
 * A comment is any text, so the question that invites one must not stay open
 * long: a customer who comes back tomorrow with a new search must reach the
 * ordinary pipeline, not have it filed as a comment about yesterday's agent.
 */
const COMMENT_WINDOW_MS = 2 * 60 * 60 * 1000;

const HEADER_BRAND = '🏠 [Lukka Place]';

function poolOrNull(pool) {
  if (pool) return pool;
  return postgres.isConfigured() ? postgres.getPool() : null;
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function customerHash(waId) {
  return crypto.createHash('sha256').update(digitsOf(waId)).digest('hex');
}

/**
 * "4", "4️⃣", "4 étoiles", "4/5", "⭐⭐⭐⭐", "★★★★". Short replies only, so a
 * real message that happens to start with a digit reaches intake.
 */
function parseStars(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 20) return null;
  const stars = (raw.match(/[⭐★]/g) || []).length;
  if (stars && /^[\s⭐★️]+$/.test(raw)) return stars >= 1 && stars <= 5 ? stars : null;
  const cleaned = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[️⃣⭐★]/g, '')
    .replace(/[.!)\]]+$/, '')
    .trim();
  const match = /^([1-5])(?:\s*(?:\/\s*5|sur\s*5|etoiles?|\*))?$/.exec(cleaned);
  return match ? Number(match[1]) : null;
}

function isSkip(text) {
  const raw = String(text || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.!]+$/, '');
  return /^(passer|passe|non|non merci|rien|aucun|skip|-|ras)$/.test(raw);
}

/** Free text the customer wrote about the agent, or null when it cannot be one. */
function cleanComment(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  // A link is a listing, a search or spam — never a comment about a visit.
  if (/https?:\/\/|www\./i.test(value)) return null;
  return value.slice(0, COMMENT_MAX);
}

/**
 * Which agent this visit is rated against: the agent an admin reassigned it
 * to, else the listing's own agent, else the agent the alert went to. The
 * same order respondFromDashboard authorises against.
 */
async function resolveRatedAgent(request) {
  let listing = null;
  try {
    listing = await propertyRepository.getListingContactById(request.property_id);
  } catch (err) {
    console.error(`[reviews] listing #${request.property_id} lookup failed: ${err.message}`);
  }
  if (request.reassigned_at && request.agent_id) {
    let name = null;
    try {
      name = (await propertyRepository.getAgentContactById(request.agent_id))?.agent_name || null;
    } catch {
      // The name only decorates the question.
    }
    return { agentId: Number(request.agent_id), agentName: name };
  }
  if (listing?.agent_id) return { agentId: Number(listing.agent_id), agentName: listing.agent_name || null };
  if (request.agent_id) return { agentId: Number(request.agent_id), agentName: null };
  return null;
}

function ratingQuestionText(agentName, prefix) {
  // agent_name is the agency first, the person second (AGENT_NAME_EXPR), so
  // it is used whole — a first word of "Immo Plus Sarl" is nobody's name.
  const name = String(agentName || '').trim();
  const who = name ? `l'agent (${name})` : "l'agent";
  return [
    ...(prefix ? [prefix, ''] : []),
    `⭐ Comment notez-vous ${who} ? (accueil, ponctualité, honnêteté — pas le bien lui-même)`,
    '',
    'Répondez de 1 à 5 :',
    '1 = très mauvais · 5 = excellent',
  ].join('\n');
}

function commentQuestionText(stars) {
  return stars <= 2
    ? `${HEADER_BRAND} Merci. Qu'est-ce qui n'a pas été avec l'agent ? (répondez PASSER pour ignorer)`
    : `${HEADER_BRAND} Merci ! Un mot sur l'agent ? Il pourra être publié sur son profil. (répondez PASSER pour ignorer)`;
}

const COMMENT_THANKS = `${HEADER_BRAND} Merci, votre avis est enregistré. 🙏`;
const RATING_RETRY = `${HEADER_BRAND} Votre note n'a pas pu être enregistrée. Réessayez dans quelques minutes.`;

/** True once the check-in said the visit happened and nothing was rated yet. */
function canBeRated(request) {
  return Boolean(request)
    && (request.checkin_response === 'GOOD' || request.checkin_response === 'BAD')
    && request.agent_rating == null;
}

/**
 * Ask the customer to rate the agent, on WhatsApp. Returns true when the
 * question went out. `prefix` lets the caller fold its own thank-you into the
 * same message, so the customer gets one message rather than two.
 */
async function askForRating(request, { prefix, send } = {}) {
  if (!canBeRated(request) || !request.lead_wa_id || typeof send !== 'function') return false;
  const agent = await resolveRatedAgent(request);
  if (!agent) return false;
  const ok = await send(request.lead_wa_id, ratingQuestionText(agent.agentName, prefix));
  if (!ok) return false;
  dbService.setPendingCustomerAction({
    waId: request.lead_wa_id,
    kind: PENDING_RATING_KIND,
    viewingRequestId: request.id,
  });
  return true;
}

/**
 * Record a rating. Returns { ok, reason?, unchanged?, reviewId?, agentId? }.
 * Reasons: unknown-request, not-this-requests-customer, not-ratable,
 * invalid-stars, no-agent, unavailable (Postgres down or table missing).
 */
async function rateAgent({ from, viewingRequestId, stars, comment, channel = 'WHATSAPP' } = {}, { pool } = {}) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request) return { ok: false, reason: 'unknown-request' };
  const leadDigits = digitsOf(request.lead_wa_id);
  if (!leadDigits || leadDigits !== digitsOf(from)) {
    // Silent to the sender, like every other answer here.
    console.warn(`[reviews] rating for #${viewingRequestId} from ${from} refused`);
    return { ok: false, reason: 'not-this-requests-customer' };
  }
  if (request.agent_rating != null) return { ok: true, unchanged: true, stars: request.agent_rating };
  if (!canBeRated(request)) return { ok: false, reason: 'not-ratable' };
  const value = Number(stars);
  if (!Number.isInteger(value) || value < 1 || value > 5) return { ok: false, reason: 'invalid-stars' };
  if (!CHANNELS.includes(channel)) throw new Error(`rateAgent: unknown channel '${channel}'`);

  const agent = await resolveRatedAgent(request);
  if (!agent) return { ok: false, reason: 'no-agent' };

  const client = poolOrNull(pool);
  if (!client) return { ok: false, reason: 'unavailable' };

  const text = comment == null ? null : cleanComment(comment);
  let reviewId = null;
  try {
    const { rows } = await client.query(
      `INSERT INTO agent_reviews
         (agent_id, viewing_request_id, property_id, customer_hash, stars, comment, comment_status, channel, comment_at)
       VALUES ($1, $2, (SELECT id FROM properties WHERE id = $3), $4, $5, $6, $7, $8, $9)
       ON CONFLICT (viewing_request_id) DO NOTHING
       RETURNING id`,
      [
        agent.agentId,
        request.id,
        request.property_id || null,
        customerHash(request.lead_wa_id),
        value,
        text,
        text ? 'PENDING' : 'NONE',
        channel,
        text ? new Date().toISOString() : null,
      ],
    );
    reviewId = rows[0]?.id ?? null;
  } catch (err) {
    console.error(`[reviews] rating for #${request.id} not stored: ${err.message}`);
    return { ok: false, reason: 'unavailable' };
  }

  dbService.setAgentRating(request.id, value);
  console.log(`[reviews] viewing #${request.id}: agent #${agent.agentId} rated ${value}/5 via ${channel}`);
  return { ok: true, unchanged: reviewId == null, stars: value, reviewId, agentId: agent.agentId, agentName: agent.agentName };
}

/** The optional comment after the stars. Written once; never replaces one. */
async function addComment({ from, viewingRequestId, comment } = {}, { pool } = {}) {
  const request = dbService.getViewingRequestWithLead(viewingRequestId);
  if (!request || digitsOf(request.lead_wa_id) !== digitsOf(from) || !digitsOf(from)) {
    return { ok: false, reason: 'not-this-requests-customer' };
  }
  const text = cleanComment(comment);
  if (!text) return { ok: false, reason: 'invalid-comment' };
  const client = poolOrNull(pool);
  if (!client) return { ok: false, reason: 'unavailable' };
  try {
    const { rowCount } = await client.query(
      `UPDATE agent_reviews
          SET comment = $1, comment_status = 'PENDING', comment_at = NOW()
        WHERE viewing_request_id = $2 AND customer_hash = $3 AND comment IS NULL`,
      [text, request.id, customerHash(request.lead_wa_id)],
    );
    return { ok: rowCount > 0, reason: rowCount > 0 ? undefined : 'already-commented' };
  } catch (err) {
    console.error(`[reviews] comment for #${request.id} not stored: ${err.message}`);
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * A typed answer while a rating or comment question is open. Returns
 * { handled: false } for anything that is not a plausible answer, so the
 * message reaches ordinary processing.
 */
async function handlePendingText({ from, text, pending, send, notifyOps } = {}, { pool, now = new Date() } = {}) {
  if (!pending) return { handled: false };

  if (pending.kind === PENDING_RATING_KIND) {
    const stars = parseStars(text);
    if (!stars) return { handled: false };
    const result = await rateAgent({ from, viewingRequestId: pending.viewing_request_id, stars }, { pool });
    if (!result.ok) {
      if (result.reason === 'unavailable' && send) await send(from, RATING_RETRY);
      if (result.reason !== 'unavailable') dbService.clearPendingCustomerAction(from);
      return { handled: true, action: 'agent-rating', ignored: result.reason };
    }
    if (result.unchanged) {
      dbService.clearPendingCustomerAction(from);
      return { handled: true, action: 'agent-rating', unchanged: true };
    }
    dbService.setPendingCustomerAction({ waId: from, kind: PENDING_COMMENT_KIND, viewingRequestId: pending.viewing_request_id });
    if (send) await send(from, commentQuestionText(stars));
    if (stars <= 2 && typeof notifyOps === 'function') {
      await notifyOps(
        [
          `${HEADER_BRAND} ⭐ Note basse pour un agent : ${stars}/5`,
          '',
          `• Demande : #${pending.viewing_request_id}`,
          `• Agent : ${result.agentName || `#${result.agentId}`}`,
        ].join('\n'),
        `low rating #${pending.viewing_request_id}`,
      );
    }
    return { handled: true, action: 'agent-rating', stars };
  }

  if (pending.kind === PENDING_COMMENT_KIND) {
    const openedAt = new Date(pending.created_at).getTime();
    if (!Number.isFinite(openedAt) || now.getTime() - openedAt > COMMENT_WINDOW_MS) {
      dbService.clearPendingCustomerAction(from);
      return { handled: false };
    }
    if (isSkip(text)) {
      dbService.clearPendingCustomerAction(from);
      if (send) await send(from, COMMENT_THANKS);
      return { handled: true, action: 'agent-review-comment', skipped: true };
    }
    if (!cleanComment(text) || String(text).length > COMMENT_MAX * 2) return { handled: false };
    const result = await addComment({ from, viewingRequestId: pending.viewing_request_id, comment: text }, { pool });
    dbService.clearPendingCustomerAction(from);
    if (send) await send(from, result.ok || result.reason === 'already-commented' ? COMMENT_THANKS : RATING_RETRY);
    return { handled: true, action: 'agent-review-comment', ok: result.ok };
  }

  return { handled: false };
}

// ---------------------------------------------------------------------------
// Moderation (/admin/agent-reviews)
// ---------------------------------------------------------------------------

async function listReviews({ commentStatus, agentId, limit = 50, offset = 0 } = {}, { pool } = {}) {
  const client = poolOrNull(pool);
  if (!client) return { available: false, data: [], total: 0 };
  if (commentStatus && !COMMENT_STATUSES.includes(commentStatus)) {
    throw new Error(`comment_status must be one of: ${COMMENT_STATUSES.join(', ')}`);
  }
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const where = [];
  const params = [];
  if (commentStatus) { params.push(commentStatus); where.push(`r.comment_status = $${params.length}`); }
  if (agentId) { params.push(Number(agentId)); where.push(`r.agent_id = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  try {
    const [{ rows }, { rows: count }] = await Promise.all([
      client.query(
        `SELECT r.id, r.agent_id, COALESCE(NULLIF(TRIM(a.agency_name), ''), a.username) AS agent_name, r.viewing_request_id, r.property_id,
                r.stars, r.comment, r.comment_status, r.channel, r.created_at, r.comment_at, r.moderated_at
           FROM agent_reviews r
           LEFT JOIN agents a ON a.id = r.agent_id
           ${clause}
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT ${lim} OFFSET ${off}`,
        params,
      ),
      client.query(`SELECT COUNT(*)::int AS total FROM agent_reviews r ${clause}`, params),
    ]);
    return { available: true, data: rows, total: count[0]?.total ?? 0 };
  } catch (err) {
    if (err.code === '42P01') return { available: false, data: [], total: 0 };
    throw err;
  }
}

/** APPROVED shows the comment on the agent's profile; REJECTED hides it. The stars always count. */
async function moderateComment(id, status, { pool } = {}) {
  if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('status must be APPROVED or REJECTED');
  const client = poolOrNull(pool);
  if (!client) return { ok: false, reason: 'unavailable' };
  const { rows } = await client.query(
    `UPDATE agent_reviews SET comment_status = $1, moderated_at = NOW()
      WHERE id = $2 AND comment IS NOT NULL
      RETURNING id, comment_status`,
    [status, Number(id)],
  );
  return rows[0] ? { ok: true, ...rows[0] } : { ok: false, reason: 'not-found' };
}

module.exports = {
  MIN_PUBLIC_REVIEWS,
  COMMENT_MAX,
  COMMENT_WINDOW_MS,
  PENDING_RATING_KIND,
  PENDING_COMMENT_KIND,
  parseStars,
  isSkip,
  cleanComment,
  customerHash,
  canBeRated,
  ratingQuestionText,
  resolveRatedAgent,
  askForRating,
  rateAgent,
  addComment,
  handlePendingText,
  listReviews,
  moderateComment,
};
