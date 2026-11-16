/**
 * /admin/contacts — every customer → agent contact, one row each (owner,
 * 2026-11-15: "where can I see exactly which customer contacted which
 * agent"). Pure: lib/contactLogLoader.js reads the rows, this merges them, so
 * tests/unit/contact-log.test.js pins the rules.
 *
 * The same channels as /admin/interactions (lib/interactionCounts.js), which
 * counts them per agent; this lists them:
 *   - Postgres: direct WhatsApp taps (`whatsapp_clicks` DIRECT_WA), direct
 *     call taps (`listing_events` call_click DIRECT), taps outside a listing
 *     (`agent_contact_taps`: profile, directory, project, Espace Client) and
 *     site Messagerie threads (`chat_threads`);
 *   - the engine (GET /admin/contact-log): messages to our number, profile /
 *     project requests, desk introductions, visit requests, and the
 *     "Un client vous contacte" alerts paired with the taps.
 *
 * Only customers' taps are listed (viewer_kind visitor). A tap to our central
 * number is not: the message it led to is listed as an enquiry instead.
 *
 * The customer is known when they wrote to us, asked for a visit, used the
 * Messagerie, or tapped while signed in. An anonymous tap stays anonymous —
 * never guessed from another row.
 */
import { matchTapAlerts } from './contactTapMatch';
import { INTERACTION_CHANNELS, LEAD_SOURCE_CHANNEL } from './interactionCounts';
import { cleanWhatsAppIntent, contactIntentGroup } from './whatsappIntent';

export const CONTACT_CHANNELS = INTERACTION_CHANNELS.map((c) => c.key);
export const CONTACT_WINDOWS = [7, 30, 90];
/**
 * What the customer asked for (2026-11-16, owner: "is the customer simply
 * enquiring or requesting an appointment?"): 'visit' — a visit request, or a
 * WhatsApp tap where they chose « Je veux le visiter »; 'enquiry' — « Est-il
 * disponible ? » or « Autre question »; 'unknown' — a call, a message, a tap
 * from before the chooser. Read from what the customer did, never guessed.
 */
export const CONTACT_WANTS = ['visit', 'enquiry', 'unknown'];
/** A visitor tapping the same contact again within this is a repeat, shown dimmed. */
export const REPEAT_MINUTES = 10;

/** Engine SQLite datetimes are UTC text without a zone ("2026-11-15 09:29:22"). */
export function toIso(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = String(value);
  const normalised = /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const ms = Date.parse(normalised);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const digits = (value) => String(value || '').replace(/\D/g, '');

function customerFrom(customers, id) {
  const customerId = num(id);
  if (!customerId) return null;
  const row = customers?.get?.(customerId);
  return { customerId, phone: row?.phone ? digits(row.phone) : null, name: row?.full_name || null };
}

const VIEWING_STATUS_CODES = {
  PENDING: 'visitPending',
  CONFIRMED: 'visitConfirmed',
  RESCHEDULED: 'visitRescheduled',
  DECLINED: 'visitDeclined',
  CANCELLED: 'visitCancelled',
  COMPLETED: 'visitDone',
  DONE: 'visitDone',
};

function leadStatus(lead) {
  if (lead.contact_followup_answer === 'NOT_YET') return 'customerWaiting';
  if (lead.contact_followup_answer === 'YES') return 'customerConfirmed';
  return lead.status === 'NEW' ? 'notContacted' : 'contacted';
}

function tapStatus(match) {
  if (!match) return 'noAlert';
  return match.state;
}

/**
 * @param {{engine?: {leads?: Object[], viewings?: Object[], tapAlerts?: Object[]},
 *   waTaps?: Object[], callTaps?: Object[], otherTaps?: Object[], chats?: Object[],
 *   customers?: Map<number, {phone: string, full_name: string|null}>,
 *   propertyAgents?: Map<number, number|null>}} sources
 * @returns {Array<Object>} newest first.
 */
export function buildContactRows({
  engine = {}, waTaps = [], callTaps = [], otherTaps = [], chats = [], customers = new Map(), propertyAgents = new Map(),
} = {}) {
  const rows = [];
  const agentOf = (agentId, listingId) => num(agentId) ?? (num(listingId) ? num(propertyAgents.get(num(listingId))) : null);

  const waAlerts = matchTapAlerts(waTaps, engine.tapAlerts || [], { kind: 'whatsapp' });
  for (const tap of waTaps) {
    if (tap.routing_type !== 'DIRECT_WA' || (tap.viewer_kind || 'visitor') !== 'visitor') continue;
    const match = waAlerts.get(String(tap.id));
    rows.push({
      key: `wa:${tap.id}`, at: toIso(tap.created_at), channel: 'whatsappDirect', surface: 'listing',
      intent: cleanWhatsAppIntent(tap.intent),
      customer: customerFrom(customers, tap.customer_id), visitorId: tap.visitor_id || null,
      agentId: agentOf(tap.agent_id, tap.listing_id), listingId: num(tap.listing_id),
      status: tapStatus(match), statusAt: match?.answeredAt || null,
    });
  }

  const callAlerts = matchTapAlerts(callTaps, engine.tapAlerts || [], { kind: 'call' });
  for (const tap of callTaps) {
    if (tap.routing_type !== 'DIRECT' || (tap.viewer_kind || 'visitor') !== 'visitor') continue;
    const match = callAlerts.get(String(tap.id));
    rows.push({
      key: `call:${tap.id}`, at: toIso(tap.created_at), channel: 'callDirect', surface: 'listing',
      customer: customerFrom(customers, tap.customer_id), visitorId: tap.visitor_id || null,
      agentId: agentOf(tap.agent_id, tap.listing_id), listingId: num(tap.listing_id),
      status: tapStatus(match), statusAt: match?.answeredAt || null,
    });
  }

  for (const tap of otherTaps) {
    if ((tap.viewer_kind || 'visitor') !== 'visitor') continue;
    rows.push({
      key: `tap:${tap.id}`, at: toIso(tap.created_at),
      channel: tap.channel === 'call' ? 'callDirect' : 'whatsappDirect', surface: tap.surface,
      customer: customerFrom(customers, tap.customer_id), visitorId: tap.visitor_id || null,
      agentId: num(tap.agent_id), listingId: num(tap.listing_id), projectSlug: tap.project_slug || null,
      status: 'tapOnly', statusAt: null,
    });
  }

  for (const chat of chats) {
    rows.push({
      key: `chat:${chat.id}`, at: toIso(chat.created_at), channel: 'siteChat', surface: null,
      customer: customerFrom(customers, chat.customer_id),
      agentId: num(chat.agent_id), listingId: num(chat.property_id),
      status: chat.agent_first_reply_at ? 'replied' : 'waiting', statusAt: toIso(chat.agent_first_reply_at),
    });
  }

  for (const lead of engine.leads || []) {
    const channel = LEAD_SOURCE_CHANNEL[lead.source];
    if (!channel) continue;
    rows.push({
      key: `lead:${lead.id}`, at: toIso(lead.created_at), channel, surface: null,
      customer: lead.wa_id ? { customerId: null, phone: digits(lead.wa_id), name: lead.name || null } : null,
      agentId: agentOf(lead.agent_id, lead.property_id), listingId: num(lead.property_id),
      developmentId: num(lead.development_id), leadId: num(lead.id),
      status: leadStatus(lead), statusAt: null,
    });
  }

  for (const visit of engine.viewings || []) {
    rows.push({
      key: `visit:${visit.id}`, at: toIso(visit.created_at), channel: 'visitRequest', surface: visit.visit_mode === 'video' ? 'video' : null,
      // "Demander une visite": an appointment asked for, by construction.
      intent: 'visit',
      customer: visit.wa_id ? { customerId: null, phone: digits(visit.wa_id), name: visit.name || null } : null,
      agentId: agentOf(visit.agent_id, visit.property_id), listingId: num(visit.property_id),
      viewingId: num(visit.id),
      status: VIEWING_STATUS_CODES[visit.status] || 'visitOther', statusAt: toIso(visit.first_response_at),
    });
  }

  for (const row of rows) {
    if (row.intent === undefined) row.intent = null;
    row.wants = contactIntentGroup(row.intent);
  }
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || a.key.localeCompare(b.key));
  return markRepeats(rows);
}

