import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { IMPERSONATION_COOKIE } from './impersonationToken';
import { COMMUNE_SUBQUERY } from './listings';
import { matchClientsToListings } from './clientMatching';

/**
 * The agent client book (migrations/20260922_agent_clients.sql): clients an
 * agent saves from their OWN WhatsApp chats, matched at read time against
 * their own live listings (lib/clientMatching.js).
 *
 * STRICTLY PRIVATE. Every statement here carries `agent_id = $1` with the
 * session's agent id, and a client id or listing id from a form is only ever
 * used together with it — a guessed id belonging to another agent updates,
 * deletes or reads nothing. Nothing outside /compte/agent reads these tables:
 * not the admin console, not lead dispatch, not another agent.
 *
 * Degrades before the migration runs: a missing table or column (42P01 /
 * 42703) reads as an empty book with `available: false`, and writes answer
 * `unavailable` — web can deploy seconds before or after the SQL.
 */

const MISSING_SCHEMA = new Set(['42P01', '42703']);
export const CLIENTS_LIMIT = 500;
const LISTINGS_LIMIT = 500;

export function isMissingSchema(err) {
  return MISSING_SCHEMA.has(err?.code);
}

const CLIENT_COLUMNS =
  'id, name, phone, transaction_type, communes, budget_min, budget_max, bedrooms, notes, created_at, updated_at';

