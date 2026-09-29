import 'server-only';
import { AGENT_SESSION_COOKIE, verifyAgentSessionToken } from './agentAuth';

/**
 * The write side of every storefront engagement event: page views, the
 * listing-scoped events in `listing_events`, and committed searches.
 * app/api/track/route.js is the only caller; it decides WHICH event, this
 * decides whether and how it is stored.
 *
 * THREE THINGS NEVER BECOME A ROW
 *
 *  - **A bot or a prefetch.** `analyticsDimensions` already buckets crawler
 *    User-Agents as `device = 'bot'`; they used to be stored and filtered at
 *    read time, which meant every per-agent count (and the landlord report)
 *    silently included them. A request the browser marks as a prefetch is not
 *    a visit either. See `shouldSkipRequest`.
 *  - **The listing's own agent.** An agent opening their own listing to check
 *    it was counted as a view, and the landlord report had to say "including
 *    the agent's own". The agent session cookie is `path: '/'`, so it reaches
 *    this endpoint; every listing-scoped INSERT carries
 *    `WHERE NOT EXISTS (… agent_id = $owner)`, so the check costs no extra
 *    round trip and a crafted body cannot get around it. (The admin cookie is
 *    scoped to `/admin` and never reaches /api/track, so an admin browsing the
 *    storefront cannot be told apart from a visitor; impersonation is refused
 *    earlier, by middleware.js, like every write.)
 *  - **A visitor id we did not issue the shape of.** `lp_vid` is a random id
 *    the browser keeps (lib/analyticsClient.js). Anything not matching
 *    `VISITOR_ID_RE` is stored as NULL rather than as a free-text field
 *    anybody can write into.
 *
 * DEPLOY ORDER DOES NOT MATTER
 * The new columns come from migrations/20260929_engagement_tracking.sql. Until
 * it runs, an INSERT naming them fails with 42703; each writer retries once
 * with the columns that already existed, so no view is lost while web is
 * ahead of the database. A search, whose table does not exist yet (42P01), is
 * simply not recorded.
 */

export const VISITOR_COOKIE = 'lp_vid';
export const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Events that name one listing and land in `listing_events`. */
export const LISTING_EVENT_TYPES = [
  'listing_saved',
  'listing_unsaved',
  'call_click',
  'gallery_open',
  'gallery_complete',
  'share_click',
];

/** `listing_events.routing_type` — only ever set on a call_click. */
export const CALL_ROUTING_TYPES = ['DIRECT', 'CENTRAL'];

const MISSING_COLUMN = '42703';
const MISSING_TABLE = '42P01';

/** A well-formed visitor id, or null. */
export function cleanVisitorId(value) {
  return typeof value === 'string' && VISITOR_ID_RE.test(value) ? value : null;
}

