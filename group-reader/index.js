/**
 * Lukka Place group reader.
 *
 * Logs in as a LINKED DEVICE of the "Lukka Place Annonces" SIM (never the
 * business number) and reads the brokers' WhatsApp groups that SIM has
 * joined — the Cloud API behind the engine never delivers group messages.
 * Each listing posted in a watched group is batched per (group, author),
 * filtered for chatter, and POSTed to the engine's /internal/group-posts.
 *
 * Strictly read-only: nothing is ever sent to a chat, no read receipts, no
 * presence beyond the passive "unavailable" Baileys announces at connect.
 *
 *   node index.js                 run (first run prints a QR to link the SIM)
 *   node index.js --list-groups   print the joined groups' JIDs and names, exit
 *
 * See README.md for setup, env vars and the ban risk.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');

const { Batcher } = require('./lib/batcher');
const { shouldForward } = require('./lib/prefilter');
const { postGroupPost } = require('./lib/forwarder');
const { ForwardedStore } = require('./lib/forwardedStore');
const { isWatchedGroup, authorOf, phoneOf, contentOf, photoFileName } = require('./lib/messages');

/** group-reader/.env first, then the engine's .env beside it; an already-set variable always wins. */
function loadEnv() {
  for (const file of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (typeof util.parseEnv !== 'function') {
      console.warn(`[group-reader] Node ${process.versions.node} has no util.parseEnv; ${file} not loaded`);
      return;
    }
    for (const [k, v] of Object.entries(util.parseEnv(raw))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
loadEnv();

const LIST_GROUPS = process.argv.includes('--list-groups');
const AUTH_DIR = process.env.GROUP_READER_AUTH_DIR || '/var/data/group-reader-auth';
const QR_PNG = process.env.GROUP_READER_QR_PNG || path.join(AUTH_DIR, 'link-qr.png');
const STATE_FILE = process.env.GROUP_READER_STATE_FILE || '/var/data/group-reader-forwarded.json';
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const LISTINGS_DIR = path.join(UPLOADS_DIR, 'listings');
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:3000';
const API_SECRET = process.env.API_SECRET || '';
const WATCHED = new Set(String(process.env.GROUP_READER_GROUPS || '')
  .split(',').map((s) => s.trim()).filter(Boolean));
const GROUP_NAME_TTL_MS = 6 * 60 * 60 * 1000;

if (!LIST_GROUPS) {
  const missing = [];
  if (!API_SECRET) missing.push('API_SECRET');
  if (!WATCHED.size) missing.push('GROUP_READER_GROUPS (run with --list-groups to find the JIDs)');
  if (missing.length) {
    console.error(`[group-reader] not starting — missing ${missing.join(', ')}`);
    process.exit(1);
  }
  const bad = [...WATCHED].filter((jid) => !jid.endsWith('@g.us'));
  if (bad.length) {
    console.error(`[group-reader] GROUP_READER_GROUPS must hold group JIDs (…@g.us); not one: ${bad.join(', ')}`);
    process.exit(1);
  }
}

let sock = null;
let reconnectDelay = 5_000;
const groupNames = new Map(); // jid -> { subject, at }
const store = new ForwardedStore(STATE_FILE);

async function groupName(jid) {
  const cached = groupNames.get(jid);
  if (cached && Date.now() - cached.at < GROUP_NAME_TTL_MS) return cached.subject;
  try {
    const meta = await sock.groupMetadata(jid);
    groupNames.set(jid, { subject: meta.subject, at: Date.now() });
    return meta.subject;
  } catch {
    return cached ? cached.subject : null;
  }
}

const batcher = new Batcher({
  async onFlush(batch) {
    if (!shouldForward({ text: batch.text, photoCount: batch.photos.length })) {
      console.log(`[group-reader] skipped chatter in ${batch.groupJid} (${batch.wamids.length} msg, no photo, no property + price)`);
      return;
    }
    const payload = {
      via: 'reader',
      groupJid: batch.groupJid,
      groupName: await groupName(batch.groupJid),
      posterPhone: batch.posterPhone || null,
      posterName: batch.posterName || null,
      text: batch.text,
      photos: batch.photos,
      wamids: batch.wamids,
    };
    const result = await postGroupPost(payload, { engineUrl: ENGINE_URL, apiKey: API_SECRET });
    if (result !== 'failed') store.addAll(batch.wamids);
  },
});

async function main() {
  const baileys = await import('@whiskeysockets/baileys');
  const {
    makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers,
    DisconnectReason, normalizeMessageContent, downloadMediaMessage,
  } = baileys;
  const QRCode = require('qrcode');
  const logger = require('pino')({ level: process.env.GROUP_READER_LOG_LEVEL || 'warn' });

  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
  if (!LIST_GROUPS) fs.mkdirSync(LISTINGS_DIR, { recursive: true });

  async function savePhoto(msg, image) {
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
    const name = photoFileName(msg.key.id, 0, image.mimetype);
    fs.writeFileSync(path.join(LISTINGS_DIR, name), buffer);
    return `/uploads/listings/${name}`;
  }

  function handleMessage(msg) {
    const key = msg.key || {};
    if (!isWatchedGroup(key.remoteJid, WATCHED) || key.fromMe || !key.id) return;
    if (store.has(key.id)) return;
    const author = authorOf(key);
    if (!author) return;
    const { text, image } = contentOf(normalizeMessageContent(msg.message));
    if (!text.trim() && !image) return; // reactions, stickers, voice notes, protocol messages

    const photo = image
      ? savePhoto(msg, image).catch((err) => {
        console.warn(`[group-reader] photo ${key.id} in ${key.remoteJid} not downloaded: ${err.message}`);
        return null;
      })
      : null;
    batcher.add({
      groupJid: key.remoteJid,
      author,
      messageId: key.id,
      text,
      photo,
      meta: { posterPhone: phoneOf(key), posterName: msg.pushName || null },
    });
  }

  async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const latest = await fetchLatestBaileysVersion().catch(() => ({}));
    sock = makeWASocket({
      ...(latest.version ? { version: latest.version } : {}),
      auth: state,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false, // also makes delivery receipts "inactive": no blue ticks
      // The normal (not full) history sync stays on: it carries the LID →
      // phone mappings phoneOf() needs, and Baileys warns that sessions are
      // unstable without it. Its messages arrive as 'append' and are ignored.
      syncFullHistory: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
      cachedGroupMetadata: async () => undefined,
    });
    const current = sock;

    current.ev.on('creds.update', saveCreds);

    current.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('[group-reader] Link the ANNONCES SIM: WhatsApp → Appareils connectés → Connecter un appareil, then scan:');
        console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        await QRCode.toFile(QR_PNG, qr, { width: 512 }).catch(() => {});
        console.log(`[group-reader] (same QR written to ${QR_PNG})`);
      }
      if (connection === 'open') {
        reconnectDelay = 5_000;
        fs.rmSync(QR_PNG, { force: true });
        console.log(`[group-reader] connected as ${current.user?.id || '?'}`);
        let joined = {};
        try {
          joined = await current.groupFetchAllParticipating();
        } catch (err) {
          console.warn(`[group-reader] could not list groups: ${err.message}`);
        }
        for (const [jid, meta] of Object.entries(joined)) {
          groupNames.set(jid, { subject: meta.subject, at: Date.now() });
        }
        if (LIST_GROUPS) {
          const rows = Object.values(joined).sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
          console.log(`\n${rows.length} group(s) joined by this number:\n`);
          for (const g of rows) {
            console.log(`${g.id}\t${g.subject}\t(${g.participants?.length ?? '?'} members${g.announce ? ', admin-only' : ''})`);
          }
          console.log('\nPut the JIDs to read, comma-separated, in GROUP_READER_GROUPS.');
          current.end(undefined);
          process.exit(0);
        }
        for (const jid of WATCHED) {
          if (Object.keys(joined).length && !joined[jid]) {
            console.warn(`[group-reader] WARNING ${jid} is in GROUP_READER_GROUPS but this number is not a member`);
          }
        }
        console.log(`[group-reader] reading ${WATCHED.size} group(s): ${[...WATCHED].map((j) => groupNames.get(j)?.subject || j).join(' | ')}`);
      }
      if (connection === 'close') {
        if (current !== sock) return;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.error('[group-reader] ************************************************************');
          console.error('[group-reader] LOGGED OUT — the annonces SIM unlinked this device, or WhatsApp');
          console.error('[group-reader] banned/logged it out. Group listings are NOT being read.');
          console.error(`[group-reader] To relink: stop this app, delete ${AUTH_DIR}, run it in a terminal and scan the QR.`);
          console.error('[group-reader] ************************************************************');
          await batcher.flushAll().catch(() => {});
          process.exit(2);
        }
        if (code === DisconnectReason.restartRequired) {
          console.log('[group-reader] pairing done, reconnecting');
          connect().catch(onFatal);
          return;
        }
        const wait = code === DisconnectReason.connectionReplaced ? 60_000 : reconnectDelay;
        console.warn(`[group-reader] connection closed (${code ?? lastDisconnect?.error?.message ?? 'unknown'}), reconnecting in ${wait / 1000}s`
          + (code === DisconnectReason.connectionReplaced ? ' — ANOTHER reader instance is logged in with the same auth?' : ''));
        reconnectDelay = Math.min(reconnectDelay * 2, 5 * 60_000);
        setTimeout(() => connect().catch(onFatal), wait);
      }
    });

    current.ev.on('groups.update', (updates) => {
      for (const u of updates) {
        if (u.id && u.subject) groupNames.set(u.id, { subject: u.subject, at: Date.now() });
      }
    });

    // 'notify' = new messages, including the backlog delivered on reconnect;
    // 'append' is history sync, which is never read.
    current.ev.on('messages.upsert', ({ messages, type }) => {
      if (LIST_GROUPS || type !== 'notify') return;
      for (const msg of messages) {
        try { handleMessage(msg); } catch (err) { console.error(`[group-reader] message ${msg.key?.id}: ${err.stack || err}`); }
      }
    });
  }

  await connect();
}

function onFatal(err) {
  console.error(`[group-reader] fatal: ${err.stack || err}`);
  process.exit(1);
}

async function shutdown(signal) {
  console.log(`[group-reader] ${signal}: flushing ${batcher.size} open batch(es)`);
  await Promise.race([batcher.flushAll(), new Promise((r) => setTimeout(r, 25_000))]).catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error(`[group-reader] unhandled rejection: ${err?.stack || err}`));

main().catch(onFatal);
