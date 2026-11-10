'use strict';

/**
 * The same agent sending the same listing twice (owner decision 2026-11-10:
 * "same listing, different agent is fine; same agent, same listing is not").
 *
 * Measured the same day on production: 96 same-agent pairs of live listings
 * shared at least one identical photo. 76 of them were units of ONE message
 * (created minutes apart, different bedrooms or prices — a building's units
 * keep the building's photos by design); ~20 were real re-sends days apart
 * (#472 and #746: 20 of 20 photos, same price and bedrooms). "Same title and
 * price" was a poor signal: 55 of its 68 same-agent pairs shared no photo.
 *
 * So a draft is a RE-SEND of an earlier listing of the same sender when:
 *   - the earlier listing is live or pending (not deleted, rejected, archived
 *     or closed), and belongs to the same verified agent or came from the
 *     same WhatsApp number;
 *   - same transaction (rent / sale);
 *   - same bedroom count, or either one unstated (a building's other unit
 *     with its own bedroom count is NOT a re-send);
 *   - and at least one identical photo (the stored object name carries the
 *     photo's content fingerprint: services/supabaseStorage.js contentHash,
 *     web lib/listingStorage.js) or the identical message text.
 *
 * What happens: the draft is not published; the agent is told which listing
 * it repeats and can reply AUTRE when it really is another property
 * (routes/webhook.js, services/draftAutoSubmit.js). Fails open: if Postgres
 * cannot be asked, the draft publishes as before.
 *
 * Known limit: a photo re-sent from a phone gallery may be recompressed by
 * WhatsApp, which changes its fingerprint; the identical-text check still
 * catches a pasted re-send.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const postgres = require('./postgres');

const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const PUBLIC_BASE = String(process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** Below this many folded characters a text says too little to be called the same listing. */
const MIN_TEXT_LENGTH = 40;

/** The content fingerprint inside a stored photo's name: whatsapp_<13 hex> or agent_<13 hex>. */
const FINGERPRINT_IN_NAME = /(?:whatsapp|agent)_([0-9a-f]{13})/;

function fingerprintOfStoredPhoto(src) {
  const match = FINGERPRINT_IN_NAME.exec(String(src || ''));
  return match ? match[1] : null;
}

/** Same as supabaseStorage.contentHash, so a local file and its stored copy agree. */
function fingerprintOfBytes(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex').slice(0, 13);
}

function fingerprintOfLocalPhoto(webPath) {
  try {
    const local = path.join(UPLOADS_ROOT, String(webPath).replace(/^\/?uploads\//, ''));
    return fingerprintOfBytes(fs.readFileSync(local));
  } catch {
    return null;
  }
}

function foldText(text) {
  const folded = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return folded.length >= MIN_TEXT_LENGTH ? folded : null;
}

function purposeOf(transactionType) {
  return transactionType === 'vente' ? 'sale' : 'rent';
}

/** Equal, or either one unstated. */
function bedsCompatible(a, b) {
  if (a === null || a === undefined || a === '' || b === null || b === undefined || b === '') return true;
  return Number(a) === Number(b);
}

/**
 * Pure decision over already-loaded data, unit-tested in verify-pipeline §95.
 *
 * @param {{photoFingerprints: string[], text: string|null, purpose: string, beds: number|null}} draft
 * @param {Array<{id: number, purpose: string, beds: number|null, photoFingerprints: string[], text: string|null, live: boolean, title: string|null}>} candidates
 * @returns {null | {propertyId: number, live: boolean, sharedPhotos: number, sameText: boolean, title: string|null}}
 */
function pickResend(draft, candidates) {
  const draftPhotos = new Set((draft.photoFingerprints || []).filter(Boolean));
  const draftText = draft.text ? foldText(draft.text) : null;
  let best = null;
  for (const candidate of candidates) {
    if (candidate.purpose !== draft.purpose) continue;
    if (!bedsCompatible(draft.beds, candidate.beds)) continue;
    const sharedPhotos = (candidate.photoFingerprints || []).filter((fp) => fp && draftPhotos.has(fp)).length;
    const sameText = Boolean(draftText) && foldText(candidate.text) === draftText;
    if (sharedPhotos === 0 && !sameText) continue;
    const score = sharedPhotos + (sameText ? 100 : 0);
    if (!best || score > best.score || (score === best.score && candidate.id > best.propertyId)) {
      best = { propertyId: candidate.id, live: candidate.live, sharedPhotos, sameText, title: candidate.title || null, score };
    }
  }
  if (!best) return null;
  const { score, ...match } = best;
  return match;
}

/**
 * The live/pending listings this draft could repeat, with their fingerprints.
 * Same verified agent (agents.id) OR published from the same WhatsApp number.
 */
async function loadCandidates(listing, agentId) {
  const fromSameNumber = db.db
    .prepare(
      `SELECT remote_property_id, raw_text FROM listings
       WHERE wa_id = ? AND id <> ? AND remote_property_id IS NOT NULL`,
    )
    .all(listing.wa_id, listing.id);
  const textByProperty = new Map(fromSameNumber.map((row) => [Number(row.remote_property_id), row.raw_text]));
  const ids = [...textByProperty.keys()];
  if (!agentId && ids.length === 0) return [];

  const { rows } = await postgres.getPool().query(
    `SELECT p.id, p.purpose, p.beds, p.approve_status, p.featured_image,
            pc.title, pc.description,
            COALESCE((SELECT array_agg(si.image) FROM property_slider_images si WHERE si.property_id = p.id), ARRAY[]::text[]) AS gallery
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
     WHERE (p.agent_id = $1 OR p.id = ANY($2::bigint[]))
       AND p.deleted_at IS NULL AND p.approve_status IN (0, 1) AND p.status = 1
       AND p.listing_status IS DISTINCT FROM 'closed'`,
    [agentId || null, ids],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    purpose: row.purpose,
    beds: row.beds,
    live: Number(row.approve_status) === 1,
    title: row.title,
    text: textByProperty.get(Number(row.id)) || null,
    photoFingerprints: [row.featured_image, ...(row.gallery || [])].map(fingerprintOfStoredPhoto).filter(Boolean),
  }));
}

