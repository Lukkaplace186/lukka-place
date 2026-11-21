'use strict';

/**
 * "Votre annonce est en ligne" — one message per agent, in the daytime
 * (owner, 2026-11-21).
 *
 * Before: one message per approved listing, sent the instant a moderator
 * clicked — an agent with three listings approved at 05:50 got three
 * "Bonjour, bonne nouvelle !" within five minutes, before dawn. Now an
 * approval (the team's verdict, routes/admin.js, or trusted auto-approval,
 * services/trustedAutoApprove.js) is QUEUED here, and the `approval-digest`
 * job sends each agent ONE message once their approvals have settled:
 *
 *   - between APPROVAL_DIGEST_FROM_HOUR and APPROVAL_DIGEST_TO_HOUR, Kinshasa
 *     time (default 8 → 20); an approval at night waits for the morning;
 *   - APPROVAL_DIGEST_WAIT_MIN (15) after that agent's LAST queued approval, so
 *     a moderation session's approvals go out together — but never more than
 *     APPROVAL_DIGEST_MAX_WAIT_MIN (120) after the first, in the daytime.
 *
 * The message: the app first (services/pushNotify.js), else WhatsApp — one
 * text listing every listing with its public link while the agent's 24 h
 * window is open; once it has closed only a template arrives, and the approved
 * template names ONE listing, so it goes once per listing (the same as before,
 * but in the daytime).
 *
 * APPROVAL_DIGEST=off (read at call time) sends each approval at once, the old
 * way; whatever is already queued is still sent by the job. Rejections are
 * never queued: the agent has something to fix.
 */

const chakra = require('./chakra');
const db = require('./db');
const pushNotify = require('./pushNotify');
const { insideSessionWindow } = require('./sessionWindow');
const {
  SITE_URL, MES_BIENS_URL, listingApprovedText, approvedTemplateUrlButton,
} = require('./listingApprovedMessage');

const JOB_NAME = 'approval-digest';
const KINSHASA_OFFSET_H = 1;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS approval_notices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    property_id INTEGER NOT NULL,
    summary     TEXT,
    queued_at   TEXT NOT NULL,
    sent_at     TEXT,
    sent_via    TEXT,
    UNIQUE (phone, property_id)
  );
  CREATE INDEX IF NOT EXISTS idx_approval_notices_unsent ON approval_notices (sent_at, phone);
`);

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function digestEnabled() {
  return String(process.env.APPROVAL_DIGEST || '').trim().toLowerCase() !== 'off';
}

/** Kinshasa daytime, when good news may go out. */
function isDaytime(now = new Date()) {
  const hour = (now.getUTCHours() + KINSHASA_OFFSET_H) % 24;
  return hour >= intEnv('APPROVAL_DIGEST_FROM_HOUR', 8) && hour < intEnv('APPROVAL_DIGEST_TO_HOUR', 20);
}

/**
 * Hold one approval for the agent's next message. Idempotent per listing: the
 * same approval twice (a moderator clicking again) is one line.
 *
 * @returns {boolean} whether a new line was queued
 */
function queueApproval({ phone, propertyId, summary = null }, now = new Date()) {
  if (!phone || !Number.isInteger(Number(propertyId))) return false;
  const info = db.db.prepare(
    `INSERT OR IGNORE INTO approval_notices (phone, property_id, summary, queued_at)
     VALUES (?, ?, ?, ?)`,
  ).run(String(phone), Number(propertyId), summary, now.toISOString());
  if (info.changes) console.log(`[approval-digest] listing #${propertyId} queued for ${phone}`);
  return info.changes > 0;
}

/** Agents whose queued approvals are ready to go now. */
function dueBatches(now = new Date()) {
  if (!isDaytime(now)) return [];
  const rows = db.db.prepare(
    `SELECT id, phone, property_id, summary, queued_at
       FROM approval_notices WHERE sent_at IS NULL ORDER BY phone, queued_at, id`,
  ).all();
  const byPhone = new Map();
  for (const row of rows) {
    if (!byPhone.has(row.phone)) byPhone.set(row.phone, []);
    byPhone.get(row.phone).push(row);
  }
  const waitMs = intEnv('APPROVAL_DIGEST_WAIT_MIN', 15) * 60 * 1000;
  const maxMs = intEnv('APPROVAL_DIGEST_MAX_WAIT_MIN', 120) * 60 * 1000;
  const due = [];
  for (const [phone, items] of byPhone) {
    const first = Date.parse(items[0].queued_at);
    const last = Date.parse(items[items.length - 1].queued_at);
    if (now.getTime() - last >= waitMs || now.getTime() - first >= maxMs) due.push({ phone, items });
  }
  return due;
}

