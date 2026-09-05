/**
 * routes/webhook.js
 *
 * Inbound webhook for Chakra Chat.
 *
 * Pipeline: Chakra payload -> services/openai.js -> services/db.js -> services/chakra.js
 *
 * Mounted at POST /webhook by index.js.
 */

const crypto = require('crypto');
const express = require('express');

const { parseMessage } = require('../services/openai');
const {
  insertListing,
  findByWamid,
  findLatestPendingListing,
  publishListing,
  applyListingCorrection,
  getListing,
} = require('../services/db');
const chakra = require('../services/chakra');
const { persistImages } = require('../services/mediaStorage');
const { resolveCommune, resolveQuartier } = require('../services/locations');
const { handleBuyerMessage } = require('../services/buyerConversation');
const onboarding = require('../services/agentOnboarding');

const router = express.Router();

// HMAC-SHA256 webhook verification (apidocs.chakrahq.com/doc-919167): Chakra
// signs every delivery with the team's "HMAC secret" (set in their dashboard
// under Admin > Team > Secrets) over the raw request body, sent as
// `X-Chakra-Signature-256` — hex-encoded, no 'sha256=' prefix (unlike Meta's
// own scheme, which index.js's /webhook/meta path uses).
//
// Fails closed like the legacy path: with no secret configured, every request
// is rejected unless ALLOW_UNSIGNED_WEBHOOKS=true is set explicitly for local
// testing — a missing secret in production is a misconfiguration, not a
// reason to start trusting unauthenticated traffic.
const WEBHOOK_HMAC_SECRET = process.env.CHAKRA_WEBHOOK_HMAC_SECRET;
const ALLOW_UNSIGNED_WEBHOOKS = process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true';

/** Constant-time compare; a length mismatch is already a mismatch. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyWebhookSecret(req, res, next) {
  if (!WEBHOOK_HMAC_SECRET) {
    if (ALLOW_UNSIGNED_WEBHOOKS) {
      console.warn(
        '[chakra] CHAKRA_WEBHOOK_HMAC_SECRET unset — skipping verification (ALLOW_UNSIGNED_WEBHOOKS=true)',
      );
      return next();
    }
    console.error('[chakra] CHAKRA_WEBHOOK_HMAC_SECRET is not set — rejecting webhook');
    return res.sendStatus(500);
  }

  const signature = req.get('x-chakra-signature-256');
  if (!signature) {
    console.warn('[chakra] rejected — no X-Chakra-Signature-256 header');
    return res.sendStatus(401);
  }

  // `verify` only runs when body-parser handles the request, so an absent
  // rawBody means there was nothing signable to begin with.
  if (!req.rawBody?.length) {
    console.warn('[chakra] rejected — empty or unparsed body');
    return res.sendStatus(401);
  }

  const expected = crypto.createHmac('sha256', WEBHOOK_HMAC_SECRET).update(req.rawBody).digest('hex');

  if (!safeEqual(signature, expected)) {
    console.warn('[chakra] rejected — signature mismatch');
    return res.sendStatus(401);
  }

  return next();
}

/**
 * Normalise an inbound payload into `{ wamid, from, text, type }` entries.
 *
 * Chakra's send API is a pass-through of Meta's, so its inbound webhook is
 * expected to be Meta-shaped too (entry[].changes[].value.messages[]). That is
 * the primary path. The flatter shapes are tolerated as a fallback because the
 * inbound contract is not published — verify against a real Chakra delivery and
 * delete whichever branches turn out to be dead.
 */
/**
 * Normalise one WhatsApp message object (Meta's shape, which Chakra passes
 * through verbatim inside its own envelope).
 *
 * @param {Object} message      The message object itself.
 * @param {Array}  [contacts]   Sibling `contacts` array, for the profile name.
 * @param {string} [fallbackWamid] Envelope-level id, used if the message has none.
 * @returns {Object|null} Normalised message, or null if there is no sender.
 */