/** The same visitor tapping the same agent and listing again within REPEAT_MINUTES. */
function markRepeats(rows) {
  const last = new Map();
  // Oldest first, so the first tap is the one that counts.
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row.visitorId || !row.key.match(/^(wa|call|tap):/)) continue;
    const id = `${row.visitorId}|${row.channel}|${row.agentId}|${row.listingId || row.projectSlug || ''}`;
    const at = Date.parse(row.at);
    const previous = last.get(id);
    if (previous != null && at - previous <= REPEAT_MINUTES * 60_000) row.repeat = true;
    last.set(id, at);
  }
  return rows;
}

/** @returns {number} one of CONTACT_WINDOWS, 30 by default. */
export function contactWindow(raw) {
  const days = Number.parseInt(raw, 10);
  return CONTACT_WINDOWS.includes(days) ? days : 30;
}

/**
 * The page's filters: channel, agent, customer known only, and a search on
 * the customer's number or name.
 */
export function filterContactRows(rows, {
  channel = null, agentId = null, known = false, q = '', wants = null,
} = {}) {
  const term = String(q || '').trim().toLowerCase();
  const termDigits = digits(term);
  const agent = num(agentId);
  return rows.filter((row) => {
    if (channel && CONTACT_CHANNELS.includes(channel) && row.channel !== channel) return false;
    if (agent && row.agentId !== agent) return false;
    if (wants && CONTACT_WANTS.includes(wants) && row.wants !== wants) return false;
    if (known && !row.customer?.phone && !row.customer?.customerId) return false;
    if (term) {
      const phoneHit = termDigits.length >= 4 && (row.customer?.phone || '').includes(termDigits);
      const nameHit = (row.customer?.name || '').toLowerCase().includes(term);
      if (!phoneHit && !nameHit) return false;
    }
    return true;
  });
}

/** Totals over the filtered rows: all, customer known, and per channel. */
export function summariseContactRows(rows) {
  const byChannel = Object.fromEntries(CONTACT_CHANNELS.map((key) => [key, 0]));
  const byWants = Object.fromEntries(CONTACT_WANTS.map((key) => [key, 0]));
  let known = 0;
  let repeats = 0;
  for (const row of rows) {
    if (row.repeat) { repeats += 1; continue; }
    byChannel[row.channel] = (byChannel[row.channel] || 0) + 1;
    byWants[row.wants || 'unknown'] = (byWants[row.wants || 'unknown'] || 0) + 1;
    if (row.customer?.phone || row.customer?.customerId) known += 1;
  }
  return { total: rows.length - repeats, known, repeats, byChannel, byWants };
}
