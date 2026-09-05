/**
 * Lukka Place — WhatsApp Webhook Engine
 *
 * Inbound WhatsApp messages from real-estate agents in Kinshasa land here, get
 * parsed into structured listings in a single AI pass, and the agent gets an
 * instant confirmation back on WhatsApp.
 */

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');

const { parseListing } = require('./services/aiParser');
const { saveListing, findByWamid, getListings } = require('./services/db');
const whatsapp = require('./services/whatsapp');
const chakraWebhook = require('./routes/webhook');
const adminRoutes = require('./routes/admin');
const { UPLOADS_ROOT } = require('./services/mediaStorage');
const scheduler = require('./services/scheduler');
const locationsService = require('./services/locations');

const app = express();
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.APP_SECRET;

// Optional read API key. Unset => the read endpoints stay open for local work.
const API_SECRET = process.env.API_SECRET;

// Escape hatch for local testing with curl / Postman, where you can't produce a
// valid Meta signature. Must be set explicitly — the default is fail-closed.
const ALLOW_UNSIGNED_WEBHOOKS = process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true';

// Keep the exact bytes Meta sent: the HMAC is computed over the raw payload, and
// re-serialising the parsed object (key order, unicode escapes, whitespace) would
// produce a different digest and fail every legitimate request.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.json({ service: 'lukka-place-engine', status: 'ok' });
});

// Downloaded listing photos (services/mediaStorage.js). Read-only, no auth —
// matches GET /listings' default-open local-dev posture; set up a reverse
// proxy / auth layer in front of this before deploying anywhere public.
app.use('/uploads', express.static(UPLOADS_ROOT));

/**
 * Constant-time string comparison. `timingSafeEqual` throws when the buffers
 * differ in length, so screen that first — a length mismatch is already a
 * mismatch, and leaking it tells an attacker nothing they didn't send.
 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Read API — GET /listings
// ---------------------------------------------------------------------------

/**
 * Gate the read endpoints on API_SECRET when one is configured.
 *
 * Unlike the webhook (which fails closed), this deliberately stays open when no
 * secret is set so the endpoint is usable while developing locally. Set
 * API_SECRET in any deployed environment — this data is agent contact details
 * and pricing.
 */
function requireApiKey(req, res, next) {
  if (!API_SECRET) {
    return next();
  }

  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const provided = req.get('x-api-key') || bearer;

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'Missing API key. Send it as X-API-Key or Authorization: Bearer <key>.',
    });
  }

  if (!safeEqual(provided, API_SECRET)) {
    console.warn('[api] rejected — invalid API key');
    return res.status(401).json({ success: false, error: 'Invalid API key.' });
  }

  return next();
}

const TRANSACTION_TYPES = ['location', 'vente'];

