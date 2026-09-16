import 'server-only';
import { getPool } from './db';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';

/**
 * Postgres reads and the one write behind the direct-to-agent admin pages.
 * The SQLite half (viewing requests) comes from the engine through
 * lib/adminApi.js; this is the half that lives beside `properties`.
 */

// Same commune derivation as lib/dataExport.js — commune is not a column.
const COMMUNE_EXPR = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
)`;

/** Reference / title / commune for the listings a page is about to show. */
export async function getListingLabels(ids) {
  const clean = [...new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (clean.length === 0) return new Map();
  const { rows } = await getPool().query(
    `SELECT p.id, p.reference, p.agent_id, pc.title, ${COMMUNE_EXPR} AS commune
       FROM properties p
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE p.id = ANY($1::bigint[])`,
    [clean],
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

/** Every agent with the two facts that decide their routing. */
export async function getAgentsForRouting() {
  const { rows } = await getPool().query(
    `SELECT a.id, ${AGENCY_NAME_EXPR}, a.phone, a.phone_verified_at, a.direct_routing_enabled
       FROM agents a
       ${AGENT_INFOS_JOIN}
      ORDER BY a.id`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.agency_name || null,
    phone: row.phone || null,
    phoneVerified: Boolean(row.phone_verified_at),
    directRoutingEnabled: row.direct_routing_enabled !== false,
  }));
}

/**
 * The admin switch. Turning direct routing OFF is always allowed; turning it
 * ON requires a verified number, enforced in the WHERE clause rather than
 * only in the UI — the switch must never be a way to publish a number nobody
 * proved they hold. Returns false when nothing was updated.
 */
export const SET_DIRECT_ROUTING_SQL = `
  UPDATE agents
     SET direct_routing_enabled = $2, updated_at = NOW()
   WHERE id = $1
     AND ($2 = false OR phone_verified_at IS NOT NULL)
  RETURNING id
`;

export async function setAgentDirectRouting(agentId, enabled) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) throw new Error('agentId must be numeric');
  const { rows } = await getPool().query(SET_DIRECT_ROUTING_SQL, [id, Boolean(enabled)]);
  return rows.length > 0;
}

/**
 * Listing vs sold price, one row per close.
 *
 * `approve_status = 1` ONLY — the same deliberate departure from the public
 * gate lib/dataExport.js documents: closing sets `status = 0`, so filtering on
 * it would hide every sold listing. The deltas are derived here, exactly as
 * the CSV export derives them, never read from a stored column.
 */
export const CLOSED_TRANSACTIONS_SQL = `
  SELECT
    p.id,
    p.reference,
    pc.title,
    ${COMMUNE_EXPR} AS commune,
    p.purpose,
    p.price       AS list_price_usd,
    p.sold_price  AS sold_price_usd,
    CASE WHEN p.sold_price IS NOT NULL AND p.price IS NOT NULL
         THEN ROUND(p.sold_price - p.price, 2) END AS price_delta_usd,
    CASE WHEN p.sold_price IS NOT NULL AND p.price > 0
         THEN ROUND(((p.sold_price - p.price) / p.price) * 100, 2) END AS price_delta_pct,
    p.price_source,
    p.sold_at
  FROM properties p
  LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
  WHERE p.approve_status = 1
    AND p.listing_status = 'closed'
  ORDER BY COALESCE(p.sold_at::timestamp, p.updated_at) DESC
  LIMIT $1
