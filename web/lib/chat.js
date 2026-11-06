import 'server-only';
import { cookies } from 'next/headers';
import { getPool } from './db';
import { getCurrentCustomerId } from './customers';
import { AGENT_SESSION_COOKIE, verifyAgentSessionToken } from './agentAuth';
import { AGENT_INFOS_JOIN, getListingsByIds } from './listings';
import { feedLocationLine, listingImages } from './listingView';
import { formatPrice, formatPriceCdf } from './format';
import {
  CHAT_INBOX_PAGE_SIZE,
  CHAT_NEW_THREADS_PER_DAY,
  CHAT_PAGE_SIZE,
  CHAT_REPORT_NOTE_MAX,
  CHAT_REPORT_REASONS,
  CHAT_SEND_PER_MINUTE,
  createRateLimiter,
  decodeInboxCursor,
  encodeInboxCursor,
  messagePreview,
  normaliseClientId,
  normaliseInboxFilter,
  normaliseMessageBody,
  otherRole,
  parseId,
  shortPersonName,
} from './chatRules';

/**
 * Messagerie — every read and write of chat_threads / chat_messages /
 * chat_reports (engine repo, migrations/20261105_chat.sql). Rules that need
 * no database are in lib/chatRules.js.
 *
 * WHO SEES WHAT. A viewer is `{role: 'customer'|'agent', id}`, resolved from
 * the caller's own httpOnly session by getChatViewer() and never from a
 * request value. Every query carries `t.customer_id = $viewer` or
 * `t.agent_id = $viewer` in its WHERE clause, so a guessed thread id returns
 * nothing — the routes answer that with the same 404 as a missing thread.
 * The column names come from the fixed maps below, never from input.
 *
 * WHO CAN START ONE. A customer whose phone is verified, writing to an agent
 * who passes the same test that decides whether the agent's own number is
 * shown on a listing (lib/listings.js `agent_phone`: phone verified, direct
 * routing not switched off, account not deleted). From a listing, the agent
 * is the listing's agent — read here, never taken from the request — and the
 * listing must be public. Agents answer; they do not open threads yet.
 *
 * BEFORE THE MIGRATION every read returns empty and every write
 * `{status: 'unavailable'}` (42P01), never a 500.
 */

/** Same gate as lib/listings.js APPROVED_FILTER; tests/unit/chat.test.js pins both. */
export const CHAT_PUBLIC_LISTING_FILTER = 'p.status = 1 AND p.approve_status = 1';

/** An agent a customer may write to: same rule as a listing's visible agent_phone. */
export const CHAT_REACHABLE_AGENT_FILTER =
  'a.deleted_at IS NULL AND a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE';

const OWNER = Object.freeze({ customer: 't.customer_id', agent: 't.agent_id' });
const READ = Object.freeze({ customer: 'customer_last_read_id', agent: 'agent_last_read_id' });
const ARCHIVE = Object.freeze({ customer: 'customer_archived_at', agent: 'agent_archived_at' });

const sendLimiter = createRateLimiter({ limit: CHAT_SEND_PER_MINUTE, windowMs: 60_000 });

const MISSING_TABLE = '42P01';

function isMissingTable(err) {
  return err?.code === MISSING_TABLE;
}

function checkViewer(viewer) {
  if (!viewer || !OWNER[viewer.role] || !parseId(viewer.id)) throw new Error('chat: invalid viewer');
  return viewer;
}

// ---------------------------------------------------------------------------
// Who is asking
// ---------------------------------------------------------------------------

/**
 * The signed-in agent, with the checks lib/customers.js resolveCustomerSession
 * makes for a customer: the token's version must be the account's current
 * one (logout everywhere, password resets), and a deleted account has no
 * session.
 */
export async function getCurrentChatAgentId() {
  const store = await cookies();
  const verified = verifyAgentSessionToken(store.get(AGENT_SESSION_COOKIE)?.value);
  if (!verified) return null;
  const { rows } = await getPool().query('SELECT token_version, deleted_at FROM agents WHERE id = $1', [
    verified.agentId,
  ]);
  const row = rows[0];
  if (!row || row.deleted_at || Number(row.token_version) !== verified.tokenVersion) return null;
  return verified.agentId;
}