function listingLink(propertyId) {
  return `${SITE_URL}/listings/${propertyId}`;
}

/** The WhatsApp text for one agent's batch. One listing keeps the wording agents know. */
function digestText(items) {
  if (items.length === 1) return listingApprovedText(items[0].property_id);
  return [
    `Bonjour, bonne nouvelle ! Vos ${items.length} annonces sont maintenant en ligne :`,
    ...items.map((item, i) => `${i + 1}. ${item.summary || `Annonce n° ${item.property_id}`} : ${listingLink(item.property_id)}`),
    '',
    `Partagez-les à vos clients. Toutes vos annonces : ${MES_BIENS_URL}`,
  ].join('\n');
}

/** The approved template for one listing; false when none is configured or it was refused. */
async function sendApprovedTemplate(to, item) {
  const name = String(process.env.LISTING_APPROVED_TEMPLATE || '').trim();
  if (!chakra.templateConfigured(name)) return false;
  const button = approvedTemplateUrlButton(name, item.property_id);
  try {
    await chakra.sendTemplate(to, name, {
      languageCode: String(process.env.LISTING_MODERATION_TEMPLATE_LANG || 'fr').trim() || 'fr',
      bodyParams: [String(item.property_id), item.summary || 'votre bien'],
      ...(button ? { urlButton: button } : {}),
    });
    return true;
  } catch (err) {
    console.warn(`[approval-digest] template '${name}' for #${item.property_id} failed: ${err.message}`);
    return false;
  }
}

/** WhatsApp for one batch: one text inside the 24 h window, else the template per listing. */
async function sendWhatsAppBatch(phone, items, now) {
  if (!insideSessionWindow(phone, now)) {
    let sent = 0;
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      if (await sendApprovedTemplate(phone, item)) sent += 1;
    }
    if (sent === items.length) return `template x${sent}`;
    // No template (or one refused): the text, which arrives only if the window reopens.
  }
  await chakra.sendWhatsAppMessage(phone, digestText(items), { previewUrl: items.length === 1 });
  return 'session';
}

/** Deliver one agent's batch and mark it sent. Never throws. */
async function deliverBatch({ phone, items }, now = new Date()) {
  const ids = items.map((item) => item.property_id);
  const many = items.length > 1;
  let via;
  try {
    const outcome = await pushNotify.pushFirst({
      phone,
      kind: 'listing_verdict',
      refId: ids[0],
      title: many ? `Vos ${items.length} annonces sont en ligne` : 'Votre annonce est en ligne',
      body: many
        ? `Bonne nouvelle ! ${items.length} annonces ont été validées et sont maintenant visibles sur Lukka Place.`
        : `Bonne nouvelle ! L'annonce n° ${ids[0]} a été validée et est maintenant visible sur Lukka Place.`,
      url: many ? '/compte/agent/biens' : `/compte/agent/biens/${ids[0]}`,
      urgent: false,
      sendWhatsApp: () => sendWhatsAppBatch(phone, items, now),
    });
    via = outcome.pushed ? 'push' : outcome.whatsapp;
  } catch (err) {
    // Marked anyway: a send that failed is retried by nobody, and a second
    // attempt next minute would repeat a message that may have arrived.
    via = `failed: ${String(err.message).slice(0, 120)}`;
    console.error(`[approval-digest] ${phone}: ${err.message}`);
  }
  const mark = db.db.prepare('UPDATE approval_notices SET sent_at = ?, sent_via = ? WHERE id = ?');
  db.db.transaction(() => items.forEach((item) => mark.run(now.toISOString(), via, item.id)))();
  console.log(`[approval-digest] ${phone}: ${items.length} approval(s) ${ids.map((id) => `#${id}`).join(', ')} sent (${via})`);
  return via;
}

async function runApprovalDigest(now = new Date()) {
  const batches = dueBatches(now);
  for (const batch of batches) {
    // eslint-disable-next-line no-await-in-loop
    await deliverBatch(batch, now);
  }
  return { batches: batches.length };
}

/** Cheap: runs every minute. Something queued, and it is daytime. */
function approvalDigestDue(now = new Date()) {
  if (!isDaytime(now)) return false;
  return Boolean(db.db.prepare('SELECT 1 FROM approval_notices WHERE sent_at IS NULL LIMIT 1').get());
}

const approvalDigestJob = { name: JOB_NAME, shouldRun: approvalDigestDue, run: () => runApprovalDigest() };

module.exports = {
  JOB_NAME,
  approvalDigestJob,
  digestEnabled,
  isDaytime,
  queueApproval,
  dueBatches,
  digestText,
  deliverBatch,
  runApprovalDigest,
};
