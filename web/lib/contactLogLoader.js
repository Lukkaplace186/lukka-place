import 'server-only';
import { getPool } from './db';
import { getContactLog } from './adminApi';
import { getAgentNamesByIds } from './agents';
import { getListingLabels } from './adminLeadRouting';
import { buildContactRows } from './contactLog';

/**
 * Reads behind /admin/contacts and its CSV export; lib/contactLog.js merges
 * them. Each store is read on its own: one being down leaves the other's
 * rows on the page and says which half is missing, never a silent gap.
 *
 * Columns added by migrations/20261115_contact_log.sql are read through
 * to_jsonb, and agent_contact_taps is checked with to_regclass, so the page
 * works before that migration runs (customers simply unknown on taps).
 */

/** Rows per source; the page says when a window holds more. */
export const CONTACT_SOURCE_CAP = 5000;

export const WA_TAPS_SQL = `
  SELECT wc.id, wc.created_at, wc.listing_id, wc.agent_id, wc.visitor_id, wc.viewer_kind, wc.routing_type,
         (to_jsonb(wc) ->> 'customer_id')::bigint AS customer_id
    FROM whatsapp_clicks wc
   WHERE wc.created_at >= NOW() - make_interval(days => $1::int)
     AND wc.routing_type = 'DIRECT_WA'
     AND COALESCE(wc.viewer_kind, 'visitor') = 'visitor'
   ORDER BY wc.created_at DESC
   LIMIT ${CONTACT_SOURCE_CAP}
`;

export const CALL_TAPS_SQL = `
  SELECT e.id, e.created_at, e.listing_id, p.agent_id, e.visitor_id, e.viewer_kind, e.routing_type,
         (to_jsonb(e) ->> 'customer_id')::bigint AS customer_id
    FROM listing_events e
    LEFT JOIN properties p ON p.id = e.listing_id
   WHERE e.event = 'call_click'
     AND e.routing_type = 'DIRECT'
     AND e.created_at >= NOW() - make_interval(days => $1::int)
     AND COALESCE(e.viewer_kind, 'visitor') = 'visitor'
   ORDER BY e.created_at DESC
   LIMIT ${CONTACT_SOURCE_CAP}
`;

export const OTHER_TAPS_SQL = `
  SELECT id, created_at, agent_id, channel, surface, listing_id, project_slug, visitor_id, customer_id, viewer_kind
    FROM agent_contact_taps
   WHERE created_at >= NOW() - make_interval(days => $1::int)
     AND COALESCE(viewer_kind, 'visitor') = 'visitor'
   ORDER BY created_at DESC
   LIMIT ${CONTACT_SOURCE_CAP}
`;

export const CHATS_SQL = `
  SELECT id, created_at, customer_id, agent_id, property_id, agent_first_reply_at
    FROM chat_threads
   WHERE created_at >= NOW() - make_interval(days => $1::int)
     AND last_message_id IS NOT NULL
   ORDER BY created_at DESC
   LIMIT ${CONTACT_SOURCE_CAP}
`;

export const CUSTOMERS_SQL = 'SELECT id, phone, full_name FROM customers WHERE id = ANY($1::bigint[])';
export const PROPERTY_AGENTS_SQL = 'SELECT id, agent_id FROM properties WHERE id = ANY($1::bigint[])';
export const DEVELOPMENTS_SQL = 'SELECT id, slug, name FROM developments WHERE id = ANY($1::bigint[]) OR LOWER(slug) = ANY($2::text[])';

const MISSING_TABLE = '42P01';

async function optionalTable(pool, table, sql, params) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS t', [table]);
  if (!rows[0]?.t) return { rows: [] };
  return pool.query(sql, params).catch((err) => (err?.code === MISSING_TABLE ? { rows: [] } : Promise.reject(err)));
}

