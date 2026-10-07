/**
 * Lukka Place's own desk phone — OPS_WHATSAPP_NUMBER.
 *
 * Every desk copy (viewing requests, listing enquiries, project enquiries,
 * declines, closing prices, ops alerts) goes to this number. Three things
 * made setting it more than one env line, and all three live here:
 *
 * 1. **The number is normalised once.** Every reader used to strip non-digits
 *    and nothing else, so a local "0812 345 678" was sent to "0812345678" —
 *    accepted by nobody, failing in silence. DRC shorthand is folded onto
 *    243…; anything that is not 7–15 digits afterwards is treated as unset
 *    and said so at boot.
 *
 * 2. **The desk only hears us inside the 24h window.** No Meta template is
 *    approved, so every desk copy is a session message, and Meta delivers one
 *    only to a number that messaged the business in the last 24 hours. A desk
 *    phone that stays quiet for a day stops receiving everything, with every
 *    send still "accepted". So: any message FROM the desk opens the window
 *    and is answered with when it closes, and the `ops-desk-keepalive` job
 *    asks for a reply about four hours before it does — a message that can
 *    still land, since the window is open — so one "OK" a day keeps it alive.
 *
 * 3. **The desk phone is not an agent.** Without a branch of its own, a
 *    message from it went through listing intake like anyone's: "OK" cost a
 *    model call and got the bot's generic reply, and a listing forwarded from
 *    it to check would have been stored and offered for publication. Desk
 *    messages are handled here and never reach intake.
 */

const chakra = require('./chakra');
const { db } = require('./db');

const HOUR_MS = 60 * 60 * 1000;
/** Meta's customer-service window. */
const WINDOW_MS = 24 * HOUR_MS;
/** Ask for a reply this long after the desk's last message: 4h of margin. */
const REMIND_AFTER_MS = 20 * HOUR_MS;
/** Never ask so close to the end that the question itself arrives too late. */
const REMIND_UNTIL_MS = WINDOW_MS - 15 * 60 * 1000;
const JOB_NAME = 'ops-desk-keepalive';

db.exec(`
  CREATE TABLE IF NOT EXISTS ops_desk_state (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * The desk number as E.164 digits, or null. "+243 81 234 5678",
 * "243812345678", "0812345678" and "812345678" are all 243812345678.
 */
function normaliseOpsNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (/^0\d{9}$/.test(digits)) digits = `243${digits.slice(1)}`;
  else if (/^[89]\d{8}$/.test(digits)) digits = `243${digits}`;
  else if (/^00\d+$/.test(digits)) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/** Read at call time, so tests and a restarted process see the current value. */
function opsNumber() {
  return normaliseOpsNumber(process.env.OPS_WHATSAPP_NUMBER);
}

function isOpsSender(from) {
  const ops = opsNumber();
  return Boolean(ops) && String(from || '').replace(/\D/g, '') === ops;
}

function getState(key) {
  return db.prepare('SELECT value FROM ops_desk_state WHERE key = ?').get(key)?.value ?? null;
}

function setState(key, value) {
  db.prepare(
    `INSERT INTO ops_desk_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value == null ? null : String(value));
}