/** `/listings/310` -> 310. Only the exact shape the storefront emits. */
export function listingIdFromPath(path) {
  const match = /^\/listings\/(\d{1,18})$/.exec(String(path || ''));
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A positive integer id from a body field, or null. */
export function positiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Why this request should write nothing, or null.
 *
 * `device` is analyticsDimensions' own verdict on the User-Agent. The prefetch
 * headers are what Chromium (`Sec-Purpose`), older browsers (`Purpose`,
 * `X-Moz`) and Next's router (`Next-Router-Prefetch`) send when a request is
 * speculative rather than something a person did. A beacon is a POST fired
 * from an effect, so none of these should ever be present — which is exactly
 * why one being present means the request is not what it claims.
 */
export function shouldSkipRequest(headers, device) {
  if (device === 'bot') return 'bot';
  const purpose = `${headers.get('sec-purpose') || ''} ${headers.get('purpose') || ''} ${headers.get('x-moz') || ''}`;
  if (/prefetch|prerender/i.test(purpose)) return 'prefetch';
  if (headers.get('next-router-prefetch')) return 'prefetch';
  return null;
}

/** The signed-in agent's id from the request's cookie, or null. */
export function ownerAgentIdFrom(request) {
  try {
    const token = request.cookies?.get?.(AGENT_SESSION_COOKIE)?.value;
    return verifyAgentSessionToken(token)?.agentId ?? null;
  } catch {
    return null;
  }
}

/** The visitor id: the cookie first (the browser's own), then the body's copy. */
export function visitorIdFrom(request, bodyValue) {
  let cookieValue = null;
  try {
    cookieValue = request.cookies?.get?.(VISITOR_COOKIE)?.value ?? null;
  } catch {
    cookieValue = null;
  }
  return cleanVisitorId(cookieValue) || cleanVisitorId(bodyValue);
}

// The owner guard. `$owner` NULL (no agent session) never matches, and neither
// does a NULL listing id, so a visitor's event always passes.
const notOwner = (listingParam, ownerParam) =>
  `NOT EXISTS (SELECT 1 FROM properties WHERE id = ${listingParam}::bigint AND agent_id = ${ownerParam}::bigint)`;

export const RECORD_PAGE_VIEW_SQL = `
  INSERT INTO page_views (path, commune, device, source, listing_id, visitor_id)
  SELECT $1::text, $2::text, $3::text, $4::text, $5::bigint, $6::text
  WHERE ${notOwner('$5', '$7')}
`;

// Before the migration: no listing_id / visitor_id columns yet.
export const RECORD_PAGE_VIEW_LEGACY_SQL = `
  INSERT INTO page_views (path, commune, device, source)
  SELECT $1::text, $2::text, $3::text, $4::text
  WHERE ${notOwner('$5', '$6')}
`;

export const RECORD_LISTING_EVENT_SQL = `
  INSERT INTO listing_events (event, listing_id, commune, price, device, source, visitor_id, routing_type)
  SELECT $1::text, $2::bigint, $3::text, $4::numeric, $5::text, $6::text, $7::text, $8::text
  WHERE ${notOwner('$2', '$9')}
`;

export const RECORD_LISTING_EVENT_LEGACY_SQL = `
  INSERT INTO listing_events (event, listing_id, commune, price, device, source)
  SELECT $1::text, $2::bigint, $3::text, $4::numeric, $5::text, $6::text
  WHERE ${notOwner('$2', '$7')}
`;

export const RECORD_SEARCH_SQL = `
  INSERT INTO search_events
    (visitor_id, purpose, communes, quartier, property_type, beds_min, price_min, price_max, amenities, q, result_count, device, source)
  VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13)
`;

async function withLegacyFallback(pool, [sql, values], [legacySql, legacyValues]) {
  try {
    const result = await pool.query(sql, values);
    return result.rowCount > 0;
  } catch (err) {
    if (err?.code !== MISSING_COLUMN) throw err;
    const result = await pool.query(legacySql, legacyValues);
    return result.rowCount > 0;
  }
}

/** @returns {Promise<boolean>} whether a row was written (false = the owner's own view). */
export async function recordPageView(pool, { path, commune, device, source, visitorId, ownerAgentId }) {
  const listingId = listingIdFromPath(path);
  return withLegacyFallback(
    pool,
    [RECORD_PAGE_VIEW_SQL, [path, commune || null, device, source, listingId, visitorId || null, ownerAgentId || null]],
    [RECORD_PAGE_VIEW_LEGACY_SQL, [path, commune || null, device, source, listingId, ownerAgentId || null]],
  );
}

/** @returns {Promise<boolean>} whether a row was written. */
export async function recordListingEvent(pool, {
  event, listingId, commune, price, device, source, visitorId, routingType, ownerAgentId,
}) {
  if (!LISTING_EVENT_TYPES.includes(event)) throw new Error(`recordListingEvent: unknown event '${event}'`);
  const routing = event === 'call_click' && CALL_ROUTING_TYPES.includes(routingType) ? routingType : null;
  return withLegacyFallback(
    pool,
    [RECORD_LISTING_EVENT_SQL, [event, listingId, commune || null, price, device, source, visitorId || null, routing, ownerAgentId || null]],
    [RECORD_LISTING_EVENT_LEGACY_SQL, [event, listingId, commune || null, price, device, source, ownerAgentId || null]],
  );
}

const PURPOSES = new Set(['rent', 'sale']);
const TRANSACTION_TO_PURPOSE = { location: 'rent', vente: 'sale', rent: 'rent', sale: 'sale' };

function boundedText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function boundedAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount < 1e12 ? amount : null;
}

function textList(value, maxItems, maxLength) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out = [];
  for (const item of list) {
    const text = boundedText(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * A search body, reduced to exactly the columns search_events holds. The body
 * is the client's claim, so every field is bounded here rather than trusted:
 * the CHECKs on the table would reject an oversized row, and a rejected row
 * is a lost search.
 */
export function normaliseSearch(body) {
  const purpose = TRANSACTION_TO_PURPOSE[body?.purpose] || TRANSACTION_TO_PURPOSE[body?.transactionType] || null;
  const beds = Number.parseInt(body?.bedsMin, 10);
  const resultCount = Number.parseInt(body?.resultCount, 10);
  return {
    purpose: PURPOSES.has(purpose) ? purpose : null,
    communes: textList(body?.communes, 5, 64),
    quartier: boundedText(body?.quartier, 120),
    propertyType: boundedText(body?.propertyType, 40),
    bedsMin: Number.isInteger(beds) && beds >= 0 && beds <= 50 ? beds : null,
    priceMin: boundedAmount(body?.priceMin),
    priceMax: boundedAmount(body?.priceMax),
    amenities: textList(body?.amenities, 20, 40),
    q: boundedText(body?.q, 200),
    resultCount: Number.isInteger(resultCount) && resultCount >= 0 ? resultCount : null,
  };
}

/** @returns {Promise<boolean>} whether a row was written (false before the migration). */
export async function recordSearch(pool, search, { device, source, visitorId }) {
  if (search.resultCount === null) return false;
  try {
    await pool.query(RECORD_SEARCH_SQL, [
      visitorId || null,
      search.purpose,
      search.communes,
      search.quartier,
      search.propertyType,
      search.bedsMin,
      search.priceMin,
      search.priceMax,
      search.amenities,
      search.q,
      search.resultCount,
      device,
      source,
    ]);
    return true;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return false;
    throw err;
  }
}
