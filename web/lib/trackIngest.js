import 'server-only';
import { AGENT_SESSION_COOKIE, verifyAgentSessionToken } from './agentAuth';
import { cleanAttribution, isTagged, sourceOf } from './attribution';
import { PARTNER_COOKIE, parsePartnerCookie } from './partnerRules';

/**
 * The write side of every storefront engagement event: page views, the
 * listing-scoped events in `listing_events`, and committed searches.
 * app/api/track/route.js is the only caller; it decides WHICH event, this
 * decides how it is stored.
 *
 * EVERY VIEWER IS RECORDED, AND SAYS WHO THEY WERE (product decision,
 * 2026-09-29). Bots, prefetches, the listing's own agent, other signed-in
 * agents and the Lukka Place team all write a row, like any visitor. Each row
 * carries `viewer_kind` (VIEWER_KINDS), decided here from the request, so a
 * reader that wants "people only" can filter later without the event having
 * been thrown away:
 *
 *  - `staff`    the Lukka Place team: the `lp_staff` marker cookie that
 *               middleware.js sets on every authenticated /admin request (the
 *               admin session cookie itself is scoped to /admin and never
 *               reaches /api/track), or a "view as" session.
 *  - `bot`      analyticsDimensions' `device = 'bot'`, or a browser that says
 *               it is driven (`navigator.webdriver`, sent as `automated`).
 *  - `prefetch` a request the browser marks as speculative.
 *  - `owner`    the listing's own agent (agent session cookie, `path: '/'`),
 *               resolved in the INSERT against properties.agent_id, so a
 *               crafted body cannot claim or dodge it.
 *  - `agent`    any other signed-in agent.
 *  - `visitor`  everybody else.
 *
 * A visitor id not matching `VISITOR_ID_RE` is stored as NULL rather than as a
 * free-text field anybody can write into.
 *
 * DEPLOY ORDER DOES NOT MATTER
 * The new columns come from migrations/20260929_engagement_tracking.sql. Until
 * it runs, an INSERT naming them fails with 42703; each writer retries once
 * with the columns that already existed, so no view is lost while web is
 * ahead of the database. A search, whose table does not exist yet (42P01), is
 * simply not recorded.
 */

export const VISITOR_COOKIE = 'lp_vid';
export const STAFF_COOKIE = 'lp_staff';
export const VISITOR_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const VIEWER_KINDS = ['visitor', 'owner', 'agent', 'staff', 'bot', 'prefetch'];

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
const IMPERSONATION_COOKIE = 'lukka_impersonation';

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

function cookieValue(request, name) {
  try {
    return request.cookies?.get?.(name)?.value ?? null;
  } catch {
    return null;
  }
}

/** The signed-in agent's id from the request's cookie, or null. */
export function signedInAgentIdFrom(request) {
  try {
    return verifyAgentSessionToken(cookieValue(request, AGENT_SESSION_COOKIE))?.agentId ?? null;
  } catch {
    return null;
  }
}

/**
 * Who sent this request, before the listing is known (`owner` is decided in
 * the INSERT, from `agent`). Checked in this order: team, automation,
 * speculation, signed-in agent, visitor.
 *
 * The prefetch headers are what Chromium (`Sec-Purpose`), older browsers
 * (`Purpose`, `X-Moz`) and Next's router (`Next-Router-Prefetch`) send when a
 * request is speculative rather than something a person did.
 */
export function viewerKindFor(request, device, { automated = false, agentId = null } = {}) {
  const headers = request.headers;
  if (cookieValue(request, STAFF_COOKIE) === '1' || cookieValue(request, IMPERSONATION_COOKIE)) return 'staff';
  if (device === 'bot' || automated === true) return 'bot';
  const purpose = `${headers?.get?.('sec-purpose') || ''} ${headers?.get?.('purpose') || ''} ${headers?.get?.('x-moz') || ''}`;
  if (/prefetch|prerender/i.test(purpose) || headers?.get?.('next-router-prefetch')) return 'prefetch';
  if (agentId) return 'agent';
  return 'visitor';
}

/** The visitor id: the cookie first (the browser's own), then the body's copy. */
export function visitorIdFrom(request, bodyValue) {
  return cleanVisitorId(cookieValue(request, VISITOR_COOKIE)) || cleanVisitorId(bodyValue);
}

/**
 * The stored `viewer_kind`: a signed-in agent looking at their OWN listing is
 * `owner`. `$agent` NULL, or a NULL listing id, never matches.
 */
export const viewerKindSql = (kindParam, listingParam, agentParam) =>
  `CASE WHEN ${kindParam}::text = 'agent' AND EXISTS (SELECT 1 FROM properties WHERE id = ${listingParam}::bigint AND agent_id = ${agentParam}::bigint) THEN 'owner' ELSE ${kindParam}::text END`;

/**
 * The page view with its full campaign (migrations/20261027_growth_attribution.sql).
 * Before that migration: RECORD_PAGE_VIEW_SQL, then the legacy one.
 */
