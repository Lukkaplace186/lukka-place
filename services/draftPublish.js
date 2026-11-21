/**
 * services/draftPublish.js
 *
 * The one gate every way of confirming a WhatsApp draft goes through
 * (2026-11-21). Before this there were four publish paths with four different
 * sets of checks: the typed "OK" and the 3-hour auto-submit applied photo,
 * quota, re-send guard and multi-unit expansion; "c'est bon, publiez" skipped
 * the quota; the onboarding answer skipped the quota, the re-send guard AND the
 * expansion, so a new agent's building went out as one listing. The new
 * "Publier" / commune buttons would have been a fifth.
 *
 * Order, each a refusal that leaves the draft pending so the agent can fix it
 * and confirm again:
 *   1. a photo or a video (services/listingMedia.js) — the most useful refusal
 *   2. the plan's listing limit (services/listingQuota.js, fails open)
 *   3. the same agent's same property already on file (services/resendGuard.js)
 * then services/db.js expandAndPublishListing: one row per unit for a
 * multi-unit building, an ordinary publish for everything else.
 *
 * Sends nothing: the caller words the answer (a WhatsApp reply, the
 * onboarding activation message). draftAutoSubmit keeps its own copy of these
 * checks because its refusals are silent retries, not answers.
 */

'use strict';

const db = require('./db');
const listingMedia = require('./listingMedia');
const listingQuota = require('./listingQuota');
const resendGuard = require('./resendGuard');

/**
 * @param {number} listingId   a pending draft
 * @param {Object} options
 * @param {string} options.sender  the confirming number (quota is counted on it)
 * @param {string} [options.text]  the confirming words ("AUTRE" releases a held re-send)
 * @returns {Promise<{outcome: 'published', ids: number[]}
 *   | {outcome: 'no_media'}
 *   | {outcome: 'quota', reply: string}
 *   | {outcome: 'held', reply: string}
 *   | {outcome: 'not_pending'}>}
 */
async function publishDraft(listingId, { sender, text = '' } = {}) {
  const draft = db.getListing(listingId);
  if (!draft || draft.status !== 'pending_confirmation') return { outcome: 'not_pending' };

  if (!listingMedia.hasVisualMedia(draft)) return { outcome: 'no_media' };

  const quota = await listingQuota.checkQuotaForSender(sender || draft.wa_id, listingQuota.listingsToPublish(draft));
  if (quota?.blocked) {
    console.log(`[quota] listing #${draft.id} NOT published — ${quota.used}/${quota.limit} used (confirmed by ${sender})`);
    return { outcome: 'quota', reply: listingQuota.limitReachedReply(quota) };
  }

  const resend = await resendGuard.gateBeforePublish(db.getListing(draft.id), text);
  if (resend.hold) return { outcome: 'held', reply: resend.reply };

  const { ids } = db.expandAndPublishListing(draft.id);
  return { outcome: 'published', ids };
}

module.exports = { publishDraft };