/**
 * `as` is 'agent' for the agent's inbox, anything else for the customer's.
 * One browser can hold both sessions (an agent who also rents); the side is
 * named by the page, the identity always comes from that side's own cookie.
 *
 * @returns {Promise<{role: 'customer'|'agent', id: number}|null>}
 */
export async function getChatViewer(as) {
  if (as === 'agent') {
    const id = await getCurrentChatAgentId();
    return id ? { role: 'agent', id } : null;
  }
  const id = await getCurrentCustomerId();
  return id ? { role: 'customer', id } : null;
}

// ---------------------------------------------------------------------------
// Shapes handed to the screens
// ---------------------------------------------------------------------------

/** A listing as a chat card. Only public listings get one; null reads "plus en ligne". */
export function chatListingCard(row) {
  if (!row) return null;
  const price = row.currency === 'CDF'
    ? formatPriceCdf(row.price, row.purpose, row.price_period)
    : formatPrice(row.price, row.purpose, row.price_period);
  return {
    id: Number(row.id),
    category: row.category_name || null,
    beds: row.beds == null ? null : Number(row.beds),
    priceLabel: price,
    place: feedLocationLine(row),
    image: listingImages(row)[0] || null,
  };
}

async function listingCardsById(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  if (unique.length === 0) return new Map();
  const rows = await getListingsByIds(unique);
  return new Map(rows.map((row) => [Number(row.id), chatListingCard(row)]));
}