app.get('/listings', requireApiKey, (req, res) => {
  const { limit, offset, commune, transaction_type: transactionType } = req.query;

  // A typo here would otherwise return an empty array, which reads as "no
  // listings" rather than "bad filter" — so reject it explicitly. `limit` needs
  // no such treatment: it has an obvious sane fallback.
  if (transactionType && !TRANSACTION_TYPES.includes(String(transactionType).toLowerCase())) {
    return res.status(400).json({
      success: false,
      error: `Invalid transaction_type '${transactionType}'. Expected one of: ${TRANSACTION_TYPES.join(', ')}.`,
    });
  }

  try {
    // getListings returns { total, limit, offset, count, data } — spread so the
    // response advertises the values actually applied after clamping, not the
    // raw query string.
    const page = getListings({ limit, offset, commune, transaction_type: transactionType });
    return res.json({ success: true, ...page });
  } catch (err) {
    console.error(`[api] GET /listings failed: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Could not read listings.' });
  }
});

// ---------------------------------------------------------------------------
// Admin API — conversations + leads dashboard (routes/admin.js), consumed by
// web/'s /admin pages. Same requireApiKey gate as GET /listings above — no
// new auth mechanism. Local-dev-only posture for now: the web/ admin pages
// themselves have no login yet, so do not expose this beyond localhost.
// ---------------------------------------------------------------------------

app.use('/admin', requireApiKey, adminRoutes);

// ---------------------------------------------------------------------------
// GET /locations — Kinshasa commune/quartier hierarchy (kinshasa_locations.json)
//
// No form/admin UI exists in this repo yet — this exists so one (here or in a
// separate frontend) can drive a cascading commune -> quartier select without
// duplicating the master list. Read-only, no auth, same posture as /uploads:
// this is reference data, not agent contact details or pricing.
// ---------------------------------------------------------------------------

app.get('/locations', (req, res) => {
  res.json({ success: true, communes: locationsService.COMMUNES, locations: locationsService.LOCATIONS });
});

/** Quartiers for one commune — what a "commune" select's change handler fetches
 *  to (re)populate its "quartier" sibling. Accepts a raw guess, not just the
 *  canonical spelling, so a form can free-type a commune before its own list
 *  finishes loading. */
app.get('/locations/:commune/quartiers', (req, res) => {
  const canonical = locationsService.resolveCommune(req.params.commune);
  if (!canonical) {
    return res.status(404).json({
      success: false,
      error: `Unknown commune '${req.params.commune}'. See GET /locations for the valid list.`,
    });
  }
  return res.json({ success: true, commune: canonical, quartiers: locationsService.LOCATIONS[canonical] });
});

// ---------------------------------------------------------------------------
// GET /webhook — Meta's one-time subscription handshake
// ---------------------------------------------------------------------------

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] verification succeeded');
    // Meta expects the raw challenge string echoed back, nothing else.
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] verification failed — token mismatch or bad mode');
  return res.sendStatus(403);
});

// ---------------------------------------------------------------------------
// X-Hub-Signature-256 — prove the payload really came from Meta
// ---------------------------------------------------------------------------

/**
 * Verify the SHA-256 HMAC Meta attaches to every webhook POST.
 *
 * Without this, anyone who discovers the URL can inject fake listings and burn
 * Gemini quota. The digest is taken over the raw request body keyed with the
 * app secret, and compared in constant time.
 */
function verifySignature(req, res, next) {
  const header = req.get('x-hub-signature-256');

  if (!APP_SECRET) {
    if (ALLOW_UNSIGNED_WEBHOOKS) {
      console.warn('[signature] APP_SECRET unset — skipping verification (ALLOW_UNSIGNED_WEBHOOKS=true)');
      return next();
    }
    // Fail closed: a missing secret in production is a misconfiguration, not a
    // reason to start trusting unauthenticated traffic.
    console.error('[signature] APP_SECRET is not set — rejecting webhook');
    return res.sendStatus(500);
  }

  if (!header) {
    console.warn('[signature] rejected — no X-Hub-Signature-256 header');
    return res.sendStatus(401);
  }

  // `verify` only runs when body-parser handles the request, so an absent
  // rawBody means there was nothing signable to begin with.
  if (!req.rawBody?.length) {
    console.warn('[signature] rejected — empty or unparsed body');
    return res.sendStatus(401);
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  if (!safeEqual(header, expected)) {
    console.warn('[signature] rejected — signature mismatch');
    return res.sendStatus(401);
  }

  return next();
}

// ---------------------------------------------------------------------------
// POST /webhook — Chakra Chat (active pipeline: gpt-4o -> SQLite -> Chakra)
// ---------------------------------------------------------------------------

app.use('/webhook', chakraWebhook);

// ---------------------------------------------------------------------------
// POST /webhook/meta — direct Meta Cloud API pipeline (Gemini -> SQLite -> Meta)
//
// Superseded by the Chakra route above, kept so the original provider path is
// still reachable during the switchover. Point Meta at /webhook/meta if you need
// it, or delete this handler (plus services/aiParser.js and services/whatsapp.js)
// once Chakra is confirmed working.
// ---------------------------------------------------------------------------

app.post('/webhook/meta', verifySignature, (req, res) => {
  // Ack within seconds or Meta retries the delivery — so acknowledge first and
  // do the AI work after the response is on the wire.
  res.sendStatus(200);

  const messages = extractMessages(req.body);

  for (const { message, contact, phoneNumberId } of messages) {
    handleMessage(message, contact, phoneNumberId).catch((err) => {
      console.error(`[handler] ${message.id} failed:`, err.message);
    });
  }
});

/**
 * Flatten the deeply nested webhook envelope into a list of messages.
 *
 * Meta batches entries and changes, and the same payload shape also carries
 * delivery/read statuses (`value.statuses`) with no `messages` key at all.
 */
function extractMessages(body) {
  if (body?.object !== 'whatsapp_business_account') {
    return [];
  }

  const collected = [];

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      if (change.field !== 'messages' || !value.messages) {
        continue;
      }

      const contactsByWaId = new Map(
        (value.contacts || []).map((contact) => [contact.wa_id, contact]),
      );

      for (const message of value.messages) {
        collected.push({
          message,
          contact: contactsByWaId.get(message.from) || null,
          phoneNumberId: value.metadata?.phone_number_id || null,
        });
      }
    }
  }

  return collected;
}

/**
 * Message ids currently being processed.
 *
 * Meta can redeliver while the first copy is still awaiting Gemini, in which
 * case the database check below hasn't got a row to find yet. The unique index
 * still blocks the double insert, but only this in-memory guard stops the second
 * copy from paying for its own AI call. Cleared in a `finally`, so a crashed
 * parse doesn't wedge the id permanently.
 */
const inFlight = new Set();

/**
 * Route one inbound message: acknowledge it, gather text + images, run the
 * single AI pass, and reply with what we understood.
 */
async function handleMessage(message, contact) {
  const from = message.from;
  const agentName = contact?.profile?.name || from;

  console.log(`[inbound] ${message.type} from ${agentName} (${from}) — ${message.id}`);

  // Both checks run before any billable work: no Gemini call, no media
  // download, and no second confirmation to the agent for a message they only
  // sent once.
  if (inFlight.has(message.id)) {
    console.log(`[dedupe] ${message.id} already in flight — skipped`);
    return;
  }

  const already = findByWamid(message.id);
  if (already) {
    console.log(`[dedupe] ${message.id} already stored as listing #${already.id} — skipped`);
    return;
  }

  inFlight.add(message.id);
  try {
    await processMessage(message, from, agentName, contact);
  } finally {
    inFlight.delete(message.id);
  }
}

/** The actual work, once dedupe has cleared the message. */
async function processMessage(message, from, agentName, contact) {
  await whatsapp.markAsRead(message.id).catch((err) => {
    // Cosmetic only; never let a failed receipt block the parse.
    console.warn(`[inbound] markAsRead failed: ${err.message}`);
  });

  let text;
  const images = [];

  switch (message.type) {
    case 'text':
      text = message.text?.body;
      break;

    case 'image':
      text = message.image?.caption;
      images.push(await whatsapp.downloadMedia(message.image.id));
      break;

    default:
      // Audio, location, contacts, stickers, reactions — out of scope for the
      // single-pass parser, so tell the agent instead of failing silently.
      await whatsapp.sendText(
        from,
        'Bonjour 👋 Pour publier une annonce, envoyez-la en *texte* ou en *photo* (avec légende). ' +
          'Les autres formats ne sont pas encore pris en charge.',
        { replyToMessageId: message.id },
      );
      return;
  }

  if (!text?.trim() && images.length === 0) {
    console.log(`[inbound] ${message.id} had nothing to parse — skipped`);
    return;
  }

  const listing = await parseListing({ text, images, senderPhone: from });

  console.log(
    `[parsed] ${message.id} — listing=${listing.is_listing} intent=${listing.intent} ` +
      `confidence=${listing.confidence}`,
  );

  if (listing.is_listing) {
    try {
      const { id, duplicate } = saveListing(listing, {
        waId: from,
        wamid: message.id,
        agentName: contact?.profile?.name,
        rawText: text,
      });

      if (duplicate) {
        // Lost a race with a concurrent redelivery. The row is on file, so stay
        // quiet rather than confirm the same listing to the agent twice.
        console.log(`[dedupe] ${message.id} raced — already stored as listing #${id}, no reply sent`);
        return;
      }

      console.log(`[db] listing #${id} saved from ${from}`);
    } catch (err) {
      // Never confirm "Annonce reçue ✅" for something we failed to store — the
      // agent would assume the listing is on file and move on.
      console.error(`[db] save failed for ${message.id}: ${err.message}`);
      await whatsapp.sendText(
        from,
        'Désolé, un problème technique nous a empêchés d\'enregistrer votre annonce. ' +
          'Merci de la renvoyer dans quelques instants 🙏',
        { replyToMessageId: message.id },
      );
      return;
    }
  }

  await whatsapp.sendText(from, formatReply(listing, agentName), {
    replyToMessageId: message.id,
  });
}

const FIELD_LABELS_FR = {
  transaction_type: 'location ou vente ?',
  property_type: 'type de bien ?',
  commune: 'commune ?',
  price: 'prix ?',
  bedrooms: 'nombre de chambres ?',
};

/**
 * Build the French confirmation the agent sees on WhatsApp.
 */
function formatReply(listing, agentName) {
  if (!listing.is_listing) {
    return (
      `Bonjour ${agentName} 👋\n\n` +
      "Je n'ai pas reconnu d'annonce dans ce message. " +
      'Envoyez-moi le bien avec le type, la commune, le prix et le nombre de chambres — ' +
      'en français ou en lingala, comme vous voulez.'
    );
  }

  const lines = ['*Annonce reçue ✅*', '', listing.summary_fr, ''];

  const price = listing.price
    ? `${listing.price.toLocaleString('fr-FR')} ${listing.currency || ''}`.trim() +
      (listing.price_period === 'mois' ? ' / mois' : '')
    : null;

  const details = [
    ['Transaction', listing.transaction_type],
    ['Type', listing.property_type?.replace(/_/g, ' ')],
    ['Commune', listing.commune],
    ['Quartier', listing.quartier],
    ['Prix', price],
    ['Chambres', listing.bedrooms],
    ['Salles de bain', listing.bathrooms],
    ['Superficie', listing.surface_area_sqm ? `${listing.surface_area_sqm} m²` : null],
    ['Équipements', listing.amenities?.length ? listing.amenities.join(', ') : null],
  ];

  for (const [label, value] of details) {
    if (value !== null && value !== undefined && value !== '') {
      lines.push(`• ${label} : ${value}`);
    }
  }

  if (listing.missing_fields?.length) {
    lines.push('', "*Il me manque encore :*");
    for (const field of listing.missing_fields) {
      lines.push(`• ${FIELD_LABELS_FR[field] || field}`);
    }
    lines.push('', 'Répondez simplement avec ces infos et je complète la fiche.');
  } else {
    lines.push('', 'Répondez *OK* pour publier, ou envoyez une correction.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (!VERIFY_TOKEN) {
  console.warn('[boot] VERIFY_TOKEN is not set — webhook verification will reject Meta.');
}

if (!process.env.OPENAI_API_KEY) {
  console.warn('[boot] OPENAI_API_KEY is not set — POST /webhook cannot extract listings.');
}

if (!process.env.CHAKRA_ACCESS_TOKEN) {
  console.warn('[boot] CHAKRA_ACCESS_TOKEN is not set — replies to agents will fail to send.');
}

if (!process.env.CHAKRA_WEBHOOK_HMAC_SECRET) {
  console.warn(
    ALLOW_UNSIGNED_WEBHOOKS
      ? '[boot] CHAKRA_WEBHOOK_HMAC_SECRET is not set and ALLOW_UNSIGNED_WEBHOOKS=true — POST /webhook accepts UNVERIFIED payloads. Local testing only.'
      : '[boot] CHAKRA_WEBHOOK_HMAC_SECRET is not set — POST /webhook will reject every request with 500.',
  );
}

if (!API_SECRET) {
  console.warn('[boot] API_SECRET is not set — GET /listings is publicly readable. Local use only.');
}

if (!APP_SECRET) {
  console.warn(
    ALLOW_UNSIGNED_WEBHOOKS
      ? '[boot] APP_SECRET is not set and ALLOW_UNSIGNED_WEBHOOKS=true — inbound payloads are UNVERIFIED. Local testing only.'
      : '[boot] APP_SECRET is not set — inbound POSTs will be rejected with 500.',
  );
}

const server = app.listen(PORT, () => {
  console.log(`[boot] Lukka Place engine listening on http://localhost:${PORT}`);
  console.log(`[boot] webhook endpoint: http://localhost:${PORT}/webhook`);

  // The weekly customer alert sweep. This process is the only always-on,
  // single-instance component in the system (ecosystem.config.js pins it to
  // one fork), which is what makes it the right place to hold a timer —
  // web/'s alert endpoint has existed and worked for weeks with nothing
  // calling it. See services/scheduler.js.
  scheduler.start();
});

/**
 * Burst grouping holds messages in memory for a few seconds. On a clean shutdown
 * flush them, otherwise those listings are lost — the webhook already returned
 * 200, so Chakra will never redeliver them.
 */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[shutdown] ${signal} — flushing buffered messages`);
    try {
      chakraWebhook.flushAll();
    } catch (err) {
      console.error(`[shutdown] flush failed: ${err.message}`);
    }

    scheduler.stop();
    server.close(() => console.log('[shutdown] http server closed'));

    // Give in-flight extraction and replies a moment to finish.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

module.exports = { app, extractMessages, formatReply };