`;

export async function getClosedTransactions({ limit = 200 } = {}) {
  const { rows } = await getPool().query(CLOSED_TRANSACTIONS_SQL, [limit]);
  const num = (value) => (value == null ? null : Number(value));
  return rows.map((row) => ({
    id: Number(row.id),
    reference: row.reference || null,
    title: row.title || null,
    commune: row.commune || null,
    purpose: row.purpose || null,
    listPriceUsd: num(row.list_price_usd),
    soldPriceUsd: num(row.sold_price_usd),
    priceDeltaUsd: num(row.price_delta_usd),
    priceDeltaPct: num(row.price_delta_pct),
    priceSource: row.price_source || null,
    soldAt: row.sold_at || null,
  }));
}

/** The CTA click audit log. */
export const RECENT_LEAD_CLICKS_SQL = `
  SELECT wc.id, wc.created_at, wc.listing_id, wc.routing_type, wc.device, wc.source,
         wc.commune, wc.agent_id, p.reference, pc.title
    FROM whatsapp_clicks wc
    LEFT JOIN properties p ON p.id = wc.listing_id
    LEFT JOIN property_contents pc ON pc.property_id = wc.listing_id AND pc.language_id = 20
   ORDER BY wc.created_at DESC
   LIMIT $1
`;

export async function getRecentLeadClicks({ limit = 100 } = {}) {
  const { rows } = await getPool().query(RECENT_LEAD_CLICKS_SQL, [limit]);
  return rows;
}

/** One page of the tap log, with its real total. `id DESC` breaks created_at ties. */
export const LEAD_CLICKS_PAGE_SQL = `
  SELECT wc.id, wc.created_at, wc.listing_id, wc.routing_type, wc.device, wc.source,
         wc.commune, wc.agent_id, p.reference, pc.title
    FROM whatsapp_clicks wc
    LEFT JOIN properties p ON p.id = wc.listing_id
    LEFT JOIN property_contents pc ON pc.property_id = wc.listing_id AND pc.language_id = 20
   ORDER BY wc.created_at DESC, wc.id DESC
   LIMIT $1 OFFSET $2
`;

export async function getLeadClicksPage({ limit = 25, offset = 0 } = {}) {
  const pool = getPool();
  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM whatsapp_clicks'),
    pool.query(LEAD_CLICKS_PAGE_SQL, [limit, offset]),
  ]);
  return { total: countRows[0]?.total ?? 0, rows };
}

/**
 * Taps per commune over a window, top ten. `whatsapp_clicks.commune` is what
 * the tap recorded; a tap with none is counted apart (`untagged`) rather than
 * dropped, so the ranking never hides how much of the traffic it covers.
 */
export async function getLeadClicksByCommune({ days = 30 } = {}) {
  const pool = getPool();
  const [{ rows }, { rows: untaggedRows }] = await Promise.all([
    pool.query(
      `SELECT commune, COUNT(*)::int AS taps
         FROM whatsapp_clicks
        WHERE created_at >= NOW() - make_interval(days => $1::int) AND commune IS NOT NULL AND commune <> ''
        GROUP BY commune
        ORDER BY taps DESC, commune
        LIMIT 10`,
      [days],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM whatsapp_clicks
        WHERE created_at >= NOW() - make_interval(days => $1::int) AND (commune IS NULL OR commune = '')`,
      [days],
    ),
  ]);
  return { rows, untagged: untaggedRows[0]?.n ?? 0 };
}

/**
 * Taps by routing type over a window. A NULL routing type is a tap recorded
 * before routing was tracked — reported as its own bucket, never folded into
 * either real one.
 */
export async function getLeadClickTotals({ days = 30 } = {}) {
  const { rows } = await getPool().query(
    `SELECT routing_type, COUNT(*)::int AS total
       FROM whatsapp_clicks
      WHERE created_at >= NOW() - make_interval(days => $1::int)
      GROUP BY routing_type`,
    [days],
  );
  const totals = { DIRECT_WA: 0, CENTRAL_FALLBACK: 0, UNKNOWN: 0 };
  for (const row of rows) {
    const key = row.routing_type && row.routing_type in totals ? row.routing_type : 'UNKNOWN';
    totals[key] += Number(row.total) || 0;
  }
  return { ...totals, total: totals.DIRECT_WA + totals.CENTRAL_FALLBACK + totals.UNKNOWN };
}
