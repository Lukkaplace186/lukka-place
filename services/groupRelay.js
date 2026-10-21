/**
 * Listings captured from WhatsApp GROUPS.
 *
 * The Cloud API never delivers group messages to this engine's webhook — not
 * even for the business number while it sits in the groups through the
 * WhatsApp Business app (measured 2026-10-21: 607 inbound messages, none from a
 * group). Most Kinshasa listings are posted in brokers' admin-only groups, so a
 * second number, a plain WhatsApp member of those groups, brings them in:
 *
 *  - via 'relay':  staff forward group posts from that number to the intake
 *    number. RELAY_NUMBERS lists it; routes/webhook.js hands its bursts here
 *    before any draft, onboarding or quick-reply logic.
 *  - via 'reader': group-reader/ (a linked device of that number) posts each
 *    group post to POST /internal/group-posts with the author's real number.
 *
 * One path for both. A group post is stored as its own listing and sent to
 * the approval queue at once — nobody is asked for "OK", nobody is onboarded,
 * nothing is ever sent to the poster or into a group. The relay phone (our
 * staff) gets one receipt per burst. Duplicates — the same post forwarded from
 * three groups — are dropped by text and photo fingerprints. The moderator sees
 * where it came from in a console note (`console_admin_notes`).
 *
 * The listing's wa_id is the poster's number when known, so a broker who later
 * verifies that number is linked to their listings by the usual claim; until
 * then nothing is attributed (same phone_verified_at gate as every write path).
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const { normaliseOpsNumber, opsNumber } = require('./opsDesk');
const { standsAloneAsListing } = require('./listingBoundary');

const SOURCE = 'whatsapp-group';
const FINGERPRINT_DAYS = 30;
/** Below this many folded characters a text says too little to be called the same post. */
const MIN_TEXT_FINGERPRINT = 40;

db.db.exec(`
  CREATE TABLE IF NOT EXISTS listing_fingerprints (
    kind       TEXT NOT NULL,
    hash       TEXT NOT NULL,
    listing_id INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, hash)
  );
`);

function relayNumbers() {
  return String(process.env.RELAY_NUMBERS || '')
    .split(/[,;\s]+/)
    .map(normaliseOpsNumber)
    .filter(Boolean);
}

function isRelaySender(from) {
  const n = normaliseOpsNumber(from);
  return Boolean(n) && relayNumbers().includes(n);
}

/** Our own numbers, never taken for a poster's. */
function ownNumbers() {
  return new Set([
    ...relayNumbers(),
    opsNumber(),
    normaliseOpsNumber(process.env.BUSINESS_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER),
    '243976321848',
    '243846962654',
  ].filter(Boolean));
}

