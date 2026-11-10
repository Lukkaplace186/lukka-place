'use strict';

/**
 * What the agent actually sent for a published listing: the inbound WhatsApp
 * messages around the draft's creation, and the text the model read. Read by
 * the admin's review mode (web /admin/listings/review), which shows it beside
 * what we extracted, so a wrong reading (or a customer's enquiry taken for a
 * listing, 2026-11-10: #806, #811) is visible at a glance.
 *
 * Read-only. A listing created on the web form has no SQLite row: it gets
 * `{ channel: 'web' }` and the admin shows the description instead.
 */

const db = require('./db');

/** Inbound messages this long before and after the draft was created belong to it. */
const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 30 * 60 * 1000;
const MAX_MESSAGES = 12;
const MAX_IDS = 100;
const MAX_BODY = 2000;

/** SQLite's "2026-11-10 10:06:08" (UTC) and ISO strings alike. */
function toMs(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
}

function parseIds(raw) {
  const ids = [];
  for (const part of String(raw || '').split(',')) {
    const id = Number.parseInt(part, 10);
    if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_IDS) break;
  }
  return ids;
}

function sourceFor(propertyId, handle = db.db) {
  const listing = handle
    .prepare(
      `SELECT id, wa_id, raw_text, created_at FROM listings
       WHERE remote_property_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(propertyId);
  if (!listing) return { propertyId, channel: 'web', rawText: null, messages: [] };

  const created = toMs(listing.created_at);
  let messages = [];
  if (Number.isFinite(created) && listing.wa_id) {
    const rows = handle
      .prepare(
        `SELECT kind, body, media_count, created_at FROM whatsapp_message_log
         WHERE wa_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 200`,
      )
      .all(listing.wa_id);
    messages = rows
      .filter((row) => {
        const at = toMs(row.created_at);
        return Number.isFinite(at) && at >= created - WINDOW_BEFORE_MS && at <= created + WINDOW_AFTER_MS;
      })
      .reverse()
      .slice(0, MAX_MESSAGES)
      .map((row) => ({
        at: new Date(toMs(row.created_at)).toISOString(),
        kind: row.kind,
        body: row.body ? String(row.body).slice(0, MAX_BODY) : null,
        mediaCount: row.media_count == null ? null : Number(row.media_count),
      }));
  }
  return {
    propertyId,
    channel: 'whatsapp',
    rawText: listing.raw_text ? String(listing.raw_text).slice(0, MAX_BODY) : null,
    messages,
  };
}

/** `{ [propertyId]: source }` for up to MAX_IDS ids; never throws per id. */
function getListingSources(ids, handle = db.db) {
  const out = {};
  for (const id of ids) {
    try {
      out[id] = sourceFor(id, handle);
    } catch (err) {
      console.warn(`[listing-source] #${id}: ${err.message}`);
      out[id] = { propertyId: id, channel: 'unknown', rawText: null, messages: [] };
    }
  }
  return out;
}

module.exports = { parseIds, getListingSources, toMs, WINDOW_BEFORE_MS, WINDOW_AFTER_MS, MAX_IDS };
