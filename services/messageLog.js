/**
 * Every WhatsApp message our numbers send or receive, in one table
 * (SQLite `whatsapp_message_log`, 2026-11-09).
 *
 * WHY
 * The gap analysis of 2026-11-09 found that an agent's free text existed only
 * in pm2-out.log, a message an agent sent "via Lukka Place" was stored
 * nowhere, and customer messages were kept only inside assistant
 * conversations. The owner wants every interaction between customers and
 * agents recorded. Whatever passes through our numbers is now kept here, so
 * the admin can read one person's whole WhatsApp history.
 *
 * Called from services/chakra.js after a send Chakra ACCEPTED (never a
 * delivery receipt — none reach us) and from routes/webhook.js for each
 * inbound message. Never throws into its caller: a logging failure must not
 * stop a message.
 */

let dbService = null;
function db() {
  // Lazy: chakra.js is loaded by modules db.js never needs, and the other way round.
  // eslint-disable-next-line global-require
  if (!dbService) dbService = require('./db');
  return dbService;
}

/** `MESSAGE_LOG=off` stops recording (read at call time); unset is on. */
function enabled() {
  return String(process.env.MESSAGE_LOG || '').trim().toLowerCase() !== 'off';
}

function safeRecord(entry) {
  if (!enabled()) return null;
  try {
    return db().recordWhatsAppMessage(entry);
  } catch (err) {
    console.error(`[message-log] could not record ${entry?.direction} message for ${entry?.waId}: ${err.message}`);
    return null;
  }
}

/** A template's own wording lives at Meta: keep its name and parameters. */
function templateSummary(bodyParams = [], buttons = null, urlButton = null) {
  const parts = (bodyParams || []).map((p, i) => `{{${i + 1}}} ${String(p).replace(/\s+/g, ' ')}`);
  if (Array.isArray(buttons) && buttons.length) parts.push(`boutons: ${buttons.map((b) => b?.id).filter(Boolean).join(', ')}`);
  if (urlButton != null) parts.push(`lien: ${urlButton}`);
  return parts.join(' · ') || null;
}

function wamidOf(result) {
  return result?._data?.whatsappMessageId ?? result?.messages?.[0]?.id ?? null;
}

function recordOutboundText(to, text, result) {
  return safeRecord({ direction: 'out', waId: to, kind: 'text', body: text, wamid: wamidOf(result) });
}

function recordOutboundInteractive(to, text, buttons, result) {
  const labels = (buttons || []).map((b) => `[${b?.title || b?.id}]`).join(' ');
  return safeRecord({
    direction: 'out', waId: to, kind: 'interactive', body: labels ? `${text}\n${labels}` : text, wamid: wamidOf(result),
  });
}

function recordOutboundTemplate(to, name, { bodyParams, buttons, urlButton, sender } = {}, result) {
  return safeRecord({
    direction: 'out',
    waId: to,
    kind: 'template',
    templateName: name,
    body: templateSummary(bodyParams, buttons, urlButton),
    senderNumber: sender?.phoneNumberId || null,
    wamid: wamidOf(result),
  });
}

/** One normalised inbound message (routes/webhook.js normaliseMessage). */
function recordInbound(message) {
  if (!message?.from) return null;
  const mediaCount = Array.isArray(message.media) ? message.media.length : 0;
  let kind = 'text';
  if (message.replyId) kind = 'button';
  else if (mediaCount && !message.text) kind = 'media';
  else if (!message.text) kind = message.type || 'other';
  return safeRecord({
    direction: 'in',
    waId: message.from,
    kind,
    body: message.text || null,
    replyId: message.replyId || null,
    mediaCount: mediaCount || null,
    wamid: message.wamid || null,
  });
}

module.exports = {
  enabled,
  recordOutboundText,
  recordOutboundInteractive,
  recordOutboundTemplate,
  recordInbound,
  templateSummary,
};
