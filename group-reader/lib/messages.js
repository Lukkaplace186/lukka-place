/**
 * Pure helpers over Baileys message keys and (already normalised) content, so
 * the rules about what is read are testable without a socket.
 */

'use strict';

/** Only a group we were told to read. DMs (@s.whatsapp.net / @lid) and status@broadcast never pass. */
function isWatchedGroup(jid, watched) {
  return typeof jid === 'string' && jid.endsWith('@g.us') && watched.has(jid);
}

/** Stable per-author id for batching: the participant as WhatsApp addressed it (phone or LID). */
function authorOf(key) {
  return key.participant || key.participantAlt || key.participantPn || null;
}

/**
 * The poster's phone digits. In WhatsApp's LID addressing mode `participant`
 * is an opaque `…@lid` and the phone, when WhatsApp shares it, is in
 * `participantAlt`; only a `@s.whatsapp.net` jid is a phone number.
 * Returns null when no phone was shared — never the LID's digits.
 */
function phoneOf(key) {
  for (const jid of [key.participantAlt, key.participantPn, key.participant]) {
    if (typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')) {
      const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return digits;
    }
  }
  return null;
}

/** Text and image of a normalised message content. */
function contentOf(content) {
  if (!content) return { text: '', image: null };
  const text = content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || '';
  return { text: String(text), image: content.imageMessage || null };
}

const EXTENSION_BY_MIME = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** `grp_<msgid>-<n>.jpg` — wamids carry '=' '+' '.', so the id is made filesystem- and URL-safe. */
function photoFileName(messageId, n, mimetype) {
  const safe = String(messageId).replace(/[^A-Za-z0-9_-]/g, '_');
  const ext = EXTENSION_BY_MIME[String(mimetype || '').split(';')[0]] || 'jpg';
  return `grp_${safe}-${n}.${ext}`;
}

module.exports = { isWatchedGroup, authorOf, phoneOf, contentOf, photoFileName };
