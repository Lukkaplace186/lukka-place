import 'server-only';
import { createHash } from 'node:crypto';
import { getPool } from './db';
import { getListingQuota } from './listingQuota';

/**
 * "Faites le point sur vos annonces" — the page an agent opens from the
 * engine's one-per-agent WhatsApp request (services/agentStatusCheck.js,
 * migrations/20261109_agent_status_requests.sql), or from their dashboard.
 *
 * One screen, every listing the agent still has on the site (active or under
 * offer), one tap per listing:
 *
 *   available          active  -> stamp availability_confirmed_at
 *                      under offer -> back on the market, stamped
 *   still_under_offer  under offer -> stamped, stays under offer
 *   under_offer        active  -> under offer (stays visible, "Sous offre" badge), stamped
 *   closed             -> let / sold: listing_status 'closed', status 0, sold_at,
 *                         sold_price ONLY when the agent gave one (owner decision
 *                         2026-11-09: the price is optional, a forced price makes
 *                         agents tap "Retiré" and the deal is lost). The
 *                         benchmarks already exclude a close without a price.
 *   withdrawn          -> archived (status 0 + archived_at), never a transaction
 *
 * A listing the (dormant) auto-pause hid (status 0 + auto_paused_at,
 * engine services/listingAutoPause.js) is listed too, first, with "Réactiver"
 * (= available / still under offer: back to status 1, subject to the plan's
 * listing limit), "Loué / vendu" or "Retiré".
 *
 * THE LINK
 * The URL carries 24 random bytes (base64url, 32 characters); the table holds
 * only their SHA-256. A link opens only its own agent's listings and can only
 * answer this page's questions — no text, photo or account change. Expired
 * links (expires_at) open nothing. Every write re-states ownership
 * (`AND p.agent_id = $n`) and the state the answer applies to, so a stale
 * page or a crafted id updates zero rows.
 *
 * Every answer is also written to listing_availability_checks (channel 'LINK'
 * from the link, 'DASHBOARD' from a session), never blocking the answer.
 * Before the migration the link resolves to nothing and the dashboard page
 * still works.
 */

const CONTENT_LANGUAGE_ID = 20;
const MISSING = new Set(['42P01', '42703']);
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const DAY_MS = 86_400_000;

export const STATUS_ANSWERS = ['available', 'still_under_offer', 'under_offer', 'closed', 'withdrawn', 'price'];

/** Hidden by the auto-pause, not by the agent: status 0 + auto_paused_at, not archived. */
const PAUSED_SQL = "p.status = 0 AND (to_jsonb(p) ->> 'auto_paused_at') IS NOT NULL AND p.archived_at IS NULL";

/** What each answer is called in listing_availability_checks.answer. */
export const CHECK_ANSWER = {
  available: 'AVAILABLE',
  back_on_market: 'BACK_ON_MARKET',
  still_under_offer: 'STILL_UNDER_OFFER',
  under_offer: 'UNDER_OFFER',
  closed: 'LET_OR_SOLD',
  withdrawn: 'WITHDRAWN',
  price: 'PRICE_CHANGED',
  reactivate: 'REACTIVATED',
  closed_paused: 'LET_OR_SOLD',
  withdrawn_paused: 'WITHDRAWN',
};

export function isStatusToken(token) {
  return TOKEN_RE.test(String(token || ''));
}

export function hashStatusToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * The request behind a link, or null (bad shape, unknown, agent gone, table
 * missing). `expired` is returned rather than hidden so the page can say so
 * and point to the dashboard.
 */