function normaliseMessage(message, contacts = [], fallbackWamid = null) {
  if (!message || typeof message !== 'object') return null;

  const list = Array.isArray(contacts) ? contacts : [];
  const from = message.from || message.sender || message.msisdn || list[0]?.wa_id;
  if (!from) return null;

  const text =
    message.text?.body ??
    (typeof message.text === 'string' ? message.text : undefined) ??
    message.image?.caption ??
    message.caption ??
    message.body ??
    null;

  // Media references: an id needs a download hop, a url can be fetched directly.
  // Real Chakra payloads carry BOTH for images, so keep the pair together and let
  // the download step decide which route works.
  const media = [];
  const candidates = [
    message.image,
    message.media,
    message.attachment,
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    ...(Array.isArray(message.media) ? message.media : []),
  ].filter((entry) => entry && typeof entry === 'object');

  for (const entry of candidates) {
    const id = entry.id ? String(entry.id) : null;
    const url = typeof (entry.url || entry.link) === 'string' ? entry.url || entry.link : null;
    if (id || url) {
      media.push({ id, url, mimeType: entry.mime_type || entry.mimeType || null });
    }
  }

  const wamid = message.id || message.message_id || fallbackWamid || null;

  const profile =
    list.find((c) => c.wa_id === from)?.profile?.name ??
    list[0]?.profile?.name ??
    message.profile_name ??
    message.name;

  return {
    wamid: wamid ? String(wamid) : null,
    from: String(from).replace(/^\+/, ''),
    type: message.type || (media.length ? 'image' : 'text'),
    text: text === null || text === undefined ? null : String(text),
    media,
    profileName: profile,
  };
}

/** A message is worth processing if it has text, an image, or both. */
function isUsable(message) {
  return Boolean(message && (message.text?.trim() || message.media.length));
}

/**
 * A real WhatsApp message we recognise but deliberately don't parse — worth a
 * reply telling the agent so, rather than a silent drop (previously logged as
 * an "UNRECOGNISED payload" with no feedback to the sender at all).
 */
const UNSUPPORTED_MESSAGE_TYPES = new Set([
  'video', 'audio', 'voice', 'document', 'sticker', 'location', 'contacts',
]);

function isUnsupportedType(message) {
  return Boolean(message && !isUsable(message) && UNSUPPORTED_MESSAGE_TYPES.has(message.type));
}

function extractInboundMessages(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const collected = [];

  // Shape A — Meta's webhook envelope (also used by POST /webhook/meta).
  if (Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};
        // Delivery/read receipts arrive in the same envelope with no `messages`.
        for (const message of value.messages || []) {
          const normalised = normaliseMessage(message, value.contacts);
          if (isUsable(normalised) || isUnsupportedType(normalised)) collected.push(normalised);
        }
      }
    }
    if (collected.length) return collected;
  }

  // Shape B — Chakra's event envelope. Confirmed live shape:
  //   { event: 'message',
  //     payload: { messageId, externalId, wabaId, timestamp,
  //                message: { from, id, type, text: { body } | image: {…} },
  //                contacts: [{ wa_id, profile: { name } }] } }
  const payload = body.payload;
  if (payload && typeof payload === 'object') {
    const envelopeWamid = payload.messageId || payload.message_id || payload.externalId || body.id;

    // Some events wrap a single message, others an array.
    const inner = Array.isArray(payload.messages)
      ? payload.messages
      : [payload.message].filter(Boolean);

    for (const message of inner) {
      const normalised = normaliseMessage(message, payload.contacts, envelopeWamid);
      if (isUsable(normalised) || isUnsupportedType(normalised)) collected.push(normalised);
    }

    // Fallback for a flatter variant where the fields sit on `payload` itself
    // (e.g. { payload: { contact: { msisdn }, body } }).
    if (collected.length === 0) {
      const contact = payload.contact || {};
      const flattened = normaliseMessage(
        {
          from: contact.msisdn || contact.phone || contact.wa_id || payload.from || payload.msisdn,
          id: payload.id,
          type: payload.type,
          text: payload.body ?? payload.text,
          media: payload.media || payload.image,
          name: contact.name || contact.profile_name,
        },
        payload.contacts,
        envelopeWamid,
      );
      if (isUsable(flattened) || isUnsupportedType(flattened)) collected.push(flattened);
    }

    if (collected.length) {
      for (const message of collected) {
        if (!message.wamid) {
          // Dedupe, burst grouping and the in-flight guard all key on this.
          console.warn(
            `[chakra] message from ${message.from} has no id — deduplication is disabled for it`,
          );
        }
      }
      return collected;
    }
  }

  // Shape C — a bare flat message object.
  const flat = normaliseMessage(body.message || body.data || body, body.contacts, body.id);
  if (isUsable(flat) || isUnsupportedType(flat)) collected.push(flat);

  return collected;
}