export const RECORD_PAGE_VIEW_CAMPAIGN_SQL = `
  INSERT INTO page_views (path, commune, device, source, listing_id, visitor_id, viewer_kind,
                          utm_medium, utm_campaign, utm_content, utm_term, click_id_type, referrer_host, ref_code)
  VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, $6::text, ${viewerKindSql('$7', '$5', '$8')},
          $9::text, $10::text, $11::text, $12::text, $13::text, $14::text, $15::text)
`;

export const RECORD_PAGE_VIEW_SQL = `
  INSERT INTO page_views (path, commune, device, source, listing_id, visitor_id, viewer_kind)
  VALUES ($1::text, $2::text, $3::text, $4::text, $5::bigint, $6::text, ${viewerKindSql('$7', '$5', '$8')})
`;

// Before the migration: no listing_id / visitor_id / viewer_kind columns yet.
export const RECORD_PAGE_VIEW_LEGACY_SQL = `
  INSERT INTO page_views (path, commune, device, source)
  VALUES ($1::text, $2::text, $3::text, $4::text)
`;

export const RECORD_LISTING_EVENT_SQL = `
  INSERT INTO listing_events (event, listing_id, commune, price, device, source, visitor_id, routing_type, viewer_kind)
  VALUES ($1::text, $2::bigint, $3::text, $4::numeric, $5::text, $6::text, $7::text, $8::text, ${viewerKindSql('$9', '$2', '$10')})
`;

export const RECORD_LISTING_EVENT_LEGACY_SQL = `
  INSERT INTO listing_events (event, listing_id, commune, price, device, source)
  VALUES ($1::text, $2::bigint, $3::text, $4::numeric, $5::text, $6::text)
`;

export const RECORD_SEARCH_SQL = `
  INSERT INTO search_events
    (visitor_id, purpose, communes, quartier, property_type, beds_min, price_min, price_max, amenities, q, result_count, device, source, viewer_kind)
  VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, $13, $14)
`;

/** Tries each [sql, values] in turn, moving on only when a column does not exist yet. */
async function withLegacyFallback(pool, ...attempts) {
  for (let i = 0; i < attempts.length; i += 1) {
    const [sql, values] = attempts[i];
    try {
      const result = await pool.query(sql, values);
      return result.rowCount > 0;
    } catch (err) {
      if (err?.code !== MISSING_COLUMN || i === attempts.length - 1) throw err;
    }
  }
  return false;
}

const kindOrVisitor = (kind) => (VIEWER_KINDS.includes(kind) ? kind : 'visitor');

/** @returns {Promise<boolean>} whether a row was written. */
export async function recordPageView(pool, {
  path, commune, device, source, visitorId, viewerKind, agentId, attribution = null, refCode = null,
}) {
  const listingId = listingIdFromPath(path);
  const tracked = [path, commune || null, device, source, listingId, visitorId || null, kindOrVisitor(viewerKind), agentId || null];
  const a = attribution || {};
  return withLegacyFallback(
    pool,
    [RECORD_PAGE_VIEW_CAMPAIGN_SQL, [...tracked, a.medium || null, a.campaign || null, a.content || null, a.term || null,
      a.clickIdType || null, a.referrerHost || null, refCode || null]],
    [RECORD_PAGE_VIEW_SQL, tracked],
    [RECORD_PAGE_VIEW_LEGACY_SQL, [path, commune || null, device, source]],
  );
}

// ---------------------------------------------------------------------------
// Where the visit came from
// ---------------------------------------------------------------------------

/**
 * The beacon's attribution (lib/attribution.js), or — from a page cached
 * before the `attribution` field existed — its bare `utmSource`.
 */
export function attributionFromBody(body) {
  const cleaned = cleanAttribution(body?.attribution);
  if (cleaned) return cleaned;
  return cleanAttribution({ source: typeof body?.utmSource === 'string' ? body.utmSource : null });
}

/**
 * The stored `source` for an event: the session's campaign or referrer
 * (sourceOf), else what the request headers say — which, for a beacon whose
 * Referer is our own page, is 'direct'.
 */
export function eventSource(attribution, headerSource) {
  return attribution ? sourceOf(attribution) : headerSource || 'direct';
}

/** The partner code this browser carries (`lp_ref`, set by /go), or null. */
export function partnerCodeFrom(request) {
  return parsePartnerCookie(cookieValue(request, PARTNER_COOKIE))?.code ?? null;
}

/** Who gets a touch recorded: people, not the team, crawlers or prefetches. */
export const TOUCH_VIEWER_KINDS = ['visitor', 'agent'];

/**
 * One row per visitor id: the first source ever seen, written once, and the
 * last TOUCH — a campaign tag, an ad click, another site sending them, or a
 * partner code — replaced each time a different one arrives. A visit with no
 * touch (a typed address, a bookmark) only moves `last_seen_at`, and only
 * when the last one is half an hour old, so browsing a session does not write
 * a row per page.
 */