export async function resolveStatusRequest(token, now = new Date()) {
  if (!isStatusToken(token)) return null;
  try {
    const { rows } = await getPool().query(
      `SELECT r.id, r.agent_id, r.created_at, r.expires_at,
              (SELECT ai.first_name FROM agent_infos ai
                WHERE ai.agent_id = a.id AND ai.language_id = ${CONTENT_LANGUAGE_ID} AND COALESCE(ai.first_name, '') <> ''
                LIMIT 1) AS first_name
       FROM agent_status_requests r
       JOIN agents a ON a.id = r.agent_id
       WHERE r.token_hash = $1 AND a.status = 1 AND (to_jsonb(a) ->> 'deleted_at') IS NULL`,
      [hashStatusToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      requestId: Number(row.id),
      agentId: Number(row.agent_id),
      firstName: row.first_name || null,
      createdAt: new Date(row.created_at).toISOString(),
      expired: new Date(row.expires_at).getTime() < now.getTime(),
    };
  } catch (err) {
    if (MISSING.has(err?.code)) return null;
    throw err;
  }
}

/** First opening of a request — how many agents actually look. Never throws. */
export async function markStatusRequestOpened(requestId) {
  try {
    await getPool().query(
      'UPDATE agent_status_requests SET opened_at = COALESCE(opened_at, NOW()) WHERE id = $1',
      [Number(requestId)],
    );
  } catch (err) {
    if (!MISSING.has(err?.code)) console.error(`[status-check] opened stamp for #${requestId}: ${err.message}`);
  }
}

/** Every listing the agent still has on the site, the longest-unconfirmed first. */
export const STATUS_LISTINGS_SQL = `
  SELECT p.id, pc.title, p.purpose, p.price, p.price_period, p.price_original, p.currency,
         p.featured_image, p.quartier, p.reference, p.created_at,
         COALESCE(p.listing_status, 'active') AS listing_status, p.status,
         (to_jsonb(p) ->> 'availability_confirmed_at') AS availability_confirmed_at,
         (to_jsonb(p) ->> 'auto_paused_at') AS auto_paused_at,
         (SELECT ac.name FROM property_amenities pa
            JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
           WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
           LIMIT 1) AS commune
  FROM properties p
  LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE p.agent_id = $1
    AND (p.status = 1 OR (${PAUSED_SQL})) AND p.approve_status = 1
    AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer')
    AND (to_jsonb(p) ->> 'development_id') IS NULL
  ORDER BY (p.status = 0) DESC,
           COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                    GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at))) ASC,
           p.id ASC
  LIMIT 200
`;

function daysSince(value, now) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
}

export async function getStatusListings(agentId, now = new Date()) {
  const { rows } = await getPool().query(STATUS_LISTINGS_SQL, [Number(agentId)]);
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title || null,
    purpose: row.purpose || null,
    price: row.price != null ? Number(row.price) : null,
    pricePeriod: row.price_period || null,
    currency: String(row.currency || 'USD').toUpperCase() === 'CDF' ? 'CDF' : 'USD',
    authoredPrice: row.price_original != null ? Number(row.price_original) : row.price != null ? Number(row.price) : null,
    photo: row.featured_image && !/noimage/i.test(row.featured_image) ? row.featured_image : null,
    quartier: row.quartier || null,
    commune: row.commune || null,
    reference: row.reference || null,
    listingStatus: row.listing_status,
    paused: Number(row.status) === 0 && Boolean(row.auto_paused_at),
    confirmedDaysAgo: daysSince(row.availability_confirmed_at, now),
    createdOn: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : null,
  }));
}

/**
 * The closing date the agent picked: YYYY-MM-DD, not in the future (one day
 * of slack for time zones), not before the listing existed. Null when bad.
 */
export function validClosingDate(value, createdOn, now = new Date()) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return null;
  if (date.getTime() > now.getTime() + DAY_MS) return null;
  if (createdOn && raw < String(createdOn).slice(0, 10)) return null;
  return raw;
}

/** A positive USD amount, or null ("je préfère ne pas dire" / blank). */
export function positiveAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const LIVE_ACTIVE = "p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') = 'active'";
const LIVE_UNDER_OFFER = "p.status = 1 AND p.approve_status = 1 AND p.listing_status = 'under_offer'";
const LIVE_ANY = "p.status = 1 AND p.approve_status = 1 AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer')";