/**
 * Fetch the bytes for each media reference.
 *
 * Tries the URL embedded in the webhook first — one hop, and independent of the
 * media endpoint path, which Chakra does not document — then falls back to the
 * media-id route.
 *
 * A failed download is logged and skipped rather than fatal: if the agent also
 * typed a caption, extracting from the text alone still produces a usable
 * listing, which beats dropping the message entirely.
 */
async function downloadImages(refs, label) {
  // Each ref's own try/catch already logs-and-skips on failure rather than
  // throwing, so running them concurrently (instead of the previous
  // sequential for-await loop) is safe: one slow/failed image no longer
  // adds its latency to every image behind it in the list.
  const results = await Promise.all(
    refs.map(async (ref) => {
      let image = null;

      if (ref.url) {
        try {
          image = await chakra.downloadMediaByUrl(ref.url, ref.mimeType);
        } catch (err) {
          console.warn(
            `[chakra] ${label}: direct media URL failed (${err.message})` +
              (ref.id ? ' — retrying via media id' : ''),
          );
        }
      }

      if (!image && ref.id) {
        try {
          image = await chakra.downloadMedia(ref.id);
        } catch (err) {
          console.warn(`[chakra] media ${ref.id} for ${label} could not be downloaded: ${err.message}`);
        }
      }

      if (image) {
        console.log(
          `[chakra] media ${ref.id || 'url'} downloaded (${image.mimeType}, ` +
            `${Math.max(1, Math.round(image.sizeBytes / 1024))} KB)`,
        );
      }

      return image;
    }),
  );

  return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Multi-turn confirmation
//
// A saved listing starts 'pending_confirmation'. The agent's next message is
// either an 'OK'/'Oui' (publish as-is, no AI call needed) or anything else,
// which is treated as a correction and merged into the same row — see
// services/db.js applyListingCorrection.
// ---------------------------------------------------------------------------

const PUBLISHED_REPLY = 'Merci ! Votre annonce est maintenant publiée et visible sur Lukka Place. 🎉';

/**
 * Sent once per new submission (see enqueueMessage), not once per message —
 * the GPT-4o extraction + image handling that follows can take a real,
 * noticeable few seconds to tens of seconds, and a WhatsApp user staring at
 * silence has no other signal that anything is happening.
 */
const ACK_REPLY = 'Message reçu, un instant pendant que nous traitons votre annonce... ⏳';

const UNSUPPORTED_MEDIA_REPLY =
  'Bonjour 👋 Pour publier une annonce, envoyez-la en *texte* ou en *photo* (avec légende). ' +
  'Les autres formats (vidéo, audio, document, position, contact) ne sont pas encore pris en charge.';

/** Short, affirmative-only phrases — deliberately narrow so a real correction
 *  that happens to mention "publier" elsewhere in a sentence isn't swallowed. */
const AFFIRMATIVE_PATTERN =
  /^(ok(ay)?|oui|d.accord|c.est bon|c.est ca|nickel|parfait|publier|publie[sz]?)[\s!.]*$/i;

/** Strip accents so "c'est bon" matches "c'est bon" and "cest bon" alike. */
function normaliseForMatch(text) {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function isAffirmative(text) {
  return Boolean(text) && AFFIRMATIVE_PATTERN.test(normaliseForMatch(text));
}

/**
 * Message ids currently being processed — see the same guard in index.js.
 * Providers retry on timeout, and a retry that arrives mid-extraction would
 * otherwise pay for a second gpt-4o call.
 */
const inFlight = new Set();

// ---------------------------------------------------------------------------
// Burst grouping
//
// WhatsApp sends every photo as its own message, so one listing with five photos
// arrives as five webhooks seconds apart. Without buffering that becomes five
// database rows, five model calls and five replies. Messages from the same
// sender are therefore collected and processed as a single listing.
//
// Read lazily so tests (and a restart-free config change) can adjust them.
// ---------------------------------------------------------------------------

/** Quiet period after the last message before a burst is considered finished. */
function groupIdleMs() {
  const value = Number.parseInt(process.env.GROUP_IDLE_MS, 10);
  return Number.isFinite(value) ? value : 8000;
}

/** Hard ceiling from the first message, so a steady trickle still gets flushed. */
function groupMaxWaitMs() {
  const value = Number.parseInt(process.env.GROUP_MAX_WAIT_MS, 10);
  return Number.isFinite(value) ? value : 45000;
}

/** sender wa_id -> { messages, idleTimer, maxTimer } */
const pendingGroups = new Map();

/**
 * Add a message to its sender's pending group, (re)arming the debounce.
 *
 * Set GROUP_IDLE_MS=0 to disable grouping and process each message on arrival.
 */
function enqueueMessage(message) {
  const idle = groupIdleMs();

  if (idle <= 0) {
    return processGroup([message]);
  }

  const key = message.from;
  let group = pendingGroups.get(key);

  if (!group) {
    group = { messages: [], idleTimer: null, maxTimer: null };
    pendingGroups.set(key, group);
    group.maxTimer = setTimeout(() => flushSender(key, 'max wait'), groupMaxWaitMs());

    // Burst-aware ack: fires once, when a brand-new group opens for this
    // sender — not per message in the burst. Two conditions, both required:
    // - No listing already awaiting this sender's 'OK' — that reply is a
    //   fast confirmation/correction (no gpt-4o call), so an extra "please
    //   wait" there would just be noise ahead of the real, near-instant reply.
    // - The message actually carries media. Enqueue time is before any
    //   classification (gpt-4o hasn't run yet), so there's no way to know
    //   here whether this will turn out to be a listing, a buyer-search
    //   message, a greeting, or — critically — a conversation currently
    //   under human handoff, where the system must stay completely silent.
    //   Gating on "has a photo" is a proxy for "this is actually a listing
    //   submission, not a fast text-only chat message": listings are
    //   submitted with photos, buyer/greeting/handoff traffic overwhelmingly
    //   isn't, and text-only extraction is fast enough not to need an ack
    //   anyway. A first version of this ack fired unconditionally and broke
    //   exactly this — sent an ack even while human-handoff silence should
    //   have suppressed any reply — caught by scripts/verify-pipeline.js.
    if (message.media?.length && !findLatestPendingListing(key)) {
      chakra.sendWhatsAppMessage(key, ACK_REPLY).catch((err) => {
        console.error(`[chakra] failed to send ack to ${key}: ${err.message}`);
      });
    }
  }

  // A retry arriving mid-burst must not be buffered twice.
  if (message.wamid && group.messages.some((m) => m.wamid === message.wamid)) {
    console.log(`[dedupe] ${message.wamid} already buffered — skipped`);
    return undefined;
  }

  group.messages.push(message);

  if (group.idleTimer) {
    clearTimeout(group.idleTimer);
  }
  group.idleTimer = setTimeout(() => flushSender(key, 'idle'), idle);

  return undefined;
}

/** Close a sender's group and hand it to the pipeline. */
function flushSender(key, reason) {
  const group = pendingGroups.get(key);
  if (!group) return;

  pendingGroups.delete(key);
  clearTimeout(group.idleTimer);
  clearTimeout(group.maxTimer);

  if (group.messages.length > 1) {
    console.log(`[group] ${key}: ${group.messages.length} messages merged (${reason})`);
  }

  processGroup(group.messages).catch((err) => {
    console.error(`[group] ${key} failed: ${err.message}`);
  });
}

/** Flush every pending group now — for shutdown and for tests. */
function flushAll() {
  for (const key of [...pendingGroups.keys()]) {
    flushSender(key, 'flushAll');
  }
}

/**
 * Run one burst of messages from a single sender through the pipeline as one
 * listing: one model call, one row, one reply.
 *
 * @param {Array<Object>} messages One or more normalised inbound messages.
 */
async function processGroup(messages) {
  if (!messages || messages.length === 0) return;

  const from = messages[0].from;
  const wamids = messages.map((m) => m.wamid).filter(Boolean);
  // The row is keyed on the first message; the rest are recorded in group_wamids
  // so a redelivery of any of them is recognised as already processed.
  const primaryWamid = wamids[0] || null;
  const label = primaryWamid || from;

  // Captions arrive spread across the burst; keep arrival order.
  const text = messages
    .map((m) => (m.text ? String(m.text).trim() : ''))
    .filter(Boolean)
    .join('\n');
  const hasText = Boolean(text);

  const mediaRefs = messages.flatMap((m) => m.media || []);
  const profileName = messages.find((m) => m.profileName)?.profileName;

  if (!hasText && mediaRefs.length === 0) {
    // Voice notes, stickers, locations: nothing to read, text or visual.
    console.log(`[chakra] ${label} has no text and no media — skipped`);
    return;
  }

  // Dedupe before any billable work: no gpt-4o call, no media download, no
  // duplicate reply. Any wamid in the burst having been seen means the whole
  // burst is a redelivery.
  for (const wamid of wamids) {
    if (inFlight.has(wamid)) {
      console.log(`[dedupe] ${wamid} already in flight — skipped`);
      return;
    }
    const already = findByWamid(wamid);
    if (already) {
      console.log(`[dedupe] ${wamid} already stored as listing #${already.id} — skipped`);
      return;
    }
  }

  wamids.forEach((wamid) => inFlight.add(wamid));

  try {
    // A listing already awaits this sender's 'OK' — settle that conversation
    // before touching gpt-4o or inserting anything new.
    const pending = findLatestPendingListing(from);

    if (pending && isAffirmative(text)) {
      publishListing(pending.id);
      await chakra.sendWhatsAppMessage(from, PUBLISHED_REPLY, {
        replyToMessageId: primaryWamid || undefined,
      });
      console.log(`[db] listing #${pending.id} published (confirmed by ${from})`);
      console.log(`[chakra] reply sent to ${from}`);
      return;
    }

    const images = mediaRefs.length ? await downloadImages(mediaRefs, label) : [];

    // Every download failed and there was no caption — nothing left to read.
    if (!hasText && images.length === 0) {
      console.warn(`[chakra] ${label}: no caption and no usable image — skipped`);
      return;
    }

    // Persist whatever survived the download so the listing keeps its photos —
    // services/openai.js only ever holds them in memory for the vision call.
    const photoPaths = images.length ? persistImages(images, label) : [];
    if (photoPaths.length) {
      console.log(`[chakra] ${label}: stored ${photoPaths.length} photo(s)`);
    }

    // Set below when an unregistered sender's listing triggers the WhatsApp
    // registration ask. Kept out here so the single send at the end of this
    // function stays the only place a reply leaves the intake path.
    let onboardingSuffix = null;

    const { extracted_data: extracted, whatsapp_reply: reply, _meta } = await parseMessage(text, {
      senderPhone: from,
      images,
    });

    console.log(
      `[openai] ${label} — listing=${extracted.is_listing} intent=${extracted.intent} ` +
        `confidence=${extracted.confidence} images=${_meta.imageCount} ` +
        `messages=${messages.length} tokens=${_meta.usage?.total_tokens ?? '?'}`,
    );

    // Belt-and-braces on top of the prompt's own normalisation instructions:
    // collapse whatever spelling the model settled on onto the master list
    // (services/locations.js) so a near-miss ("gombé" surviving the prompt,
    // an accent GPT-4o left alone) doesn't reach storage un-normalised. A
    // name with no confident match — a genuinely new/informal one — is left
    // as the model wrote it rather than dropped.
    if (extracted.commune) {
      const resolvedCommune = resolveCommune(extracted.commune);
      if (resolvedCommune) extracted.commune = resolvedCommune;
    }
    if (extracted.quartier) {
      const resolvedQuartier = resolveQuartier(extracted.quartier, extracted.commune);
      if (resolvedQuartier) extracted.quartier = resolvedQuartier;
    }

    // AGENT ONBOARDING — the reply to "what is your name and your agency?".
    //
    // Checked before the buyer branch and before the listing branch, and
    // gated on `!extracted.is_listing` so a sender who answers by simply
    // sending another property is treated as submitting that property (which
    // is what they did) rather than having "Villa 3 chambres Gombe 1500$"
    // stored as their name.
    //
    // A failed capture (unparseable answer, Postgres down) deliberately falls
    // THROUGH to the normal reply below rather than returning: the sender
    // gets a sensible response either way, and the session stays open so the
    // question can be asked again on their next listing.
    if (!extracted.is_listing && hasText && onboarding.getSession(from)?.state === 'AWAITING_NAME') {
      const result = await onboarding.completeOnboarding(from, text, {
        pendingListingId: pending ? pending.id : null,
      });
      if (result.handled) {
        console.log(`[onboarding] ${from} registered from WhatsApp`);
        return;
      }
      console.log(`[onboarding] ${from} reply not usable as a name (${result.reason}) — falling through`);
    }

    // Customer search, not an agent submission — route to the buyer
    // conversation engine (services/buyerConversation.js) instead of the
    // agent-intake reply below. Scoped tightly: only fires when this sender
    // has no listing awaiting confirmation (`pending`), so an agent
    // mid-way through submitting their own listing is never redirected here
    // even if a correction reply happens to get classified as non-listing.
    // See CLAUDE.md's "WhatsApp Property-Search Assistant" section.
    if (!extracted.is_listing && !pending && extracted.intent === 'buyer_request') {
      await handleBuyerMessage({ from, text, primaryWamid });
      return;
    }

    if (extracted.is_listing) {
      // Stands on its own as a complete listing — always its own row, even if
      // this sender still has an earlier one awaiting confirmation (e.g. a
      // second, unrelated property posted before replying 'OK' to the first).
      const { id, duplicate } = insertListing(extracted, from, {
        wamid: primaryWamid,
        groupWamids: wamids,
        agentName: profileName,
        rawText: text,
        photos: photoPaths,
      });

      if (duplicate) {
        // Lost a race with a concurrent retry; the row is already on file.
        console.log(`[dedupe] ${primaryWamid} raced — stored as listing #${id}, no reply sent`);
        return;
      }

      console.log(
        `[db] listing #${id} saved from ${from}` +
          (wamids.length > 1 ? ` (${wamids.length} messages)` : ''),
      );

      // Is this sender already a registered agent? If not, the reply below
      // carries a structured summary card and one question instead of ending
      // at "répondez OK". Answering that question IS the confirmation for an
      // unregistered sender (see services/agentOnboarding.js), so they are
      // never asked to acknowledge the same listing twice.
      //
      // Wrapped: an onboarding failure must never cost the agent the reply
      // confirming we received their property.
      try {
        if (await onboarding.shouldOnboard(from)) {
          const prompt = onboarding.startOnboarding(from, getListing(id), photoPaths.length);
          if (prompt) onboardingSuffix = prompt;
        }
      } catch (err) {
        console.warn(`[onboarding] could not offer registration to ${from}: ${err.message}`);
      }
    } else if (pending) {
      // Doesn't stand alone as a listing, but a prior one is still pending —
      // treat it as a correction/refinement of that listing rather than noise.
      applyListingCorrection(pending.id, extracted, text, wamids, photoPaths);
      console.log(`[db] listing #${pending.id} updated (correction from ${from})`);
    }

    await chakra.sendWhatsAppMessage(from, onboardingSuffix ? `${reply}

${onboardingSuffix}` : reply, {
      replyToMessageId: primaryWamid || undefined,
    });
    console.log(`[chakra] reply sent to ${from}${onboardingSuffix ? ' (with registration prompt)' : ''}`);
  } finally {
    wamids.forEach((wamid) => inFlight.delete(wamid));
  }
}

router.post('/', verifyWebhookSecret, (req, res) => {
  // Acknowledge first: providers retry deliveries they consider failed, and a
  // gpt-4o call takes longer than the ack window allows.
  res.sendStatus(200);

  const messages = extractInboundMessages(req.body);

  if (messages.length === 0) {
    // Distinguish the two very different reasons for finding nothing: a normal
    // status callback (sent/delivered/read) versus a payload shape this parser
    // does not understand. Only the second one is a problem, and diagnosing it
    // needs the actual body.
    const statuses = (req.body?.entry || []).flatMap((entry) =>
      (entry?.changes || []).flatMap((change) => change?.value?.statuses || []),
    );

    if (statuses.length) {
      console.log(
        `[chakra] ${statuses.length} status event(s) [${statuses.map((s) => s.status).join(', ')}] — ignored`,
      );
    } else {
      console.warn(
        '[chakra] UNRECOGNISED payload — no messages extracted. Body: ' +
          JSON.stringify(req.body).slice(0, 1500),
      );
    }
    return;
  }

  for (const message of messages) {
    console.log(
      `[chakra] inbound ${message.type} from ${message.from} — ${message.wamid || 'no id'}` +
        (message.media?.length ? ` (${message.media.length} media)` : ''),
    );

    // Skip a known redelivery before it joins a group, so it never restarts a
    // debounce window for a listing that is already on file.
    if (message.wamid && findByWamid(message.wamid)) {
      console.log(`[dedupe] ${message.wamid} already stored — skipped`);
      continue;
    }

    // A real message we recognise but don't parse (video, audio, a shared
    // location, …) — tell the agent directly rather than silently dropping
    // it. No AI call, no burst-grouping: this never becomes a listing.
    if (isUnsupportedType(message)) {
      chakra.sendWhatsAppMessage(message.from, UNSUPPORTED_MEDIA_REPLY, {
        replyToMessageId: message.wamid || undefined,
      })
        .then(() => console.log(`[chakra] ${message.type} from ${message.from} — sent unsupported-format reply`))
        .catch((err) => {
          console.error(`[chakra] failed to reply to unsupported ${message.type} from ${message.from}: ${err.message}`);
        });
      continue;
    }

    try {
      const maybePromise = enqueueMessage(message);
      if (maybePromise) {
        maybePromise.catch((err) => {
          console.error(`[chakra] ${message.wamid || message.from} failed: ${err.message}`);
        });
      }
    } catch (err) {
      console.error(`[chakra] ${message.wamid || message.from} failed: ${err.message}`);
    }
  }
});

module.exports = router;
module.exports.extractInboundMessages = extractInboundMessages;
module.exports.processGroup = processGroup;
module.exports.enqueueMessage = enqueueMessage;
module.exports.flushAll = flushAll;
module.exports.isAffirmative = isAffirmative;
module.exports.PUBLISHED_REPLY = PUBLISHED_REPLY;
module.exports.isUnsupportedType = isUnsupportedType;
module.exports.UNSUPPORTED_MEDIA_REPLY = UNSUPPORTED_MEDIA_REPLY;
