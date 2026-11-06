/**
 * Messagerie — the pure rules (no database, no session), shared by
 * lib/chat.js, the /api/chat routes and, later, the chat screens.
 * migrations/20261105_chat.sql (engine repo) has the tables.
 *
 * Kept separate from lib/chat.js so a client component can import the limits
 * and the tests can pin every rule without a pool.
 */

export const CHAT_ROLES = Object.freeze(['customer', 'agent']);

/** Same ceiling as the CHECK on chat_messages.body. */
export const CHAT_MESSAGE_MAX = 2000;

/** Same ceiling as the CHECK on chat_threads.last_message_preview. */
export const CHAT_PREVIEW_MAX = 160;

/** Messages one account may send per minute, every thread together. */
export const CHAT_SEND_PER_MINUTE = 30;

/** New conversations a customer may open in 24 hours. Re-opening one never counts. */
export const CHAT_NEW_THREADS_PER_DAY = 10;

/** Messages per page when a thread is opened or scrolled back. */
export const CHAT_PAGE_SIZE = 50;

/** Threads per inbox page. */
export const CHAT_INBOX_PAGE_SIZE = 30;

export const CHAT_INBOX_FILTERS = Object.freeze(['all', 'unread', 'archived']);

export const CHAT_REPORT_REASONS = Object.freeze(['scam', 'harassment', 'spam', 'other']);

export const CHAT_REPORT_NOTE_MAX = 500;

/**
 * Polling cadence for the screens (no live connection exists on this stack:
 * the Supabase pooler does not carry LISTEN/NOTIFY, and a socket over
 * Kinshasa's mobile links drops more than it holds). An open thread asks
 * every 4 s, every 15 s once nothing has happened for a minute, and nothing
 * while the tab is hidden.
 */
export const CHAT_POLL = Object.freeze({ activeMs: 4000, idleMs: 15000, idleAfterMs: 60000, inboxMs: 30000 });

/**
 * Whether a listing page offers "Envoyer un message". `agent_phone` is only
 * set for an agent who passes CHAT_REACHABLE_AGENT_FILTER's rule (verified
 * number, routing on — lib/listings.js nulls it in SQL otherwise), so the
 * button appears exactly where the server would accept the first message.
 */
export function canMessageListing(listing) {
  return Boolean(listing?.agent_phone && listing?.agent_id && listing?.id);
}

/** Where "Envoyer un message" goes: the first-message screen, which reopens an existing conversation. */
export function chatStartHref({ propertyId = null, agentId = null } = {}) {
  if (propertyId) return `/messages/nouveau?listing=${propertyId}`;
  if (agentId) return `/messages/nouveau?agent=${agentId}`;
  return '/messages';
}

/** A badge's text: "1" to "99", then "99+" so it never outgrows its circle. */
export function unreadLabel(count) {
  const n = Number(count) || 0;
  return n > 99 ? '99+' : String(n);
}

/** 'customer' ↔ 'agent'. */
export function otherRole(role) {
  return role === 'agent' ? 'customer' : 'agent';
}

export function isChatRole(value) {
  return CHAT_ROLES.includes(value);
}

/**
 * A message body as stored, or an error code.
 *
 * Trims the ends, normalises line endings, keeps at most one blank line in a
 * row (a paste of a long WhatsApp broadcast keeps its paragraphs, not forty
 * empty lines), and drops control characters other than the newline and tab.
 * Nothing else is rewritten: the words are the sender's.
 *
 * @returns {{ok: true, body: string} | {ok: false, error: 'empty'|'too-long'}}
 */
export function normaliseMessageBody(input) {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return { ok: false, error: 'empty' };
  if (text.length > CHAT_MESSAGE_MAX) return { ok: false, error: 'too-long' };
  return { ok: true, body: text };
}

/** A canonical UUID (any version), lower-cased; null otherwise. */
export function normaliseClientId(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) ? text : null;
}

/** A positive safe integer id, else null. */
export function parseId(value) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(n) && n > 0 && String(value).trim() === String(n) ? n : null;
}

/**
 * The inbox's one-line preview: whitespace collapsed, cut on a word boundary
 * with an ellipsis. A listing card or a visit reads as what it is.
 */
export function messagePreview({ kind = 'text', body = null } = {}) {
  if (kind === 'listing') return 'Bien partagé';
  if (kind === 'visit') return 'Visite';
  const flat = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= CHAT_PREVIEW_MAX) return flat;
  const cut = flat.slice(0, CHAT_PREVIEW_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > CHAT_PREVIEW_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * How a customer is named to an agent in the inbox: first name and the
 * initial of the last ("Grace Kabila" → "Grace K."). A name that is only a
 * phone number, or nothing, is null — the screen then says "Client".
 */
export function shortPersonName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || /^\+?\d{7,15}$/.test(parts.join(''))) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function normaliseInboxFilter(value) {
  return CHAT_INBOX_FILTERS.includes(value) ? value : 'all';
}

/**
 * Inbox keyset cursor: "<last_message_at ISO>|<id>". The order is
 * (last_message_at DESC NULLS LAST, id DESC); a thread with no message yet
 * sorts last and its cursor carries an empty time.
 */
export function encodeInboxCursor(thread) {
  if (!thread) return null;
  const at = thread.last_message_at ? new Date(thread.last_message_at).toISOString() : '';
  return `${at}|${thread.id}`;
}

export function decodeInboxCursor(value) {
  const text = String(value ?? '');
  const bar = text.lastIndexOf('|');
  if (bar < 0) return null;
  const id = parseId(text.slice(bar + 1));
  if (!id) return null;
  const rawAt = text.slice(0, bar);
  if (!rawAt) return { at: null, id };
  const time = Date.parse(rawAt);
  return Number.isNaN(time) ? null : { at: new Date(time).toISOString(), id };
}

/**
 * A sliding-window limiter, in process. Engine and web each run as ONE PM2
 * fork (ecosystem.config.js), the same assumption the guest request form's
 * 5/hour guard makes, so an in-memory window is exact here. Keys are
 * "customer:12" / "agent:7".
 */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return {
    /** Records a hit and answers whether it was allowed. */
    take(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 5000) {
        for (const [k, list] of hits) if (!list.some((at) => t - at < windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}