/** One statement per answer; $1 property, $2 agent. RETURNING the asking price for the history row. */
export const STATUS_WRITES = {
  available: `UPDATE properties p SET availability_confirmed_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ACTIVE} RETURNING p.price`,
  back_on_market: `UPDATE properties p SET listing_status = 'active', availability_confirmed_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_UNDER_OFFER} RETURNING p.price`,
  still_under_offer: `UPDATE properties p SET availability_confirmed_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_UNDER_OFFER} RETURNING p.price`,
  under_offer: `UPDATE properties p SET listing_status = 'under_offer', availability_confirmed_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ACTIVE} RETURNING p.price`,
  // $3 sold_price (NULL = not given), $4 sold_at, $5 price_source.
  closed: `UPDATE properties p SET listing_status = 'closed', sold_price = $3, sold_at = $4, price_source = $5,
                 status = 0, archived_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ANY} RETURNING p.price`,
  withdrawn: `UPDATE properties p SET status = 0, archived_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ANY} RETURNING p.price`,
  stamp_any: `UPDATE properties p SET availability_confirmed_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ANY} RETURNING p.price`,
  // The auto-paused listing (only exists once auto_paused_at does).
  reactivate: `UPDATE properties p SET status = 1, auto_paused_at = NULL, availability_confirmed_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${PAUSED_SQL} AND p.approve_status = 1
                 AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer') RETURNING p.price`,
  closed_paused: `UPDATE properties p SET listing_status = 'closed', sold_price = $3, sold_at = $4, price_source = $5,
                 auto_paused_at = NULL, archived_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${PAUSED_SQL} AND p.approve_status = 1
                 AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer') RETURNING p.price`,
  withdrawn_paused: `UPDATE properties p SET auto_paused_at = NULL, archived_at = NOW(), updated_at = NOW()
               WHERE p.id = $1 AND p.agent_id = $2 AND ${PAUSED_SQL} AND p.approve_status = 1
                 AND COALESCE(p.listing_status, 'active') IN ('active', 'under_offer') RETURNING p.price`,
};

export const RECORD_STATUS_ANSWER_SQL = `
  INSERT INTO listing_availability_checks
    (property_id, agent_id, channel, asked_at, answered_at, answer, previous_price, new_price,
     closed_price, closed_via_platform, request_id)
  SELECT p.id, p.agent_id, $3, $4, NOW(), $5, $6, $7, $8, $9, $10
    FROM properties p
   WHERE p.id = $1 AND p.agent_id = $2
`;

async function recordStatusAnswer({ propertyId, agentId, request, answer, previousPrice = null, newPrice = null, closedPrice = null, via = null }) {
  const pool = getPool();
  try {
    await pool.query(RECORD_STATUS_ANSWER_SQL, [
      propertyId, agentId,
      request ? 'LINK' : 'DASHBOARD',
      request ? request.createdAt : null,
      answer,
      previousPrice != null && Number(previousPrice) >= 0 ? Number(previousPrice) : null,
      newPrice, closedPrice,
      typeof via === 'boolean' ? via : null,
      request ? request.requestId : null,
    ]);
  } catch (err) {
    if (!MISSING.has(err?.code) && err?.code !== '23514') {
      console.error(`[status-check] answer for #${propertyId} not recorded: ${err.message}`);
    }
  }
  if (request) {
    await pool.query(
      'UPDATE agent_status_requests SET last_answer_at = NOW(), answers_count = answers_count + 1 WHERE id = $1',
      [request.requestId],
    ).catch(() => {});
  }
}

/**
 * Apply one answer to one of the agent's own listings.
 *
 * @param {object} input
 * @param {number} input.agentId   from the link's request or the session — never the client
 * @param {object|null} input.request  resolveStatusRequest()'s result, null on the dashboard
 * @param {'available'|'still_under_offer'|'under_offer'|'closed'|'withdrawn'} input.answer
 * @param {object} [input.closing]  { soldPrice, soldAt, viaPlatform } for 'closed'
 * @returns {Promise<{ok: true, state: string, freedSlot?: object|null} | {ok: false, reason: string}>}
 */