function fold(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** A line staff type before a batch: "Agent : 0999 384 203". */
const AGENT_LINE = /^\s*(?:agent|contact|tel|tél|téléphone|telephone|numero|numéro|whatsapp)\s*[:\-–]?\s*(\+?[\d][\d\s.()-]{6,})\s*$/i;

/** DRC mobile numbers written in a post: +243 999 384 203, 0999384203, 243 81 234 5678. */
const PHONE_IN_TEXT = /(?:\+|00)?243[\s.-]?\(?0?\)?[\s.-]?[89]\d(?:[\s.-]?\d){7}|\b0[89]\d(?:[\s.-]?\d){7}\b/g;

function phonesIn(text) {
  const own = ownNumbers();
  const found = [];
  for (const match of String(text || '').matchAll(PHONE_IN_TEXT)) {
    const n = normaliseOpsNumber(match[0].replace(/\(0\)/, ''));
    if (n && /^243[89]\d{8}$/.test(n) && !own.has(n) && !found.includes(n)) found.push(n);
  }
  return found;
}

function textFingerprint(text) {
  const folded = fold(text).replace(/[^a-z0-9]+/g, '');
  if (folded.length < MIN_TEXT_FINGERPRINT) return null;
  return crypto.createHash('sha256').update(folded).digest('hex');
}

function photoFingerprint(image) {
  const bytes = image?.data ? Buffer.from(image.data, 'base64') : null;
  return bytes && bytes.length ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
}

function findFingerprint(kind, hash) {
  if (!hash) return null;
  const row = db.db
    .prepare(`SELECT listing_id FROM listing_fingerprints
              WHERE kind = ? AND hash = ? AND datetime(created_at) >= datetime('now', ?)`)
    .get(kind, hash, `-${FINGERPRINT_DAYS} days`);
  return row ? row.listing_id : null;
}

function recordFingerprints(listingId, { textHash, photoHashes }) {
  const upsert = db.db.prepare(
    `INSERT INTO listing_fingerprints (kind, hash, listing_id, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(kind, hash) DO UPDATE SET listing_id = excluded.listing_id, created_at = excluded.created_at`,
  );
  db.db.transaction(() => {
    if (textHash) upsert.run('text', textHash, listingId);
    for (const hash of photoHashes) if (hash) upsert.run('photo', hash, listingId);
  })();
}

/**
 * Same post seen in the last 30 days. A post with real text is judged by its
 * text alone: a broker re-posting the same photos with a new price or a new
 * description is a new fact, not a copy. Only a post with no text to compare
 * (photos alone, or a caption too short to mean anything) falls back to its
 * photos — every one of them already seen.
 */
function duplicateOf({ textHash, photoHashes }) {
  if (textHash) return findFingerprint('text', textHash);
  const hashes = photoHashes.filter(Boolean);
  if (!hashes.length) return null;
  const owners = hashes.map((hash) => findFingerprint('photo', hash));
  return owners.every(Boolean) ? owners[0] : null;
}

/**
 * Cut a relayed burst into posts. Every message with text opens a post; a
 * photo belongs to the post it arrived in, and photos sent before any text
 * belong to the first post (a forwarded post with its photos first). A
 * message that is only "Agent : 0999…" opens nothing — it names the poster
 * of the posts that follow.
 *
 * @param {Array<{text?: string, media?: Array, wamid?: string}>} messages
 * @returns {{posts: Array<{text: string, refs: Array, wamids: string[], posterPhone: string|null}>}}
 */
function splitBurst(messages) {
  const posts = [];
  const leading = { refs: [], wamids: [] };
  let posterPhone = null;

  for (const m of messages || []) {
    const text = m.text ? String(m.text).trim() : '';
    const agentLine = text && text.split('\n').length === 1 ? text.match(AGENT_LINE) : null;
    if (agentLine) {
      posterPhone = normaliseOpsNumber(agentLine[1]) || posterPhone;
      continue;
    }
    if (text) {
      posts.push({ text, refs: [], wamids: [], posterPhone });
    }
    const target = posts.length ? posts[posts.length - 1] : leading;
    target.refs.push(...(m.media || []));
    if (m.wamid) target.wamids.push(m.wamid);
  }

  if (posts.length) {
    posts[0].refs.unshift(...leading.refs);
    posts[0].wamids.unshift(...leading.wamids);
  } else if (leading.refs.length) {
    posts.push({ text: '', refs: leading.refs, wamids: leading.wamids, posterPhone });
  }
  return { posts };
}

function loadPhotos(photoPaths) {
  // eslint-disable-next-line global-require
  const { UPLOADS_ROOT } = require('./mediaStorage');
  const images = [];
  for (const webPath of photoPaths || []) {
    const rel = String(webPath).replace(/^\/uploads\//, '');
    const file = path.resolve(UPLOADS_ROOT, rel);
    if (!file.startsWith(path.resolve(UPLOADS_ROOT)) || !fs.existsSync(file)) continue;
    const ext = path.extname(file).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    images.push({ data: fs.readFileSync(file).toString('base64'), mimeType, path: webPath });
  }
  return images;
}

/**
 * Store one group post as a listing and send it to moderation.
 *
 * @returns {Promise<{outcome: 'stored'|'duplicate'|'not-a-listing'|'failed', listingId?: number,
 *   ids?: number[], published?: boolean, reason?: string}>}
 */
async function ingestPost(post, { via, relayFrom, groupName, groupJid, label }) {
  // eslint-disable-next-line global-require
  const { parseMessage } = require('./openai');
  // eslint-disable-next-line global-require
  const { inferListingLocation } = require('./locations');
  // eslint-disable-next-line global-require
  const { persistImages } = require('./mediaStorage');

  const text = String(post.text || '').trim();
  const images = post.images || [];
  const videos = post.videos || [];
  if (!text && !images.length && !videos.length) return { outcome: 'not-a-listing', reason: 'empty' };
  // Nothing for the model to read (it does not watch videos): not a listing.
  if (!text && !images.length) return { outcome: 'not-a-listing', reason: 'video-only' };

  const fingerprints = { textHash: textFingerprint(text), photoHashes: images.map(photoFingerprint) };
  const duplicate = duplicateOf(fingerprints);
  if (duplicate) {
    console.log(`[group-capture] ${label}: same post as listing #${duplicate} — not stored again`);
    return { outcome: 'duplicate', listingId: duplicate };
  }
  for (const wamid of post.wamids || []) {
    const already = db.findByWamid(wamid);
    if (already) return { outcome: 'duplicate', listingId: already.id };
  }

  const posterPhone = normaliseOpsNumber(post.posterPhone) || phonesIn(text)[0] || null;
  const waId = posterPhone || normaliseOpsNumber(relayFrom) || 'group';

  let parsed;
  try {
    parsed = await parseMessage(text || null, { senderPhone: posterPhone || undefined, images });
  } catch (err) {
    console.error(`[group-capture] ${label}: extraction failed: ${err.message}`);
    return { outcome: 'failed', reason: 'extraction' };
  }
  const extracted = parsed.extracted_data;

  // A group post is an offer by construction when it reads like one or comes
  // with its photos; only chatter ("Bonjour à tous") is let go.
  if (!extracted.is_listing && !standsAloneAsListing(text) && !((images.length || videos.length) && text)) {
    console.log(`[group-capture] ${label}: not a listing (intent ${extracted.intent}) — skipped`);
    return { outcome: 'not-a-listing', reason: extracted.intent || 'other' };
  }

  const located = inferListingLocation({
    commune: extracted.commune, quartier: extracted.quartier, reference: extracted.reference, city: extracted.city,
  });
  extracted.city = located.city;
  if (located.commune) extracted.commune = located.commune;
  if (located.quartier) extracted.quartier = located.quartier;
  if (located.communeInferredFrom) extracted.commune_inferred_from = located.communeInferredFrom;

  Object.assign(extracted, {
    is_listing: true,
    is_correction: false,
    is_confirmed: false,
    source: SOURCE,
    source_via: via,
    group_name: groupName || null,
    group_jid: groupJid || null,
    poster_phone: posterPhone,
    poster_name: post.posterName || null,
    relay_from: via === 'relay' ? normaliseOpsNumber(relayFrom) : null,
  });

  const primary = (post.wamids || [])[0] || `grp_${fingerprints.textHash || crypto.randomUUID()}`;
  let photos = images.filter((image) => image.path).map((image) => image.path);
  const fresh = images.filter((image) => !image.path);
  if (fresh.length) photos = photos.concat(persistImages(fresh, primary));

  const { id, duplicate: raced } = db.insertListing(extracted, waId, {
    wamid: primary,
    groupWamids: post.wamids || [],
    agentName: post.posterName || groupName || null,
    rawText: text,
    photos,
    videos,
  });
  if (raced) return { outcome: 'duplicate', listingId: id };
  recordFingerprints(id, fingerprints);

  if (!photos.length && !videos.length) {
    // The photo-or-video rule holds on every publish path: kept as a draft.
    console.log(`[group-capture] ${label}: listing #${id} stored without a photo or video — not sent to moderation`);
    return { outcome: 'stored', listingId: id, ids: [id], published: false };
  }
  const { ids } = db.expandAndPublishListing(id);
  console.log(`[group-capture] ${label}: listing #${id} sent to moderation (${via}${groupName ? `, ${groupName}` : ''})`);
  return { outcome: 'stored', listingId: id, ids, published: true };
}

/**
 * The relay path: one burst forwarded by staff.
 *
 * @param {Object} input
 * @param {string} input.from            The relay number.
 * @param {Array}  input.messages        The burst's normalised messages.
 * @param {Function} input.download      (refs) => Promise<images> — the webhook's downloader.
 * @param {Function} [input.downloadVideos] (refs) => Promise<string[]> — stores videos, returns web paths.
 * @param {string} [input.replyToMessageId]
 * @param {Function} [input.send]        (to, text, opts) — defaults to chakra.
 */
async function handleRelayBurst({ from, messages, download, downloadVideos, replyToMessageId, send }) {
  // eslint-disable-next-line global-require
  const { isVideoMime } = require('./listingMedia');
  const { posts } = splitBurst(messages);
  const label = `relay ${from}`;
  const results = [];
  for (const post of posts) {
    const imageRefs = post.refs.filter((ref) => !/pdf|audio|ogg|opus/i.test(ref.mimeType || '') && !isVideoMime(ref.mimeType));
    const videoRefs = post.refs.filter((ref) => isVideoMime(ref.mimeType));
    // eslint-disable-next-line no-await-in-loop
    const images = imageRefs.length ? await download(imageRefs) : [];
    // eslint-disable-next-line no-await-in-loop
    const videos = videoRefs.length && downloadVideos ? await downloadVideos(videoRefs) : [];
    // eslint-disable-next-line no-await-in-loop
    results.push(await ingestPost({ ...post, images, videos }, { via: 'relay', relayFrom: from, label }));
  }

  const reply = relayReceipt(results);
  if (reply) {
    // eslint-disable-next-line global-require
    const sender = send || require('./chakra').sendWhatsAppMessage;
    try {
      await sender(from, reply, { replyToMessageId });
    } catch (err) {
      console.error(`[group-capture] receipt to relay ${from} failed: ${err.message}`);
    }
  }
  return { handled: true, results };
}

/** The reader path: one post read in a group by group-reader/. Sends nothing. */
async function handleReaderPost({ groupJid, groupName, posterPhone, posterName, text, photos, wamids }) {
  db.touchEngineMarker('group_reader_ingest');
  const images = loadPhotos(photos);
  const result = await ingestPost(
    { text, images, wamids: (wamids || []).map(String), posterPhone, posterName },
    { via: 'reader', groupName, groupJid, label: `reader ${groupName || groupJid || ''}`.trim() },
  );
  return result;
}

function relayReceipt(results) {
  // eslint-disable-next-line global-require
  const listingCard = require('./listingCard');
  const sent = [];
  const drafts = [];
  const duplicates = [];
  let failed = 0;
  for (const r of results) {
    if (r.outcome === 'stored') {
      const rows = (r.ids || [r.listingId]).map((id) => db.getListing(id)).filter(Boolean);
      (r.published ? sent : drafts).push(...rows);
    } else if (r.outcome === 'duplicate') {
      duplicates.push(r.listingId);
    } else if (r.outcome === 'failed') {
      failed += 1;
    }
  }
  if (!sent.length && !drafts.length && !duplicates.length && !failed) return null;
  const lines = [];
  if (sent.length) {
    lines.push(`✅ *${sent.length} annonce${sent.length > 1 ? 's' : ''} envoyée${sent.length > 1 ? 's' : ''} en modération*`);
    sent.forEach((row, i) => lines.push(`${i + 1}. ${listingCard.listingSummaryLine(row)} (n° ${row.id})`));
  }
  if (drafts.length) {
    lines.push(`📷 Sans photo ni vidéo, gardée${drafts.length > 1 ? 's' : ''} en brouillon : ${drafts.map((row) => `n° ${row.id}`).join(', ')} — transférez ses photos ou sa vidéo avec le texte.`);
  }
  if (duplicates.length) {
    lines.push(`↩️ Déjà reçue${duplicates.length > 1 ? 's' : ''} : ${[...new Set(duplicates)].map((id) => `n° ${id}`).join(', ')}`);
  }
  if (failed) lines.push(`⚠️ ${failed} annonce${failed > 1 ? 's' : ''} non lue${failed > 1 ? 's' : ''} — renvoyez-la${failed > 1 ? 's' : ''} dans quelques minutes.`);
  return lines.join('\n');
}

function formatPhone(digits) {
  return digits ? `+${String(digits).replace(/^(\d{3})(\d{3})(\d{3})(\d+)$/, '$1 $2 $3 $4')}` : null;
}

/** The moderator's context, written once at the first Postgres sync (db.publishListing). */
function sourceNoteBody(row) {
  const p = row?.parsed_json || {};
  const lines = [
    p.group_name ? `Capturée dans le groupe WhatsApp « ${p.group_name} ».` : 'Capturée dans un groupe WhatsApp.',
    p.poster_phone
      ? `Publiée par ${p.poster_name ? `${p.poster_name}, ` : ''}${formatPhone(p.poster_phone)}.`
      : `Numéro de l'auteur inconnu${p.poster_name ? ` (${p.poster_name})` : ''} : transfert sans numéro.`,
    p.source_via === 'reader' ? 'Lue automatiquement par le lecteur de groupes.' : `Transmise par le relais ${formatPhone(p.relay_from) || ''}.`.trim(),
    "Avant de valider : si l'agent a un compte, l'attribuer depuis cette page. Son numéro n'est pas vérifié et n'apparaît pas sur l'annonce.",
  ];
  return lines.join('\n');
}

async function addSourceNote(row, remotePropertyId, { pool = null } = {}) {
  if (row?.parsed_json?.source !== SOURCE || !remotePropertyId) return false;
  // eslint-disable-next-line global-require
  const postgres = require('./postgres');
  if (!pool && !postgres.isConfigured()) return false;
  try {
    await (pool || postgres.getPool()).query(
      `INSERT INTO console_admin_notes (entity_type, entity_id, admin_user_id, actor_label, body)
       VALUES ('listing', $1, NULL, 'Capture groupe WhatsApp', $2)`,
      [String(remotePropertyId), sourceNoteBody(row)],
    );
    return true;
  } catch (err) {
    console.warn(`[group-capture] source note for property #${remotePropertyId} not written: ${err.message}`);
    return false;
  }
}

function isGroupCapture(row) {
  return row?.parsed_json?.source === SOURCE;
}

module.exports = {
  SOURCE,
  isRelaySender,
  relayNumbers,
  splitBurst,
  phonesIn,
  textFingerprint,
  handleRelayBurst,
  handleReaderPost,
  ingestPost,
  relayReceipt,
  sourceNoteBody,
  addSourceNote,
  isGroupCapture,
};