const ids = (list) => [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/**
 * @param {{days: number}} options
 * @returns {Promise<{rows: Object[], names: Map, listings: Map, projects: Map,
 *   errors: {engine: string|null, taps: string|null}, capped: boolean}>}
 */
export async function loadContactLog({ days }) {
  const pool = getPool();
  const [engineR, waR, callR, otherR, chatR] = await Promise.allSettled([
    getContactLog({ days }),
    pool.query(WA_TAPS_SQL, [days]),
    pool.query(CALL_TAPS_SQL, [days]),
    optionalTable(pool, 'public.agent_contact_taps', OTHER_TAPS_SQL, [days]),
    optionalTable(pool, 'public.chat_threads', CHATS_SQL, [days]),
  ]);
  const value = (r, fallback) => (r.status === 'fulfilled' ? r.value : fallback);
  const tapFailure = [waR, callR, otherR, chatR].find((r) => r.status === 'rejected');
  const errors = {
    engine: engineR.status === 'rejected' ? (engineR.reason?.message || 'error') : null,
    taps: tapFailure ? (tapFailure.reason?.message || 'error') : null,
  };
  if (errors.engine) console.error(`[admin/contacts] engine read failed: ${errors.engine}`);
  if (errors.taps) console.error(`[admin/contacts] Postgres read failed: ${errors.taps}`);

  const engine = value(engineR, { leads: [], viewings: [], tapAlerts: [] });
  const waTaps = value(waR, { rows: [] }).rows;
  const callTaps = value(callR, { rows: [] }).rows;
  const otherTaps = value(otherR, { rows: [] }).rows;
  const chats = value(chatR, { rows: [] }).rows;
  const capped = [waTaps, callTaps, otherTaps, chats, engine.leads || [], engine.viewings || []]
    .some((list) => list.length >= CONTACT_SOURCE_CAP);

  // Who the signed-in customers were, and the agent of rows that name only a listing.
  const customerIds = ids([...waTaps, ...callTaps, ...otherTaps, ...chats].map((r) => r.customer_id));
  const unattributed = ids([...(engine.leads || []), ...(engine.viewings || [])]
    .filter((r) => !r.agent_id && r.property_id).map((r) => r.property_id));
  const [customersR, propertyAgentsR] = await Promise.allSettled([
    customerIds.length ? pool.query(CUSTOMERS_SQL, [customerIds]) : { rows: [] },
    unattributed.length ? pool.query(PROPERTY_AGENTS_SQL, [unattributed]) : { rows: [] },
  ]);
  const customers = new Map(value(customersR, { rows: [] }).rows.map((r) => [Number(r.id), r]));
  const propertyAgents = new Map(value(propertyAgentsR, { rows: [] }).rows.map((r) => [Number(r.id), r.agent_id == null ? null : Number(r.agent_id)]));

  const rows = buildContactRows({ engine, waTaps, callTaps, otherTaps, chats, customers, propertyAgents });
  return { rows, errors, capped };
}

/** Names for exactly the rows a page shows: agents, listings, projects. */
export async function getContactLabels(rows) {
  const pool = getPool();
  const slugs = [...new Set(rows.map((r) => r.projectSlug).filter(Boolean).map((s) => s.toLowerCase()))];
  const developmentIds = ids(rows.map((r) => r.developmentId));
  const [namesR, listingsR, projectsR] = await Promise.allSettled([
    getAgentNamesByIds(rows.map((r) => r.agentId)),
    getListingLabels(rows.map((r) => r.listingId)),
    slugs.length || developmentIds.length ? pool.query(DEVELOPMENTS_SQL, [developmentIds, slugs]) : { rows: [] },
  ]);
  const projects = new Map();
  for (const p of projectsR.status === 'fulfilled' ? projectsR.value.rows : []) {
    projects.set(`id:${p.id}`, p);
    if (p.slug) projects.set(`slug:${String(p.slug).toLowerCase()}`, p);
  }
  return {
    names: namesR.status === 'fulfilled' ? namesR.value : new Map(),
    listings: listingsR.status === 'fulfilled' ? listingsR.value : new Map(),
    projects,
  };
}