/** "mer. 8 oct. à 22:47", Kinshasa time (UTC+1, no DST). */
function kinshasaTime(date) {
  const shifted = new Date(date.getTime() + HOUR_MS);
  const days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${days[shifted.getUTCDay()]} ${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]} à ${hh}:${mm}`;
}

/**
 * What /admin/health and the setup script show. `windowOpen` is our own
 * reading of Meta's rule from the last message we received — Meta does not
 * tell us, so it is labelled as an estimate wherever it is shown.
 */
function deskStatus(now = new Date()) {
  const raw = process.env.OPS_WHATSAPP_NUMBER || '';
  const number = opsNumber();
  const last = getState('last_message_at');
  const lastAt = last ? new Date(last) : null;
  const openUntil = lastAt ? new Date(lastAt.getTime() + WINDOW_MS) : null;
  return {
    configured: Boolean(number),
    invalid: Boolean(raw.trim()) && !number,
    number,
    lastMessageAt: lastAt ? lastAt.toISOString() : null,
    windowOpenUntil: openUntil ? openUntil.toISOString() : null,
    windowOpen: Boolean(openUntil && openUntil > now),
    reminderSentAt: getState('reminder_sent_at'),
  };
}

const MEDIA_OR_LISTING_REPLY =
  "Ce numéro est le bureau Lukka Place : ce qui est envoyé d'ici n'est jamais publié. "
  + "Pour publier une annonce, envoyez-la depuis le WhatsApp d'un agent.";

/**
 * A message from the desk phone: open the window, answer with when it closes,
 * and stop. Returns { handled: false } for anyone else.
 */
async function handleDeskMessage({ from, text = '', hasMedia = false, wamid = null, now = new Date() }) {
  if (!isOpsSender(from)) return { handled: false };
  // A redelivered webhook must not answer twice.
  if (wamid && getState('last_wamid') === wamid) return { handled: true, duplicate: true };

  setState('last_message_at', now.toISOString());
  if (wamid) setState('last_wamid', wamid);

  const until = kinshasaTime(new Date(now.getTime() + WINDOW_MS));
  const status = `✅ Bureau Lukka Place : alertes actives jusqu'au ${until}. `
    + 'Je vous demanderai de répondre avant cette heure pour les garder actives.';
  const looksLikeListing = hasMedia || String(text).trim().length > 200;
  const reply = looksLikeListing ? `${MEDIA_OR_LISTING_REPLY}\n\n${status}` : status;

  console.log(`[ops-desk] message from the desk — window open until ${until} (Kinshasa)`);
  try {
    await chakra.sendWhatsAppMessage(opsNumber(), reply, { replyToMessageId: wamid || undefined });
  } catch (err) {
    console.error(`[ops-desk] could not answer the desk: ${err.message}`);
  }
  return { handled: true };
}

/** Due once per desk message, between 20h and 23h45 after it. Cheap: two key reads. */
function keepaliveDue(now = new Date()) {
  if (!opsNumber()) return false;
  const last = getState('last_message_at');
  if (!last) return false;
  const elapsed = now.getTime() - new Date(last).getTime();
  if (elapsed < REMIND_AFTER_MS || elapsed > REMIND_UNTIL_MS) return false;
  return getState('reminder_for') !== last;
}

async function runKeepalive(now = new Date()) {
  const last = getState('last_message_at');
  const until = kinshasaTime(new Date(new Date(last).getTime() + WINDOW_MS));
  // Claimed before the send: a failed send is logged, not retried every minute.
  setState('reminder_for', last);
  await chakra.sendWhatsAppMessage(
    opsNumber(),
    `⏰ Bureau Lukka Place : répondez OK pour garder les alertes actives 24 h de plus. `
      + `Sans réponse, elles s'arrêtent le ${until}.`,
  );
  setState('reminder_sent_at', now.toISOString());
  console.log(`[ops-desk] keep-alive question sent — window closes ${until} (Kinshasa)`);
  return { sent: true };
}

/** Said once at boot: an unparseable number is as silent as an unset one. */
function warnIfOpsInvalid() {
  const raw = process.env.OPS_WHATSAPP_NUMBER || '';
  if (!raw.trim()) return false;
  const number = opsNumber();
  if (!number) {
    console.error(`[ops-desk] OPS_WHATSAPP_NUMBER is set but is not a phone number — treated as unset.`);
    return true;
  }
  const status = deskStatus();
  console.log(
    `[ops-desk] desk number …${number.slice(-4)}; `
      + (status.windowOpen
        ? `window open until ${status.windowOpenUntil}`
        : 'window CLOSED — desk copies will not arrive until the desk phone messages the business number'),
  );
  return false;
}

const opsDeskKeepaliveJob = { name: JOB_NAME, shouldRun: keepaliveDue, run: () => runKeepalive() };

module.exports = {
  WINDOW_MS,
  REMIND_AFTER_MS,
  normaliseOpsNumber,
  opsNumber,
  isOpsSender,
  deskStatus,
  handleDeskMessage,
  keepaliveDue,
  runKeepalive,
  warnIfOpsInvalid,
  kinshasaTime,
  opsDeskKeepaliveJob,
  MEDIA_OR_LISTING_REPLY,
};