export async function answerListingStatus({ agentId, request = null, propertyId, answer, closing = null, now = new Date() }) {
  const aid = Number.parseInt(agentId, 10);
  const pid = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(aid) || !Number.isFinite(pid)) return { ok: false, reason: 'not_found' };
  if (!STATUS_ANSWERS.includes(answer) || answer === 'price') return { ok: false, reason: 'bad_answer' };

  const pool = getPool();
  const { rows: current } = await pool.query(
    `SELECT COALESCE(p.listing_status, 'active') AS listing_status, p.status, p.approve_status, p.created_at, p.price,
            p.archived_at, (to_jsonb(p) ->> 'auto_paused_at') AS auto_paused_at
       FROM properties p WHERE p.id = $1 AND p.agent_id = $2`,
    [pid, aid],
  );
  if (!current.length) return { ok: false, reason: 'not_found' };
  const before = current[0];

  // "Disponible" on an under-offer listing means it fell through: back on the market.
  let write = answer;
  if (answer === 'available' && before.listing_status === 'under_offer') write = 'back_on_market';

  const paused = Number(before.status) === 0 && Boolean(before.auto_paused_at) && !before.archived_at;
  if (paused) {
    if (answer === 'available' || answer === 'still_under_offer') write = 'reactivate';
    else if (answer === 'closed') write = 'closed_paused';
    else if (answer === 'withdrawn') write = 'withdrawn_paused';
    else return { ok: false, reason: 'bad_answer' };
    if (write === 'reactivate') {
      // Back to status 1 takes a slot of the plan's listing limit again.
      const quota = await getListingQuota(aid, 1).catch(() => null);
      if (quota?.blocked) return { ok: false, reason: 'quota' };
    }
  }

  let params = [pid, aid];
  let closedPrice = null;
  if (write === 'closed' || write === 'closed_paused') {
    const soldAt = validClosingDate(closing?.soldAt, before.created_at ? new Date(before.created_at).toISOString() : null, now);
    if (!soldAt) return { ok: false, reason: 'bad_date' };
    closedPrice = positiveAmount(closing?.soldPrice);
    params = [pid, aid, closedPrice, soldAt, closedPrice != null ? 'DIRECT_INPUT' : null];
  }

  let rows;
  try {
    ({ rows } = await pool.query(STATUS_WRITES[write], params));
  } catch (err) {
    if (MISSING.has(err?.code)) return { ok: false, reason: 'unavailable' };
    throw err;
  }
  if (!rows.length) return { ok: false, reason: 'stale' };

  await recordStatusAnswer({
    propertyId: pid,
    agentId: aid,
    request,
    answer: CHECK_ANSWER[write],
    previousPrice: rows[0].price,
    closedPrice,
    via: answer === 'closed' ? closing?.viaPlatform : null,
  });

  let freedSlot = null;
  if (!paused && (answer === 'closed' || answer === 'withdrawn')) {
    const quota = await getListingQuota(aid, 0).catch(() => null);
    if (quota?.capped) freedSlot = { remaining: quota.remaining, limit: quota.limit };
  }
  const state = {
    available: 'active',
    back_on_market: 'active',
    still_under_offer: 'under_offer',
    under_offer: 'under_offer',
    closed: 'closed',
    withdrawn: 'withdrawn',
    reactivate: before.listing_status === 'under_offer' ? 'under_offer' : 'active',
    closed_paused: 'closed',
    withdrawn_paused: 'withdrawn',
  }[write];
  return { ok: true, state, freedSlot };
}

/** After a price change from the page: the listing is confirmed too. Ownership in the WHERE. */
export async function stampAfterPriceChange({ agentId, request = null, propertyId, previousPrice, newPrice }) {
  const aid = Number.parseInt(agentId, 10);
  const pid = Number.parseInt(propertyId, 10);
  const { rows } = await getPool().query(STATUS_WRITES.stamp_any, [pid, aid]).catch(() => ({ rows: [] }));
  await recordStatusAnswer({ propertyId: pid, agentId: aid, request, answer: 'PRICE_CHANGED', previousPrice, newPrice });
  return rows.length > 0;
}

/** The listing as it stands, for the price change's "before" figure. */
export async function getOwnListingPrice(agentId, propertyId) {
  const { rows } = await getPool().query(
    `SELECT p.price FROM properties p WHERE p.id = $1 AND p.agent_id = $2 AND ${LIVE_ANY}`,
    [Number(propertyId), Number(agentId)],
  );
  return rows.length ? (rows[0].price != null ? Number(rows[0].price) : null) : undefined;
}
