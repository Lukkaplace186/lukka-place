/**
 * services/sessionWindow.js
 *
 * When each number last wrote to the intake number — the fact that decides
 * whether a plain WhatsApp text can reach it. Meta delivers a session (free
 * text) message only within 24 hours of the person's last message; outside
 * that window Chakra still accepts the send and nothing arrives. A template
 * reaches anyone, but costs more and reads less naturally, so a caller can
 * send the text while the window is open and the template only once it has
 * closed (first use: the "annonce en ligne" verdict, routes/admin.js).
 *
 * - Written by routes/webhook.js for every inbound message it can read.
 *   Group captures never pass through here: their posters never wrote to us.
 * - A number with no record counts as OUTSIDE the window: the template is the
 *   send that cannot be lost. The table starts empty at deploy, so for the
 *   first day everyone gets the template.
 * - `SESSION_WINDOW_MARGIN_MS` (1 h) is kept back from the 24 h, so a message
 *   sent at 23 h 59 does not race Meta's clock.
 */

const { db } = require('./db');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const SESSION_WINDOW_MARGIN_MS = 60 * 60 * 1000;

db.exec(`
  CREATE TABLE IF NOT EXISTS whatsapp_last_inbound (
    wa_id           TEXT PRIMARY KEY,
    last_inbound_at TEXT NOT NULL
  );
`);

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Record that `waId` just wrote to us. Never moves the time backwards. */
function recordInbound(waId, now = new Date()) {
  const id = digits(waId);
  if (!id) return;
  db.prepare(
    `INSERT INTO whatsapp_last_inbound (wa_id, last_inbound_at) VALUES (?, ?)
       ON CONFLICT(wa_id) DO UPDATE SET last_inbound_at = MAX(last_inbound_at, excluded.last_inbound_at)`,
  ).run(id, now.toISOString());
}

/** ISO time of the number's last message to us, or null when we never saw one. */
function lastInboundAt(waId) {
  const id = digits(waId);
  if (!id) return null;
  return db.prepare('SELECT last_inbound_at FROM whatsapp_last_inbound WHERE wa_id = ?').get(id)?.last_inbound_at || null;
}

/** Can a plain text reach this number right now? */
function insideSessionWindow(waId, now = new Date()) {
  const last = lastInboundAt(waId);
  if (!last) return false;
  return now.getTime() - new Date(last).getTime() < WINDOW_MS - SESSION_WINDOW_MARGIN_MS;
}

module.exports = { recordInbound, lastInboundAt, insideSessionWindow, WINDOW_MS, SESSION_WINDOW_MARGIN_MS };