/**
 * Does this draft repeat one of its sender's live or pending listings?
 * Never throws: any failure is "no", so a publish is never blocked by an outage.
 */
async function findOwnResend(listing, { identify = defaultIdentify, candidates: loader = loadCandidates } = {}) {
  try {
    if (!listing) return null;
    if (loader === loadCandidates && !postgres.isConfigured()) return null;
    const photos = Array.isArray(listing.photos) ? listing.photos : [];
    const draft = {
      photoFingerprints: photos.map(fingerprintOfLocalPhoto).filter(Boolean),
      text: listing.raw_text || null,
      purpose: purposeOf(listing.transaction_type),
      beds: listing.bedrooms ?? null,
    };
    if (draft.photoFingerprints.length === 0 && !foldText(draft.text)) return null;
    const identity = await identify(listing.wa_id);
    const found = await loader(listing, identity?.registered ? identity.agentId : null);
    return pickResend(draft, found);
  } catch (err) {
    console.warn(`[resend] check failed for listing #${listing?.id}: ${err.message}`);
    return null;
  }
}

function defaultIdentify(waId) {
  return require('./agentOnboarding').identifySender(waId);
}

/** "AUTRE" (or "c'est un autre bien") answers the re-send question. */
function isOtherReply(text) {
  return /^\s*(?:c['’]?\s*est\s+)?(?:un\s+)?autre(?:\s+bien)?\s*[.!]*\s*$/i.test(String(text || ''));
}

function heldAsResend(listing) {
  const parsed = listing?.parsed_json || {};
  return Boolean(parsed.resend_of) && !parsed.resend_cleared;
}

function stamp(listingId, fields) {
  for (const [key, value] of Object.entries(fields)) {
    db.db
      .prepare(`UPDATE listings SET parsed_json = json_set(COALESCE(parsed_json, '{}'), '$.' || @key, @value) WHERE id = @id`)
      .run({ id: listingId, key, value });
  }
}

function markResend(listingId, match) {
  stamp(listingId, { resend_of: match.propertyId, resend_checked_at: new Date().toISOString() });
}

function clearResend(listingId) {
  stamp(listingId, { resend_cleared: new Date().toISOString() });
}

/** What the agent reads. French, like every agent message. */
function resendReply(match) {
  const where = match.live
    ? `en ligne : ${PUBLIC_BASE}/listings/${match.propertyId}`
    : 'en cours de vérification par notre équipe';
  const why = match.sameText
    ? 'le même texte'
    : `${match.sharedPhotos} photo${match.sharedPhotos > 1 ? 's' : ''} identique${match.sharedPhotos > 1 ? 's' : ''}`;
  return [
    `Vous avez déjà publié ce bien : *annonce n° ${match.propertyId}* (${why}), ${where}.`,
    '',
    'Nous ne publions pas deux fois le même bien. Pour changer le prix ou les photos, modifiez l’annonce existante dans votre espace :',
    `${PUBLIC_BASE}/compte/agent/biens`,
    '',
    'Si c’est un *autre bien*, répondez *AUTRE* et nous l’envoyons en vérification.',
  ].join('\n');
}

/**
 * The gate every publish path runs right before expandAndPublishListing.
 *  - "AUTRE" on a held draft clears it and lets it through;
 *  - a draft already cleared goes through;
 *  - otherwise, a re-send is held: { hold: true, reply }.
 */
async function gateBeforePublish(listing, text, options) {
  const parsed = listing?.parsed_json || {};
  if (parsed.resend_cleared) return { hold: false };
  if (parsed.resend_of && isOtherReply(text)) {
    clearResend(listing.id);
    console.log(`[resend] listing #${listing.id}: agent says it is another property than #${parsed.resend_of} — released`);
    return { hold: false };
  }
  // Through module.exports so verify-pipeline can stand in for Postgres.
  const match = await module.exports.findOwnResend(listing, options);
  if (!match) return { hold: false };
  markResend(listing.id, match);
  console.log(
    `[resend] listing #${listing.id} from ${listing.wa_id} held — repeats #${match.propertyId} ` +
      `(${match.sharedPhotos} photo(s)${match.sameText ? ', same text' : ''})`,
  );
  return { hold: true, match, reply: resendReply(match) };
}

module.exports = {
  MIN_TEXT_LENGTH,
  fingerprintOfStoredPhoto,
  fingerprintOfBytes,
  foldText,
  bedsCompatible,
  pickResend,
  findOwnResend,
  isOtherReply,
  heldAsResend,
  markResend,
  clearResend,
  resendReply,
  gateBeforePublish,
};