export const UPSERT_VISITOR_TOUCH_SQL = `
  INSERT INTO visitor_touches (
    visitor_id,
    first_source, first_medium, first_campaign, first_content, first_term, first_click_id, first_click_id_type,
    first_referrer_host, first_landing_path, first_ref_code,
    last_source, last_medium, last_campaign, last_content, last_term, last_click_id, last_click_id_type,
    last_referrer_host, last_landing_path, last_ref_code
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (visitor_id) DO UPDATE SET
    last_source        = CASE WHEN $12::boolean THEN EXCLUDED.last_source        ELSE visitor_touches.last_source END,
    last_medium        = CASE WHEN $12::boolean THEN EXCLUDED.last_medium        ELSE visitor_touches.last_medium END,
    last_campaign      = CASE WHEN $12::boolean THEN EXCLUDED.last_campaign      ELSE visitor_touches.last_campaign END,
    last_content       = CASE WHEN $12::boolean THEN EXCLUDED.last_content       ELSE visitor_touches.last_content END,
    last_term          = CASE WHEN $12::boolean THEN EXCLUDED.last_term          ELSE visitor_touches.last_term END,
    last_click_id      = CASE WHEN $12::boolean THEN EXCLUDED.last_click_id      ELSE visitor_touches.last_click_id END,
    last_click_id_type = CASE WHEN $12::boolean THEN EXCLUDED.last_click_id_type ELSE visitor_touches.last_click_id_type END,
    last_referrer_host = CASE WHEN $12::boolean THEN EXCLUDED.last_referrer_host ELSE visitor_touches.last_referrer_host END,
    last_landing_path  = CASE WHEN $12::boolean THEN EXCLUDED.last_landing_path  ELSE visitor_touches.last_landing_path END,
    last_ref_code      = CASE WHEN $12::boolean THEN EXCLUDED.last_ref_code      ELSE visitor_touches.last_ref_code END,
    last_touch_at      = CASE WHEN $12::boolean THEN NOW()                       ELSE visitor_touches.last_touch_at END,
    last_seen_at       = NOW()
  WHERE ($12::boolean AND (
           visitor_touches.last_source   IS DISTINCT FROM EXCLUDED.last_source
        OR visitor_touches.last_campaign IS DISTINCT FROM EXCLUDED.last_campaign
        OR visitor_touches.last_content  IS DISTINCT FROM EXCLUDED.last_content
        OR visitor_touches.last_click_id IS DISTINCT FROM EXCLUDED.last_click_id
        OR visitor_touches.last_ref_code IS DISTINCT FROM EXCLUDED.last_ref_code))
     OR visitor_touches.last_seen_at < NOW() - INTERVAL '30 minutes'
`;

/**
 * Records the visitor's touch. Never throws into the beacon: a missing table
 * (before the migration) or a failed write leaves the page view recorded.
 *
 * @returns {Promise<boolean>} whether a row was written or moved.
 */
export async function recordVisitorTouch(pool, { visitorId, viewerKind, attribution = null, refCode = null }) {
  const id = cleanVisitorId(visitorId);
  if (!id || !TOUCH_VIEWER_KINDS.includes(viewerKind)) return false;
  const a = attribution || {};
  // A partner code alone is not a touch: the cookie lasts 30 days, and a later
  // typed-address visit must not overwrite the campaign that brought them.
  // /go always lands on a tagged URL, so a partner click IS tagged.
  const touched = isTagged(a) || Boolean(a.referrerHost);
  try {
    const result = await pool.query(UPSERT_VISITOR_TOUCH_SQL, [
      id,
      sourceOf(attribution),
      a.medium || null,
      a.campaign || null,
      a.content || null,
      a.term || null,
      a.clickId || null,
      a.clickIdType || null,
      a.referrerHost || null,
      a.landingPath || null,
      refCode || null,
      touched,
    ]);
    return result.rowCount > 0;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return false;
    console.error(`[track] visitor touch failed: ${err.message}`);
    return false;
  }
}

/** @returns {Promise<boolean>} whether a row was written. */
export async function recordListingEvent(pool, {
  event, listingId, commune, price, device, source, visitorId, routingType, viewerKind, agentId,
}) {
  if (!LISTING_EVENT_TYPES.includes(event)) throw new Error(`recordListingEvent: unknown event '${event}'`);
  const routing = event === 'call_click' && CALL_ROUTING_TYPES.includes(routingType) ? routingType : null;
  return withLegacyFallback(
    pool,
    [RECORD_LISTING_EVENT_SQL, [event, listingId, commune || null, price, device, source, visitorId || null, routing, kindOrVisitor(viewerKind), agentId || null]],
    [RECORD_LISTING_EVENT_LEGACY_SQL, [event, listingId, commune || null, price, device, source]],
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
export async function recordSearch(pool, search, { device, source, visitorId, viewerKind }) {
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
      kindOrVisitor(viewerKind),
    ]);
    return true;
  } catch (err) {
    if (err?.code === MISSING_TABLE) return false;
    throw err;
  }
}