function shapeClient(row) {
  return {
    id: String(row.id),
    name: row.name,
    phone: row.phone,
    transaction_type: row.transaction_type,
    communes: Array.isArray(row.communes) ? row.communes : [],
    budget_min: row.budget_min == null ? null : Number(row.budget_min),
    budget_max: row.budget_max == null ? null : Number(row.budget_max),
    bedrooms: row.bedrooms == null ? null : Number(row.bedrooms),
    notes: row.notes || null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/** @returns {Promise<{available: boolean, clients: Object[]}>} */
export async function listAgentClients(agentId) {
  try {
    const { rows } = await getPool().query(
      `SELECT ${CLIENT_COLUMNS} FROM agent_clients WHERE agent_id = $1 ORDER BY created_at DESC LIMIT ${CLIENTS_LIMIT}`,
      [agentId],
    );
    return { available: true, clients: rows.map(shapeClient) };
  } catch (err) {
    if (isMissingSchema(err)) return { available: false, clients: [] };
    throw err;
  }
}

function valueParams(value) {
  return [
    value.name,
    value.phone,
    value.transaction_type,
    value.communes,
    value.budget_min,
    value.budget_max,
    value.bedrooms,
    value.notes,
  ];
}

function writeFailure(err) {
  if (isMissingSchema(err)) return { ok: false, reason: 'unavailable' };
  if (err?.code === '23505') return { ok: false, reason: 'duplicate' };
  throw err;
}

/** @param {Object} value the `value` of a successful parseClientFields */
export async function createAgentClient(agentId, value) {
  try {
    const { rows } = await getPool().query(
      `INSERT INTO agent_clients (agent_id, name, phone, transaction_type, communes, budget_min, budget_max, bedrooms, notes)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
       RETURNING id`,
      [agentId, ...valueParams(value)],
    );
    return { ok: true, id: String(rows[0].id) };
  } catch (err) {
    return writeFailure(err);
  }
}

export async function updateAgentClient(agentId, clientId, value) {
  try {
    const { rowCount } = await getPool().query(
      `UPDATE agent_clients
       SET name = $2, phone = $3, transaction_type = $4, communes = $5::text[], budget_min = $6, budget_max = $7,
           bedrooms = $8, notes = $9, updated_at = NOW()
       WHERE agent_id = $1 AND id = $10`,
      [agentId, ...valueParams(value), clientId],
    );
    return rowCount ? { ok: true } : { ok: false, reason: 'not_found' };
  } catch (err) {
    return writeFailure(err);
  }
}

export async function deleteAgentClient(agentId, clientId) {
  try {
    const { rowCount } = await getPool().query('DELETE FROM agent_clients WHERE agent_id = $1 AND id = $2', [
      agentId,
      clientId,
    ]);
    return rowCount ? { ok: true } : { ok: false, reason: 'not_found' };
  } catch (err) {
    return writeFailure(err);
  }
}

/**
 * "WhatsApp opened on <date>" markers, keyed `clientId:listingId`.
 * @returns {Promise<Record<string, string>>}
 */
export async function listClientContacts(agentId) {
  try {
    const { rows } = await getPool().query(
      'SELECT client_id, property_id, contacted_at FROM agent_client_contacts WHERE agent_id = $1',
      [agentId],
    );
    const out = {};
    for (const row of rows) {
      const at = row.contacted_at instanceof Date ? row.contacted_at.toISOString() : row.contacted_at;
      out[`${row.client_id}:${row.property_id}`] = at;
    }
    return out;
  } catch (err) {
    if (isMissingSchema(err)) return {};
    throw err;
  }
}

/**
 * Stamps the marker. Both ids must belong to this agent — the INSERT selects
 * from the agent's own client row joined to the agent's own listing, so a
 * forged pair inserts nothing.
 *
 * @returns {Promise<{ok: true, contactedAt: string}|{ok: false, reason: string}>}
 */
export async function recordClientContact(agentId, clientId, propertyId) {
  try {
    const { rows } = await getPool().query(
      `INSERT INTO agent_client_contacts (agent_id, client_id, property_id)
       SELECT c.agent_id, c.id, p.id
       FROM agent_clients c
       JOIN properties p ON p.id = $3 AND p.agent_id = $1
       WHERE c.id = $2 AND c.agent_id = $1
       ON CONFLICT (client_id, property_id) DO UPDATE SET contacted_at = NOW()
       RETURNING contacted_at`,
      [agentId, clientId, propertyId],
    );
    if (!rows[0]) return { ok: false, reason: 'not_found' };
    const at = rows[0].contacted_at;
    return { ok: true, contactedAt: at instanceof Date ? at.toISOString() : String(at) };
  } catch (err) {
    return writeFailure(err);
  }
}

/**
 * The agent's own listings a customer can open right now, with the commune
 * resolved (it is a property_amenities tag, not a column). Same public gate as
 * every storefront read, plus market state: under offer and closed listings
 * are off the market and are not offered to a client.
 */
export async function getMatchableOwnListings(agentId) {
  const { rows } = await getPool().query(
    `SELECT p.id, p.price, p.purpose, p.price_period, p.beds, p.quartier, p.status, p.approve_status,
            p.listing_status, p.created_at, pc.title, ${COMMUNE_SUBQUERY}
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE p.agent_id = $1 AND p.status = 1 AND p.approve_status = 1
       AND COALESCE(p.listing_status, 'active') = 'active'
     ORDER BY p.created_at DESC
     LIMIT ${LISTINGS_LIMIT}`,
    [agentId],
  );
  return rows.map((row) => ({ ...row, id: String(row.id), listing_status: row.listing_status || 'active' }));
}

/**
 * Everything the book, the listing rows and the overview need, in one pass.
 * Memoised per request, like getAgentDashboardContext.
 */
export const getAgentClientBook = cache(async function getAgentClientBook(agentId) {
  const [{ available, clients }, listings, contacts] = await Promise.all([
    listAgentClients(agentId),
    getMatchableOwnListings(agentId),
    listClientContacts(agentId),
  ]);
  const { byListing, byClient } = matchClientsToListings(clients, listings);
  return { available, clients, listings, contacts, byListing, byClient };
});

const EMPTY_BOOK = Object.freeze({ available: false, hidden: false, clients: [], listings: [], contacts: {}, byListing: {}, byClient: {} });

/**
 * A console member "viewing as" this agent (web/CLAUDE.md, impersonation)
 * does not see the client book: it is the agent's own customers from their
 * own phone, and support has no need of it. Same signal middleware.js uses —
 * the cookie's presence.
 */
export async function isImpersonating() {
  const cookieStore = await cookies();
  return cookieStore.has(IMPERSONATION_COOKIE);
}

/**
 * Never lets a book failure take a dashboard page down; empty (and `hidden`)
 * under impersonation.
 */
export async function getAgentClientBookSafe(agentId) {
  if (await isImpersonating()) return { ...EMPTY_BOOK, hidden: true };
  try {
    return { hidden: false, ...(await getAgentClientBook(agentId)) };
  } catch (err) {
    console.error(`[agentClients] client book unavailable for agent #${agentId}: ${err.message}`);
    return { ...EMPTY_BOOK };
  }
}