function threadShape(row, viewer, cards) {
  const counterpart = viewer.role === 'customer'
    ? {
        role: 'agent',
        id: Number(row.agent_id),
        name: row.agent_name || row.agency_name || null,
        agency: row.agency_name || null,
        image: row.agent_image || null,
        verified: Boolean(row.agent_verified),
      }
    : {
        role: 'customer',
        id: Number(row.customer_id),
        name: shortPersonName(row.customer_name),
        agency: null,
        image: null,
        verified: Boolean(row.customer_verified),
        since: row.customer_since ? new Date(row.customer_since).toISOString() : null,
      };
  const propertyId = row.property_id == null ? null : Number(row.property_id);
  return {
    id: Number(row.id),
    counterpart,
    propertyId,
    listing: propertyId ? cards.get(propertyId) || null : null,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    lastMessagePreview: row.last_message_preview || null,
    lastSenderRole: row.last_sender_role || null,
    lastMessageId: row.last_message_id == null ? null : Number(row.last_message_id),
    unread: Number(row.unread || 0),
    myLastReadId: Number(row.my_last_read_id || 0),
    otherLastReadId: Number(row.other_last_read_id || 0),
    archived: Boolean(row.archived_at),
    blocked: Boolean(row.blocked_at),
    blockedBy: row.blocked_by || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function messageShape(row, cards) {
  const propertyId = row.property_id == null ? null : Number(row.property_id);
  return {
    id: Number(row.id),
    senderRole: row.sender_role,
    kind: row.kind,
    body: row.body ?? null,
    propertyId,
    listing: row.kind === 'listing' && propertyId ? cards.get(propertyId) || null : null,
    payload: row.payload ?? null,
    clientId: row.client_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** The SELECT list every thread read shares; `$2` is the viewer's role. */
function threadSelect(role) {
  const other = otherRole(role);
  return `
    SELECT t.id, t.customer_id, t.agent_id, t.property_id, t.last_message_id, t.last_message_at,
           t.last_message_preview, t.last_sender_role, t.blocked_at, t.blocked_by, t.created_at,
           t.${ARCHIVE[role]} AS archived_at,
           t.${READ[role]} AS my_last_read_id,
           t.${READ[other]} AS other_last_read_id,
           (SELECT COUNT(*)::int FROM chat_messages m
             WHERE m.thread_id = t.id AND m.id > t.${READ[role]}
               AND m.sender_role <> $2 AND m.deleted_at IS NULL) AS unread,
           c.full_name AS customer_name,
           c.created_at AS customer_since,
           (c.phone_verified_at IS NOT NULL) AS customer_verified,
           NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS agent_name,
           NULLIF(TRIM(a.agency_name), '') AS agency_name,
           a.image AS agent_image,
           (a.phone_verified_at IS NOT NULL) AS agent_verified
      FROM chat_threads t
      JOIN customers c ON c.id = t.customer_id
      JOIN agents a ON a.id = t.agent_id
      ${AGENT_INFOS_JOIN}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One inbox page, newest conversation first. A thread with no message yet
 * (opened, first send refused) is never listed.
 *
 * @returns {Promise<{threads: object[], nextCursor: string|null}>}
 */
export async function listThreads(viewer, { filter, cursor, limit } = {}) {
  checkViewer(viewer);
  const view = normaliseInboxFilter(filter);
  const size = Math.min(Math.max(parseId(limit) || CHAT_INBOX_PAGE_SIZE, 1), 100);
  const params = [viewer.id, viewer.role];
  const where = [`${OWNER[viewer.role]} = $1`, 't.last_message_id IS NOT NULL'];

  where.push(view === 'archived' ? `t.${ARCHIVE[viewer.role]} IS NOT NULL` : `t.${ARCHIVE[viewer.role]} IS NULL`);
  if (view === 'unread') {
    where.push(`EXISTS (SELECT 1 FROM chat_messages um
                         WHERE um.thread_id = t.id AND um.id > t.${READ[viewer.role]}
                           AND um.sender_role <> $2 AND um.deleted_at IS NULL)`);
  }
  const after = decodeInboxCursor(cursor);
  if (after?.at) {
    params.push(after.at, after.id);
    where.push(`(t.last_message_at < $${params.length - 1}
                 OR (t.last_message_at = $${params.length - 1} AND t.id < $${params.length}))`);
  }
  params.push(size + 1);

  let rows;
  try {
    ({ rows } = await getPool().query(
      `${threadSelect(viewer.role)}
        WHERE ${where.join(' AND ')}
        ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
        LIMIT $${params.length}`,
      params,
    ));
  } catch (err) {
    if (isMissingTable(err)) return { threads: [], nextCursor: null };
    throw err;
  }
  const page = rows.slice(0, size);
  const cards = await listingCardsById(page.map((row) => row.property_id));
  const threads = page.map((row) => threadShape(row, viewer, cards));
  return { threads, nextCursor: rows.length > size ? encodeInboxCursor(page[page.length - 1]) : null };
}

/** One thread the viewer belongs to, or null (missing and not-yours look the same). */
export async function getThread(viewer, threadId) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return null;
  let rows;
  try {
    ({ rows } = await getPool().query(
      `${threadSelect(viewer.role)} WHERE ${OWNER[viewer.role]} = $1 AND t.id = $3`,
      [viewer.id, viewer.role, id],
    ));
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
  if (!rows[0]) return null;
  const cards = await listingCardsById([rows[0].property_id]);
  return threadShape(rows[0], viewer, cards);
}

/**
 * Messages of one thread, oldest first.
 *  - `after`: everything newer than that id (the poll), up to a page.
 *  - `before`: the page just older than that id (scrolling back).
 *  - neither: the latest page.
 *
 * @returns {Promise<{messages: object[], hasMore: boolean}|null>} null when the thread is not the viewer's.
 */
export async function listMessages(viewer, threadId, { after, before, limit } = {}) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return null;
  const size = Math.min(Math.max(parseId(limit) || CHAT_PAGE_SIZE, 1), 100);
  const afterId = parseId(after);
  const beforeId = parseId(before);
  const params = [id, viewer.id];
  let range = '';
  let order = 'DESC';
  if (afterId) {
    params.push(afterId);
    range = `AND m.id > $${params.length}`;
    order = 'ASC';
  } else if (beforeId) {
    params.push(beforeId);
    range = `AND m.id < $${params.length}`;
  }
  params.push(size + 1);

  let rows;
  try {
    const access = await getPool().query(`SELECT t.id FROM chat_threads t WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2`, [
      id,
      viewer.id,
    ]);
    if (!access.rows[0]) return null;
    ({ rows } = await getPool().query(
      `SELECT m.id, m.sender_role, m.kind, m.body, m.property_id, m.payload, m.client_id, m.created_at
         FROM chat_messages m
         JOIN chat_threads t ON t.id = m.thread_id AND ${OWNER[viewer.role]} = $2
        WHERE m.thread_id = $1 AND m.deleted_at IS NULL ${range}
        ORDER BY m.id ${order}
        LIMIT $${params.length}`,
      params,
    ));
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
  const hasMore = rows.length > size;
  const page = rows.slice(0, size);
  if (order === 'DESC') page.reverse();
  const cards = await listingCardsById(page.filter((row) => row.kind === 'listing').map((row) => row.property_id));
  return { messages: page.map((row) => messageShape(row, cards)), hasMore };
}

/** Conversations with at least one unread message, for the menu badges. Archived ones do not count. */
export async function countUnreadThreads(viewer) {
  checkViewer(viewer);
  try {
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM chat_threads t
        WHERE ${OWNER[viewer.role]} = $1 AND t.${ARCHIVE[viewer.role]} IS NULL
          AND EXISTS (SELECT 1 FROM chat_messages m
                       WHERE m.thread_id = t.id AND m.id > t.${READ[viewer.role]}
                         AND m.sender_role <> $2 AND m.deleted_at IS NULL)`,
      [viewer.id, viewer.role],
    );
    return Number(rows[0]?.n || 0);
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

/**
 * Who a customer would be writing to, for the "first message" screen: from a
 * listing (its own agent, the listing public) or from an agent's profile.
 * Null when the chat is not offered — the same gates startThread applies, so
 * the screen never shows a composer that would then be refused.
 *
 * @returns {Promise<{agentId: number, name: string|null, agency: string|null, image: string|null,
 *   propertyId: number|null, listing: object|null}|null>}
 */
export async function getChatTarget({ propertyId, agentId } = {}) {
  const listingId = parseId(propertyId);
  const wanted = parseId(agentId);
  if (!listingId && !wanted) return null;
  const { rows } = await getPool().query(
    listingId
      ? `SELECT a.id, NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS agent_name,
                NULLIF(TRIM(a.agency_name), '') AS agency_name, a.image
           FROM properties p JOIN agents a ON a.id = p.agent_id ${AGENT_INFOS_JOIN}
          WHERE p.id = $1 AND ${CHAT_PUBLIC_LISTING_FILTER} AND ${CHAT_REACHABLE_AGENT_FILTER}`
      : `SELECT a.id, NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS agent_name,
                NULLIF(TRIM(a.agency_name), '') AS agency_name, a.image
           FROM agents a ${AGENT_INFOS_JOIN}
          WHERE a.id = $1 AND ${CHAT_REACHABLE_AGENT_FILTER}`,
    [listingId || wanted],
  );
  const row = rows[0];
  if (!row) return null;
  const cards = await listingCardsById(listingId ? [listingId] : []);
  return {
    agentId: Number(row.id),
    name: row.agent_name || row.agency_name || null,
    agency: row.agency_name || null,
    image: row.image || null,
    propertyId: listingId || null,
    listing: listingId ? cards.get(listingId) || null : null,
  };
}

/**
 * The agent's own PUBLIC listings as chat cards, newest first, for "Partager
 * un bien". The same rule sendMessage enforces for a `listing` message, so
 * nothing offered here is refused on send.
 */
export async function listShareableListings(agentId, limit = 100) {
  const id = parseId(agentId);
  if (!id) return [];
  const { rows } = await getPool().query(
    `SELECT p.id FROM properties p
      WHERE p.agent_id = $1 AND ${CHAT_PUBLIC_LISTING_FILTER}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    [id, Math.min(Math.max(parseId(limit) || 100, 1), 300)],
  );
  if (rows.length === 0) return [];
  const order = rows.map((row) => Number(row.id));
  const cards = await listingCardsById(order);
  return order.map((pid) => cards.get(pid)).filter(Boolean);
}

/** The customer's existing thread with this agent about this listing (or none), so "Envoyer un message" reopens it. */
export async function findCustomerThreadId(customerId, agentId, propertyId) {
  const customer = parseId(customerId);
  const agent = parseId(agentId);
  if (!customer || !agent) return null;
  try {
    const { rows } = await getPool().query(
      `SELECT id FROM chat_threads
        WHERE customer_id = $1 AND agent_id = $2 AND COALESCE(property_id, 0) = COALESCE($3::bigint, 0)
          AND last_message_id IS NOT NULL`,
      [customer, agent, parseId(propertyId)],
    );
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result?.status === 'ok' ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sends one message as the viewer.
 *
 * kinds: 'text' (body required) and 'listing' (agents only: one of their OWN
 * public listings, optional body). A repeated `clientId` returns the message
 * already stored for it, so a retry on a weak link never posts twice.
 *
 * @returns {Promise<{status: 'ok', message: object, duplicate: boolean}
 *   | {status: 'not-found'|'blocked'|'rate-limited'|'empty'|'too-long'|'invalid-kind'|'listing-unavailable'|'unavailable'}>}
 */
export async function sendMessage(viewer, threadId, { body, clientId, kind = 'text', propertyId } = {}) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return { status: 'not-found' };

  let text = null;
  let listingId = null;
  if (kind === 'text') {
    const checked = normaliseMessageBody(body);
    if (!checked.ok) return { status: checked.error };
    text = checked.body;
  } else if (kind === 'listing') {
    if (viewer.role !== 'agent') return { status: 'invalid-kind' };
    listingId = parseId(propertyId);
    if (!listingId) return { status: 'listing-unavailable' };
    if (body != null && String(body).trim() !== '') {
      const checked = normaliseMessageBody(body);
      if (!checked.ok) return { status: checked.error };
      text = checked.body;
    }
  } else {
    return { status: 'invalid-kind' };
  }
  const client = normaliseClientId(clientId);

  if (!sendLimiter.take(`${viewer.role}:${viewer.id}`)) return { status: 'rate-limited' };

  const result = await withTransaction(async (db) => {
    const { rows: threads } = await db.query(
      `SELECT t.id, t.blocked_at FROM chat_threads t WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2 FOR UPDATE`,
      [id, viewer.id],
    );
    if (!threads[0]) return { status: 'not-found' };

    if (client) {
      const { rows: existing } = await db.query(
        `SELECT id, sender_role, kind, body, property_id, payload, client_id, created_at
           FROM chat_messages WHERE thread_id = $1 AND client_id = $2`,
        [id, client],
      );
      if (existing[0]) return { status: 'ok', row: existing[0], duplicate: true };
    }
    if (threads[0].blocked_at) return { status: 'blocked' };

    if (listingId) {
      const { rows: own } = await db.query(
        `SELECT p.id FROM properties p WHERE p.id = $1 AND p.agent_id = $2 AND ${CHAT_PUBLIC_LISTING_FILTER}`,
        [listingId, viewer.id],
      );
      if (!own[0]) return { status: 'listing-unavailable' };
    }

    const { rows: inserted } = await db.query(
      `INSERT INTO chat_messages (thread_id, sender_role, kind, body, property_id, client_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, sender_role, kind, body, property_id, payload, client_id, created_at`,
      [id, viewer.role, kind, text, listingId, client],
    );
    const row = inserted[0];
    await db.query(
      `UPDATE chat_threads
          SET last_message_id = $2,
              last_message_at = $3,
              last_message_preview = $4,
              last_sender_role = $5,
              ${READ[viewer.role]} = GREATEST(${READ[viewer.role]}, $2),
              customer_archived_at = NULL,
              agent_archived_at = NULL,
              agent_first_reply_at = CASE WHEN $5 = 'agent' THEN COALESCE(agent_first_reply_at, $3) ELSE agent_first_reply_at END,
              updated_at = NOW()
        WHERE id = $1`,
      [id, row.id, row.created_at, messagePreview({ kind, body: text }), viewer.role],
    );
    return { status: 'ok', row, duplicate: false };
  });

  if (result.status !== 'ok') return result;
  const cards = await listingCardsById(result.row.kind === 'listing' ? [result.row.property_id] : []);
  return { status: 'ok', message: messageShape(result.row, cards), duplicate: result.duplicate };
}

/**
 * A customer opens (or re-opens) the conversation about a listing — or with
 * an agent from their profile when `propertyId` is absent — and sends its
 * first message. The agent comes from the listing, never from the request,
 * whenever there is a listing.
 *
 * `created` is true only when this call made the thread: the caller records
 * the `listing-chat` lead then, once.
 *
 * @returns {Promise<{status: 'ok', threadId: number, created: boolean, message: object}
 *   | {status: 'phone-unverified'|'listing-unavailable'|'agent-unavailable'|'self'|'limit'|'empty'|'too-long'|'rate-limited'|'unavailable'|...}>}
 */
export async function startThread(customerId, { propertyId, agentId, body, clientId } = {}) {
  const viewer = checkViewer({ role: 'customer', id: customerId });
  const checked = normaliseMessageBody(body);
  if (!checked.ok) return { status: checked.error };

  const pool = getPool();
  const { rows: customers } = await pool.query(
    'SELECT phone FROM customers WHERE id = $1',
    [viewer.id],
  );
  const customer = customers[0];
  // Any signed-in customer may write, confirmed number or not (2026-11-06,
  // owner decision). 'phone-unverified' stays in the status vocabulary only
  // for an open tab holding the old answer.
  if (!customer) return { status: 'unavailable' };

  const listingId = parseId(propertyId);
  let agent;
  if (listingId) {
    const { rows } = await pool.query(
      `SELECT a.id, a.phone FROM properties p JOIN agents a ON a.id = p.agent_id
        WHERE p.id = $1 AND ${CHAT_PUBLIC_LISTING_FILTER} AND ${CHAT_REACHABLE_AGENT_FILTER}`,
      [listingId],
    );
    if (!rows[0]) return { status: 'listing-unavailable' };
    agent = rows[0];
  } else {
    const wanted = parseId(agentId);
    if (!wanted) return { status: 'agent-unavailable' };
    const { rows } = await pool.query(`SELECT a.id, a.phone FROM agents a WHERE a.id = $1 AND ${CHAT_REACHABLE_AGENT_FILTER}`, [
      wanted,
    ]);
    if (!rows[0]) return { status: 'agent-unavailable' };
    agent = rows[0];
  }
  const digits = (value) => String(value || '').replace(/\D/g, '');
  if (digits(agent.phone) && digits(agent.phone) === digits(customer.phone)) return { status: 'self' };

  let threadId;
  let created = false;
  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM chat_threads
        WHERE customer_id = $1 AND agent_id = $2 AND COALESCE(property_id, 0) = COALESCE($3::bigint, 0)`,
      [viewer.id, agent.id, listingId],
    );
    if (existing[0]) {
      threadId = Number(existing[0].id);
    } else {
      const { rows } = await pool.query(
        `INSERT INTO chat_threads (customer_id, agent_id, property_id)
         SELECT $1, $2, $3::bigint
          WHERE (SELECT COUNT(*) FROM chat_threads
                  WHERE customer_id = $1 AND created_at > NOW() - INTERVAL '1 day') < $4
         ON CONFLICT (customer_id, agent_id, (COALESCE(property_id, 0)))
         DO UPDATE SET updated_at = NOW()
         RETURNING id, (xmax = 0) AS created`,
        [viewer.id, agent.id, listingId, CHAT_NEW_THREADS_PER_DAY],
      );
      if (!rows[0]) return { status: 'limit' };
      threadId = Number(rows[0].id);
      created = Boolean(rows[0].created);
    }
  } catch (err) {
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  }

  const sent = await sendMessage(viewer, threadId, { body: checked.body, clientId });
  if (sent.status !== 'ok') return { ...sent, threadId, created };
  return { status: 'ok', threadId, created, message: sent.message };
}

/**
 * Marks the viewer's side read up to `upToId` (never past the thread's last
 * message, never backwards). A POST, so a GET poll — or an admin "viewing as"
 * this account, whose POSTs middleware refuses — never marks anything read.
 */
export async function markRead(viewer, threadId, upToId) {
  checkViewer(viewer);
  const id = parseId(threadId);
  const upTo = parseId(upToId);
  if (!id || !upTo) return { status: 'not-found' };
  try {
    const { rows } = await getPool().query(
      `UPDATE chat_threads t
          SET ${READ[viewer.role]} = GREATEST(t.${READ[viewer.role]}, LEAST($3::bigint, COALESCE(t.last_message_id, 0)))
        WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2
        RETURNING t.${READ[viewer.role]} AS last_read_id`,
      [id, viewer.id, upTo],
    );
    if (!rows[0]) return { status: 'not-found' };
    return { status: 'ok', lastReadId: Number(rows[0].last_read_id) };
  } catch (err) {
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  }
}

/** Archives or restores the thread on the viewer's side only. A new message restores it for both. */
export async function setArchived(viewer, threadId, archived) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return { status: 'not-found' };
  try {
    const { rowCount } = await getPool().query(
      `UPDATE chat_threads t SET ${ARCHIVE[viewer.role]} = CASE WHEN $3 THEN NOW() ELSE NULL END
        WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2`,
      [id, viewer.id, Boolean(archived)],
    );
    return { status: rowCount ? 'ok' : 'not-found' };
  } catch (err) {
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  }
}

/**
 * Blocks the thread: nobody can send into it, both sides keep its history.
 * Only the side that blocked can lift it (an admin block is lifted from the
 * console, later).
 */
export async function setBlocked(viewer, threadId, blocked) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return { status: 'not-found' };
  try {
    const { rowCount } = blocked
      ? await getPool().query(
          `UPDATE chat_threads t SET blocked_at = NOW(), blocked_by = $3, updated_at = NOW()
            WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2 AND t.blocked_at IS NULL`,
          [id, viewer.id, viewer.role],
        )
      : await getPool().query(
          `UPDATE chat_threads t SET blocked_at = NULL, blocked_by = NULL, updated_at = NOW()
            WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2 AND t.blocked_by = $3`,
          [id, viewer.id, viewer.role],
        );
    if (rowCount) return { status: 'ok' };
    const thread = await getThread(viewer, id);
    if (!thread) return { status: 'not-found' };
    // Already in the asked state (whoever blocked it) is fine; lifting the
    // other side's or an admin's block is not.
    return { status: Boolean(blocked) === thread.blocked ? 'ok' : 'forbidden' };
  } catch (err) {
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  }
}

/**
 * Reports the thread (optionally one message of it) to the Lukka Place team.
 * One open report per side: a second report while the first is open changes
 * nothing and still answers ok.
 */
export async function reportThread(viewer, threadId, { reason, note, messageId } = {}) {
  checkViewer(viewer);
  const id = parseId(threadId);
  if (!id) return { status: 'not-found' };
  if (!CHAT_REPORT_REASONS.includes(reason)) return { status: 'invalid-reason' };
  const cleanNote = String(note ?? '').trim().slice(0, CHAT_REPORT_NOTE_MAX) || null;
  try {
    const { rows: access } = await getPool().query(
      `SELECT t.id FROM chat_threads t WHERE t.id = $1 AND ${OWNER[viewer.role]} = $2`,
      [id, viewer.id],
    );
    if (!access[0]) return { status: 'not-found' };
    await getPool().query(
      `INSERT INTO chat_reports (thread_id, message_id, reporter_role, reason, note)
       VALUES ($1, (SELECT m.id FROM chat_messages m WHERE m.id = $2 AND m.thread_id = $1), $3, $4, $5)
       ON CONFLICT (thread_id, reporter_role) WHERE status = 'OPEN' DO NOTHING`,
      [id, parseId(messageId), viewer.role, reason, cleanNote],
    );
    return { status: 'ok' };
  } catch (err) {
    if (isMissingTable(err)) return { status: 'unavailable' };
    throw err;
  }
}
