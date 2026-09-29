'use strict';

/**
 * services/availabilityCheck.js
 *
 * "Toujours disponible ?" on WhatsApp, every 14 days per listing.
 *
 * Agents live in WhatsApp, not in the dashboard, so the web prompt
 * (web/lib/listingAvailability.js) alone left most listings unconfirmed and
 * let-but-still-listed. This asks the listing's own agent with one tap:
 *
 *   Oui, disponible    -> availability_confirmed_at = NOW()
 *   Non, plus dispo    -> "Loué / vendu" or "Retiré du marché" ?
 *        Loué / vendu  -> under_offer now, "à quel prix ?", then closed with
 *                         that price, then "le client venait-il de Lukka Place ?"
 *        Retiré        -> archived (status 0) — NOT a transaction
 *   Prix modifié       -> "nouveau prix ?" -> both stores, then confirmed
 *
 * WHO IS ASKED, AND HOW OFTEN
 * Live, active listings whose last confirmation (or, never confirmed, last
 * change) is older than CONFIRM_AFTER_DAYS, and that we have not asked about
 * in ASK_INTERVAL_DAYS — recorded in Postgres `listing_availability_checks`
 * (migrations/20260929_listing_availability_checks.sql). Without that table
 * the job refuses to run: it is the only thing that stops a daily re-ask.
 * Only an agent whose phone is VERIFIED is asked (the gate every agent
 * message here shares), at most MAX_ASKS_PER_AGENT_PER_DAY, and never an
 * agent who still owes us an answer to another question — a new question
 * would replace theirs (one open question per number, services/db.js).
 *
 * ANTI-LOOP
 *  - A typed answer is matched to `pending_listing_actions`, which is deleted
 *    after 24h (not merely ignored), so a reply days later falls through to
 *    ordinary processing instead of answering a newer question.
 *  - When the question went out as numbered TEXT (no buttons), a typed "1" can
 *    only mean the last one, so that agent is asked nothing else that day.
 *  - A tapped button names its listing and is honoured whenever it arrives,
 *    but only against the listing's CURRENT state: a listing that has since
 *    closed or been archived gets "déjà mis à jour" and nothing is written.
 *  - A price more than 50% away from the one on record (150 typed for 1 500)
 *    is read back for OUI before anything is written — for a new asking price
 *    and for a closing price alike.
 *
 * AUTHORISATION
 * Every handler re-resolves the listing's agent from Postgres and refuses a
 * sender who is not that agent's verified number — silently, since answering
 * a stranger confirms the listing id is real. Same posture as the viewing
 * buttons (services/viewingNotifications.js).
 *
 * DELIVERY
 * Template first when LISTING_AVAILABILITY_TEMPLATE is set (Meta-approved,
 * UTILITY, with the three quick replies in the order ASK_BUTTONS declares);
 * interactive buttons otherwise; numbered text as the last resort. A session
 * message only reaches an agent who wrote to us in the last 24h — until the
 * template is approved, most asks will be accepted by Meta and never arrive.
 */

const chakra = require('./chakra');
const pg = require('./postgres');
const dbService = require('./db');
const priceExtraction = require('./priceExtraction');

const CONTENT_LANGUAGE_ID = 20;
const JOB_NAME = 'listing-availability-check';
const HEADER_BRAND = '🏠 [Lukka Place]';
const SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** A listing is due once its last confirmation is this old. web/lib/listingAvailability.js CONFIRM_AFTER_DAYS — change one, change the other. */
const CONFIRM_AFTER_DAYS = 14;
/** And we have not asked about it for this long. */
const ASK_INTERVAL_DAYS = 14;
const MAX_ASKS_PER_AGENT_PER_DAY = 3;
const MAX_DUE_PER_RUN = 300;
/** A price further than this from the one on record is read back before it is written. */
const PRICE_DEVIATION_LIMIT = 0.5;
const MIN_GAP_MS = 20 * 60 * 60 * 1000;
const SEND_GAP_MS = Number.parseInt(process.env.AVAILABILITY_CHECK_GAP_MS, 10) || 250;

const CONFIGURED_HOUR = Number.parseInt(process.env.AVAILABILITY_CHECK_HOUR, 10);
/** Kinshasa hour (UTC+1). 10h: after the 8h digest, while agents are out on visits. */
const CHECK_HOUR_KINSHASA = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 10;

/** Read at call time, like OPS_WHATSAPP_NUMBER, so approving it needs no restart. */
function templateName() {
  return process.env.LISTING_AVAILABILITY_TEMPLATE || null;
}
function templateLanguage() {
  return process.env.LISTING_AVAILABILITY_TEMPLATE_LANG || 'fr';
}

const KINDS = {
  response: 'AVAILABILITY_RESPONSE',
  gone: 'AVAILABILITY_GONE',
  closingPrice: 'CLOSING_PRICE',
  closingPriceConfirm: 'CLOSING_PRICE_CONFIRM',
  newPrice: 'NEW_PRICE',
  newPriceConfirm: 'NEW_PRICE_CONFIRM',
  viaPlatform: 'VIA_PLATFORM',
};

const ANSWERS = {
  available: 'AVAILABLE',
  priceChanged: 'PRICE_CHANGED',
  letOrSold: 'LET_OR_SOLD',
  withdrawn: 'WITHDRAWN',
};

const BUTTON_ACTIONS = ['yes', 'no', 'price', 'let', 'withdrawn', 'via_yes', 'via_no'];

// ---------------------------------------------------------------------------
// Small pure helpers (exported for scripts/verify-pipeline.js)
// ---------------------------------------------------------------------------

/** `avail_let:310` -> { action: 'let', propertyId: 310 }, anything else null. */
function parseAvailabilityButtonId(replyId) {
  const match = /^avail_(yes|no|price|let|withdrawn|via_yes|via_no):(\d{1,18})$/.exec(String(replyId || '').trim());
  if (!match || !BUTTON_ACTIONS.includes(match[1])) return null;
  return { action: match[1], propertyId: Number(match[2]) };
}

function buttonId(action, propertyId) {
  return `avail_${action}:${propertyId}`;
}

/**
 * The three answers to the check itself. Titles are the labels the Meta
 * template must declare, in this order — the template's quick-reply payloads
 * are matched by index (chakra.sendTemplate). Each is within WhatsApp's
 * 20-character button limit.
 */
function askButtons(propertyId) {
  return [
    { id: buttonId('yes', propertyId), title: 'Oui, disponible' },
    { id: buttonId('no', propertyId), title: 'Non, plus disponible' },
    { id: buttonId('price', propertyId), title: 'Prix modifié' },
  ];
}

function goneButtons(propertyId) {
  return [
    { id: buttonId('let', propertyId), title: 'Loué / vendu' },
    { id: buttonId('withdrawn', propertyId), title: 'Retiré du marché' },
  ];
}

function viaButtons(propertyId) {
  return [
    { id: buttonId('via_yes', propertyId), title: 'Oui, via Lukka Place' },
    { id: buttonId('via_no', propertyId), title: 'Non' },
  ];
}

function fold(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** "1", "1.", "1️⃣", "un" … -> 1. Anything else null, so the message falls through. */
function parseChoice(text, max) {
  const raw = fold(text).replace(/[️⃣]/g, '').replace(/[.)\]]+$/, '').trim();
  const words = { un: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3 };
  const n = /^[1-9]$/.test(raw) ? Number(raw) : words[raw] || null;
  return n && n <= max ? n : null;
}

/** The typed answer to the check itself: a digit, or the words themselves. */
function parseAskAnswer(text) {
  const choice = parseChoice(text, 3);
  if (choice) return ['yes', 'no', 'price'][choice - 1];
  const raw = fold(text).replace(/[!.]+$/, '').trim();
  if (/^(oui|yes|toujours disponible|disponible|dispo|oui disponible|oui c'?est disponible)$/.test(raw)) return 'yes';
  if (/^(non|no|plus disponible|non plus disponible|pas disponible)$/.test(raw)) return 'no';
  if (/^(prix modifie|le prix a change|nouveau prix|prix change)$/.test(raw)) return 'price';
  return null;
}

function parseGoneAnswer(text) {
  const choice = parseChoice(text, 2);
  if (choice) return choice === 1 ? 'let' : 'withdrawn';
  const raw = fold(text);
  if (/^(deja\s+)?(loue|louee|vendu|vendue)\b/.test(raw)) return 'let';
  if (/^(retire|retiree|plus sur le marche|le proprietaire l'?a retire)/.test(raw)) return 'withdrawn';
  return null;
}

function parseViaAnswer(text) {
  const choice = parseChoice(text, 2);
  if (choice) return choice === 1;
  const raw = fold(text).replace(/[!.]+$/, '').trim();
  if (/^(oui|yes|oui via lukka place|via lukka place)$/.test(raw)) return true;
  if (/^(non|no)$/.test(raw)) return false;
  return null;
}

/**
 * Should this figure be read back before it is written? More than
 * PRICE_DEVIATION_LIMIT away from the reference price, either way — 150 typed
 * for 1 500 is a slip, and so is 15 000. No reference, no check.
 */
function priceNeedsReadBack(amount, referencePrice) {
  const ref = Number(referencePrice);
  const value = Number(amount);
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(value) || value <= 0) return false;
  return Math.abs(value - ref) / ref > PRICE_DEVIATION_LIMIT;
}

function isRent(listing) {
  return listing?.purpose === 'rent';
}

function priceWithPeriod(listing, amount = listing?.price) {
  if (amount == null || Number(amount) <= 0) return null;
  const base = priceExtraction.formatUsd(Number(amount));
  if (!isRent(listing)) return base;
  return `${base} / ${listing.price_period === 'an' ? 'an' : 'mois'}`;
}

/** "Appartement 3 chambres à louer à Kintambo — 1 300 $ / mois" — one line, template-safe. */
function listingLine(listing) {
  const title = String(listing?.title || '').replace(/\s+/g, ' ').trim() || `Bien #${listing?.id}`;
  const price = priceWithPeriod(listing);
  return price ? `${title} — ${price}` : title;
}

/**
 * The listing's own reference when it has one, else its number on the site.
 * Never an invented code — root CLAUDE.md, "reference": a made-up "LUK-310"
 * would be an id dressed up as a reference.
 */
function referenceLine(listing) {
  const reference = String(listing?.reference || '').replace(/\s+/g, ' ').trim();
  return reference ? `Réf. ${reference}` : `annonce n° ${listing?.id}`;
}

function listingUrl(propertyId) {
  return `${SITE_URL}/listings/${propertyId}`;
}

function firstNameOf(listing) {
  return String(listing?.first_name || '').trim() || 'partenaire';
}

function askText(listing) {
  return [
    `${HEADER_BRAND} Toujours disponible ?`,
    '',
    `Bonjour ${firstNameOf(listing)}, concernant votre bien :`,
    `📍 ${listingLine(listing)}`,
    `🔖 ${referenceLine(listing)}`,
    '',
    `Est-il toujours disponible ${isRent(listing) ? 'à la location' : 'à la vente'} ?`,
    listingUrl(listing.id),
  ].join('\n');
}

/** The three Meta template variables, in {{1}}..{{3}} order. No newlines — Meta refuses them in a parameter. */
function templateParams(listing) {
  return [firstNameOf(listing), listingLine(listing), referenceLine(listing)];
}

const ASK_FALLBACK = ['', 'Répondez :', '1️⃣ Oui, toujours disponible', '2️⃣ Non, plus disponible', '3️⃣ Le prix a changé'].join('\n');
const GONE_FALLBACK = ['', 'Répondez :', '1️⃣ Loué / vendu', '2️⃣ Retiré du marché'].join('\n');
const VIA_FALLBACK = ['', 'Répondez :', '1️⃣ Oui, via Lukka Place', '2️⃣ Non'].join('\n');

function goneText(listing) {
  return [`${HEADER_BRAND} Merci. Que s'est-il passé pour ce bien ?`, `📍 ${listingLine(listing)}`].join('\n');
}

function closingPriceAskText(listing) {
  return isRent(listing)
    ? `${HEADER_BRAND} Félicitations ! 🎉 À quel loyer mensuel a-t-il été loué (en USD) ? (Exemple : 700)\n\nRépondez _passer_ si vous préférez ne pas le communiquer.`
    : `${HEADER_BRAND} Félicitations ! 🎉 À quel prix a-t-il été vendu (en USD) ? (Exemple : 85000)\n\nRépondez _passer_ si vous préférez ne pas le communiquer.`;
}

function newPriceAskText(listing) {
  return isRent(listing)
    ? `${HEADER_BRAND} Quel est le nouveau loyer mensuel (en USD) ? (Exemple : 700)`
    : `${HEADER_BRAND} Quel est le nouveau prix de vente (en USD) ? (Exemple : 85000)`;
}

/** "Vous avez indiqué 150 $. Le prix affiché est 1 500 $. Confirmez-vous ce prix ?" */
function readBackText(amount, referencePrice, { closing = false } = {}) {
  const lines = [`${HEADER_BRAND} Vous avez indiqué ${priceExtraction.formatUsd(amount)}.`];
  if (Number(referencePrice) > 0) {
    lines.push(`${closing ? 'Le prix affiché était' : 'Le prix affiché est'} ${priceExtraction.formatUsd(Number(referencePrice))}.`);
  }
  lines.push('', 'Confirmez-vous ce prix ? Répondez *OUI*, ou envoyez le bon montant.');
  return lines.join('\n');
}

const USD_ONLY_TEXT = `${HEADER_BRAND} Pouvez-vous nous donner le montant en dollars (USD) ? (Exemple : 700)`;
const ALREADY_UPDATED_TEXT = `${HEADER_BRAND} Ce bien a déjà été mis à jour — rien n'a été modifié. Merci !`;
const CONFIRMED_TEXT = `${HEADER_BRAND} Merci ! ✅ Disponibilité confirmée. Prochaine vérification dans ${CONFIRM_AFTER_DAYS} jours.`;
const PRICE_UNCHANGED_TEXT = `${HEADER_BRAND} D'accord, le prix reste inchangé. Merci !`;
const SKIPPED_PRICE_TEXT = `${HEADER_BRAND} Très bien — le bien est retiré des recherches.`;

function viaAskText() {
  return `${HEADER_BRAND} Dernière question : le client a-t-il trouvé ce bien grâce à Lukka Place ?`;
}

function withdrawnText(propertyId) {
  return [
    `${HEADER_BRAND} C'est noté — l'annonce est retirée du site.`,
    `Si le bien revient sur le marché, remettez-la en ligne depuis votre espace : ${SITE_URL}/compte/agent/biens`,
    `(annonce n° ${propertyId})`,
  ].join('\n');
}

function priceUpdatedText(listing, amount, previous) {
  const lines = [`${HEADER_BRAND} Prix mis à jour : ${priceWithPeriod(listing, amount)} ✅`];
  if (previous != null && Number(previous) > 0 && Number(previous) !== Number(amount)) {
    lines.push(`(avant : ${priceWithPeriod(listing, previous)})`);
  }
  lines.push('Disponibilité confirmée — merci !');
  return lines.join('\n');
}

function closedReceiptText(listing, amount, listPrice) {
  const delta = priceExtraction.computePriceDelta(listPrice, amount);
  const lines = [`${HEADER_BRAND} Merci, la transaction est enregistrée. 🎉`, `💰 Prix conclu : ${priceWithPeriod(listing, amount)}`];
  if (listPrice != null && delta.deltaPct != null) {
    lines.push(`🏷️ Prix affiché : ${priceWithPeriod(listing, listPrice)} (écart : ${priceExtraction.formatPct(delta.deltaPct)})`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

const COMMUNE_SUBQUERY = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = ${CONTENT_LANGUAGE_ID}
  WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
  LIMIT 1
) AS commune`;

const LISTING_COLUMNS = `
  p.id, p.agent_id, p.price, p.purpose, p.price_period, p.reference,
  p.status, p.approve_status, p.listing_status, p.archived_at,
  pc.title, ${COMMUNE_SUBQUERY},
  a.phone AS agent_phone, a.phone_verified_at,
  (SELECT ai.first_name FROM agent_infos ai
    WHERE ai.agent_id = a.id AND ai.language_id = ${CONTENT_LANGUAGE_ID} AND COALESCE(ai.first_name, '') <> ''
    LIMIT 1) AS first_name`;

/** One listing with its agent — no approval filter: the handlers decide what a state allows. */
const LISTING_CONTEXT_SQL = `
  SELECT ${LISTING_COLUMNS}
    FROM properties p
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
    LEFT JOIN agents a ON a.id = p.agent_id
   WHERE p.id = $1
`;

/**
 * Listings due for the question. `to_jsonb(p) ->> 'development_id'` so a
 * database without the developer migration still answers; project units are
 * confirmed with their project, not one by one.
 */
const DUE_LISTINGS_SQL = `
  SELECT ${LISTING_COLUMNS}
    FROM properties p
    JOIN agents a ON a.id = p.agent_id
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = ${CONTENT_LANGUAGE_ID}
   WHERE p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') = 'active'
     AND a.status = 1 AND a.phone_verified_at IS NOT NULL AND COALESCE(a.phone, '') <> ''
     AND (to_jsonb(p) ->> 'development_id') IS NULL
     AND COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                  GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at)))
         < NOW() - ($1 || ' days')::interval
     AND NOT EXISTS (
       SELECT 1 FROM listing_availability_checks c
        WHERE c.property_id = p.id AND c.asked_at > NOW() - ($2 || ' days')::interval
     )
   ORDER BY p.agent_id,
            COALESCE(NULLIF(to_jsonb(p) ->> 'availability_confirmed_at', '')::timestamptz,
                     GREATEST(p.created_at, COALESCE(p.updated_at, p.created_at)))
   LIMIT $3
`;

/** Questions already sent to each agent since the start of this Kinshasa day. */
const ASKED_TODAY_SQL = `
  SELECT agent_id, COUNT(*)::int AS n
    FROM listing_availability_checks
   WHERE channel = 'WHATSAPP' AND asked_at >= $1::timestamptz AND agent_id = ANY($2::bigint[])
   GROUP BY agent_id
`;

const RECORD_ASK_SQL = `
  INSERT INTO listing_availability_checks (property_id, agent_id, channel, asked_at, previous_price)
  VALUES ($1, $2, 'WHATSAPP', NOW(), $3)
  RETURNING id
`;

/**
 * The answer lands on the most recent WhatsApp question about the listing
 * (within 30 days); an answer to nothing we can find is logged, not invented
 * into a row.
 */
const RECORD_ANSWER_SQL = `
  UPDATE listing_availability_checks
     SET answer = COALESCE($2, answer),
         answered_at = COALESCE(answered_at, NOW()),
         new_price = COALESCE($3, new_price),
         closed_price = COALESCE($4, closed_price),
         closed_via_platform = COALESCE($5, closed_via_platform)
   WHERE id = (
     SELECT id FROM listing_availability_checks
      WHERE property_id = $1 AND channel = 'WHATSAPP' AND asked_at > NOW() - interval '30 days'
      ORDER BY asked_at DESC
      LIMIT 1
   )
  RETURNING id
`;

/** Same WHERE as web's confirmListingAvailable: own listing, still live and active. */
const STAMP_CONFIRMED_SQL = `
  UPDATE properties SET availability_confirmed_at = NOW()
   WHERE id = $1 AND agent_id = $2
     AND status = 1 AND approve_status = 1
     AND COALESCE(listing_status, 'active') = 'active'
  RETURNING availability_confirmed_at
`;

async function loadListing(propertyId) {
  if (!pg.isConfigured()) return null;
  try {
    const { rows } = await pg.getPool().query(LISTING_CONTEXT_SQL, [propertyId]);
    return rows[0] || null;
  } catch (err) {
    console.error(`[availability] loading listing #${propertyId} failed: ${err.message}`);
    return null;
  }
}

async function recordAnswer(propertyId, { answer = null, newPrice = null, closedPrice = null, viaPlatform = null } = {}) {
  try {
    const { rows } = await pg.getPool().query(RECORD_ANSWER_SQL, [propertyId, answer, newPrice, closedPrice, viaPlatform]);
    if (!rows.length) console.warn(`[availability] answer for listing #${propertyId} matched no recorded question`);
    return rows.length > 0;
  } catch (err) {
    console.error(`[availability] recording the answer for listing #${propertyId} failed: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// State checks
// ---------------------------------------------------------------------------

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** The sender is this listing's agent, on a verified number. */
function isAuthorised(listing, from) {
  if (!listing?.agent_phone || !listing.phone_verified_at) return false;
  const agent = digits(listing.agent_phone);
  return Boolean(agent) && agent === digits(from);
}

/** On the site and on the market — what yes / no / price-changed need. */
function isLiveAndActive(listing) {
  return Number(listing?.status) === 1
    && Number(listing?.approve_status) === 1
    && (listing?.listing_status == null || listing.listing_status === 'active');
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function trySend(to, text, label) {
  try {
    await chakra.sendWhatsAppMessage(digits(to), text, { previewUrl: false });
    return true;
  } catch (err) {
    console.error(`[availability] ${label} to ${to} failed: ${err.message}`);
    return false;
  }
}

/**
 * Buttons where they work, numbered text where they do not. Returns the
 * channel that was accepted, or null.
 */
async function sendChoices(to, text, buttons, fallback, label) {
  try {
    await chakra.sendInteractiveButtons(digits(to), text, buttons);
    return 'buttons';
  } catch (err) {
    console.warn(`[availability] ${label}: buttons refused (${err.message}) — numbered text instead`);
    return (await trySend(to, `${text}\n${fallback}`, label)) ? 'session-numbered' : null;
  }
}

/** The check itself: template, then buttons, then numbered text. */
async function sendAsk(listing) {
  const to = digits(listing.agent_phone);
  const template = templateName();
  if (chakra.templateConfigured(template)) {
    try {
      await chakra.sendTemplate(to, template, {
        languageCode: templateLanguage(),
        bodyParams: templateParams(listing),
        buttons: askButtons(listing.id).map(({ id }) => ({ id })),
      });
      return 'template';
    } catch (err) {
      console.warn(`[availability] template '${template}' failed for listing #${listing.id}: ${err.message} — session message instead`);
    }
  }
  return sendChoices(to, askText(listing), askButtons(listing.id), ASK_FALLBACK, `ask #${listing.id}`);
}

function notifyOps(text, label) {
  // Lazily: viewingNotifications pulls in the whole viewing loop.
  // eslint-disable-next-line global-require
  return require('./viewingNotifications').notifyOps(text, label);
}

function opsLine(listing) {
  return `${listingLine(listing)} (#${listing.id}${listing.commune ? `, ${listing.commune}` : ''})`;
}

// ---------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------

async function answerYes(listing, from) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'yes');
  const { rows } = await pg.getPool().query(STAMP_CONFIRMED_SQL, [listing.id, listing.agent_id]);
  if (!rows.length) return alreadyUpdated(from, listing, 'yes');
  dbService.clearPendingListingAction(from);
  await recordAnswer(listing.id, { answer: ANSWERS.available });
  await trySend(from, CONFIRMED_TEXT, 'confirmed');
  console.log(`[availability] listing #${listing.id} confirmed available by ${from}`);
  return { action: 'confirmed' };
}

async function answerNo(listing, from) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'no');
  dbService.setPendingListingAction({ waId: from, kind: KINDS.gone, propertyId: listing.id });
  await sendChoices(from, goneText(listing), goneButtons(listing.id), GONE_FALLBACK, `gone #${listing.id}`);
  return { action: 'asked-what-happened', awaiting: KINDS.gone };
}

async function answerPriceChanged(listing, from) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'price');
  dbService.setPendingListingAction({ waId: from, kind: KINDS.newPrice, propertyId: listing.id });
  await trySend(from, newPriceAskText(listing), 'new price ask');
  return { action: 'asked-new-price', awaiting: KINDS.newPrice };
}

async function answerLet(listing, from) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'let');
  let retired = false;
  try {
    retired = await pg.markPropertyUnderOffer(listing.id);
  } catch (err) {
    console.error(`[availability] retiring listing #${listing.id} failed: ${err.message}`);
  }
  await recordAnswer(listing.id, { answer: ANSWERS.letOrSold });
  dbService.setPendingListingAction({ waId: from, kind: KINDS.closingPrice, propertyId: listing.id });
  await trySend(from, closingPriceAskText(listing), 'closing price ask');
  console.log(`[availability] listing #${listing.id} let/sold per ${from} — under_offer (written: ${retired})`);
  return { action: 'let-or-sold', retired, awaiting: KINDS.closingPrice };
}

async function answerWithdrawn(listing, from) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'withdrawn');
  let archived = false;
  try {
    archived = await pg.archivePropertyAsWithdrawn(listing.id);
  } catch (err) {
    console.error(`[availability] archiving listing #${listing.id} failed: ${err.message}`);
  }
  dbService.clearPendingListingAction(from);
  await recordAnswer(listing.id, { answer: ANSWERS.withdrawn });
  await trySend(from, withdrawnText(listing.id), 'withdrawn');
  await notifyOps(
    `${HEADER_BRAND} Disponibilité — retiré du marché (pas loué ni vendu)\n• ${opsLine(listing)}\n• Agent : ${from}`,
    'ops withdrawn note',
  );
  console.log(`[availability] listing #${listing.id} withdrawn per ${from} (archived: ${archived})`);
  return { action: 'withdrawn', archived };
}

/** A closing price: read back when unsure or far from asking, otherwise written. */
async function takeClosingPrice(listing, from, text) {
  const parsed = await priceExtraction.parseAgentPriceResponse(text);
  if (parsed.declined) {
    dbService.setPendingListingAction({ waId: from, kind: KINDS.viaPlatform, propertyId: listing.id });
    await trySend(from, SKIPPED_PRICE_TEXT, 'closing price skipped');
    await sendChoices(from, viaAskText(), viaButtons(listing.id), VIA_FALLBACK, `via #${listing.id}`);
    return { action: 'closing-price-skipped', awaiting: KINDS.viaPlatform };
  }
  if (parsed.amount === null) {
    if (parsed.reason === 'cdf') {
      await trySend(from, USD_ONLY_TEXT, 'closing price usd only');
      return { action: 'closing-price-needs-usd' };
    }
    return null;
  }
  if (parsed.needsConfirmation || priceNeedsReadBack(parsed.amount, listing.price)) {
    dbService.setPendingListingAction({
      waId: from, kind: KINDS.closingPriceConfirm, propertyId: listing.id, amount: parsed.amount,
    });
    await trySend(from, readBackText(parsed.amount, listing.price, { closing: true }), 'closing price read-back');
    return { action: 'closing-price-read-back', amount: parsed.amount, awaiting: KINDS.closingPriceConfirm };
  }
  return writeClosingPrice(listing, from, parsed.amount);
}

async function writeClosingPrice(listing, from, amount) {
  let recorded = false;
  let listPrice = listing.price != null ? Number(listing.price) : null;
  try {
    const result = await pg.recordSoldPrice(listing.id, amount, { source: 'WHATSAPP_AGENT_REPLY' });
    recorded = result.updated;
    if (result.listPrice != null) listPrice = result.listPrice;
  } catch (err) {
    console.error(`[availability] closing listing #${listing.id} failed: ${err.message}`);
  }
  await recordAnswer(listing.id, { closedPrice: amount });
  dbService.setPendingListingAction({ waId: from, kind: KINDS.viaPlatform, propertyId: listing.id });
  await trySend(from, closedReceiptText(listing, amount, listPrice), 'closing receipt');
  await sendChoices(from, viaAskText(), viaButtons(listing.id), VIA_FALLBACK, `via #${listing.id}`);
  console.log(`[availability] listing #${listing.id} closed at ${amount} (list ${listPrice ?? '?'}, written: ${recorded})`);
  return { action: 'closing-price-recorded', amount, recorded, listPrice, awaiting: KINDS.viaPlatform };
}

/** A new asking price: same read-back rule, then both stores. */
async function takeNewPrice(listing, from, text) {
  const parsed = await priceExtraction.parseAgentPriceResponse(text);
  if (parsed.declined) {
    dbService.clearPendingListingAction(from);
    await trySend(from, PRICE_UNCHANGED_TEXT, 'price unchanged');
    return { action: 'price-unchanged' };
  }
  if (parsed.amount === null) {
    if (parsed.reason === 'cdf') {
      await trySend(from, USD_ONLY_TEXT, 'new price usd only');
      return { action: 'new-price-needs-usd' };
    }
    return null;
  }
  if (parsed.needsConfirmation || priceNeedsReadBack(parsed.amount, listing.price)) {
    dbService.setPendingListingAction({
      waId: from, kind: KINDS.newPriceConfirm, propertyId: listing.id, amount: parsed.amount,
    });
    await trySend(from, readBackText(parsed.amount, listing.price), 'new price read-back');
    return { action: 'new-price-read-back', amount: parsed.amount, awaiting: KINDS.newPriceConfirm };
  }
  return writeNewPrice(listing, from, parsed.amount);
}

async function writeNewPrice(listing, from, amount) {
  if (!isLiveAndActive(listing)) return alreadyUpdated(from, listing, 'new-price');
  let result = { updated: false, previousPrice: null };
  try {
    result = await pg.setListingPrice(listing.id, amount, { source: 'WHATSAPP_AGENT_REPLY' });
  } catch (err) {
    console.error(`[availability] price change for listing #${listing.id} failed: ${err.message}`);
    dbService.clearPendingListingAction(from);
    await trySend(from, `${HEADER_BRAND} Désolé, le prix n'a pas pu être enregistré. Réessayez depuis votre espace : ${SITE_URL}/compte/agent/biens`, 'price failed');
    return { action: 'new-price-failed' };
  }
  dbService.clearPendingListingAction(from);
  if (result.updated) {
    await pg.getPool().query(STAMP_CONFIRMED_SQL, [listing.id, listing.agent_id]).catch((err) => {
      console.error(`[availability] stamping listing #${listing.id} after a price change failed: ${err.message}`);
    });
  }
  await recordAnswer(listing.id, { answer: ANSWERS.priceChanged, newPrice: amount });
  await trySend(from, priceUpdatedText(listing, amount, result.previousPrice), 'price updated');
  console.log(`[availability] listing #${listing.id} price ${result.previousPrice ?? '?'} -> ${amount} by ${from} (written: ${result.updated})`);
  return { action: 'new-price-recorded', amount, previousPrice: result.previousPrice, updated: result.updated };
}

async function answerVia(listing, from, viaPlatform) {
  dbService.clearPendingListingAction(from);
  await recordAnswer(listing.id, { viaPlatform });
  await trySend(from, `${HEADER_BRAND} Merci pour votre réponse ! 🙏`, 'via thanks');
  await notifyOps(
    [
      `${HEADER_BRAND} Disponibilité — loué / vendu`,
      `• ${opsLine(listing)}`,
      `• Client venu par Lukka Place : ${viaPlatform ? 'oui' : 'non'}`,
      `• Agent : ${from}`,
    ].join('\n'),
    'ops closed note',
  );
  return { action: 'via-platform-recorded', viaPlatform };
}

async function alreadyUpdated(from, listing, step) {
  dbService.clearPendingListingAction(from);
  await trySend(from, ALREADY_UPDATED_TEXT, 'already updated');
  console.log(`[availability] ${step} on listing #${listing?.id} from ${from} ignored — status ${listing?.listing_status ?? 'active'}/${listing?.status}`);
  return { action: 'already-updated' };
}

// ---------------------------------------------------------------------------
// Inbound: taps and typed answers
// ---------------------------------------------------------------------------

/**
 * A tapped availability button. `{ handled: false }` for any other id, so the
 * webhook moves on to the next handler.
 */
async function handleAvailabilityButtonReply({ from, replyId }) {
  const parsed = parseAvailabilityButtonId(replyId);
  if (!parsed) return { handled: false };

  const listing = await loadListing(parsed.propertyId);
  if (!listing || !isAuthorised(listing, from)) {
    console.warn(`[availability] button '${replyId}' from ${from} refused — ${listing ? 'not this listing\'s agent' : 'unknown listing'}`);
    return { handled: true, ignored: listing ? 'not-authorised' : 'unknown-listing' };
  }

  switch (parsed.action) {
    case 'yes': return { handled: true, ...(await answerYes(listing, from)) };
    case 'no': return { handled: true, ...(await answerNo(listing, from)) };
    case 'price': return { handled: true, ...(await answerPriceChanged(listing, from)) };
    case 'let': return { handled: true, ...(await answerLet(listing, from)) };
    case 'withdrawn': return { handled: true, ...(await answerWithdrawn(listing, from)) };
    default: {
      // via_yes / via_no: only after the listing left the market.
      if (isLiveAndActive(listing)) return { handled: true, ...(await alreadyUpdated(from, listing, parsed.action)) };
      return { handled: true, ...(await answerVia(listing, from, parsed.action === 'via_yes')) };
    }
  }
}

/**
 * A typed answer to the availability question this sender still owes.
 * Anything that is not a plausible answer returns `{ handled: false }` and
 * reaches ordinary processing — a property advert sent while a question is
 * open is still a property advert.
 */
async function handleAvailabilityTextReply({ from, text }) {
  const pending = dbService.getPendingListingAction(from);
  if (!pending) return { handled: false };

  const listing = await loadListing(pending.property_id);
  if (!listing || !isAuthorised(listing, from)) {
    dbService.clearPendingListingAction(from);
    return { handled: false };
  }

  switch (pending.kind) {
    case KINDS.response: {
      const answer = parseAskAnswer(text);
      if (!answer) return { handled: false };
      if (answer === 'yes') return { handled: true, ...(await answerYes(listing, from)) };
      if (answer === 'no') return { handled: true, ...(await answerNo(listing, from)) };
      return { handled: true, ...(await answerPriceChanged(listing, from)) };
    }
    case KINDS.gone: {
      const answer = parseGoneAnswer(text);
      if (!answer) return { handled: false };
      return { handled: true, ...(answer === 'let' ? await answerLet(listing, from) : await answerWithdrawn(listing, from)) };
    }
    case KINDS.closingPrice: {
      const outcome = await takeClosingPrice(listing, from, text);
      return outcome ? { handled: true, ...outcome } : { handled: false };
    }
    case KINDS.closingPriceConfirm:
    case KINDS.newPriceConfirm: {
      const closing = pending.kind === KINDS.closingPriceConfirm;
      const amount = Number(pending.amount);
      if (priceExtraction.isAffirmative(text) && Number.isFinite(amount) && amount > 0) {
        return { handled: true, ...(closing ? await writeClosingPrice(listing, from, amount) : await writeNewPrice(listing, from, amount)) };
      }
      // A figure typed in reply is the agent's own correction. Still subject
      // to the read-back rule: correcting 150 to 15 must not slip through.
      const corrected = priceExtraction.parseBarePrice(text);
      if (corrected !== null) {
        if (priceNeedsReadBack(corrected, listing.price) && corrected !== amount) {
          dbService.setPendingListingAction({ waId: from, kind: pending.kind, propertyId: listing.id, amount: corrected });
          await trySend(from, readBackText(corrected, listing.price, { closing }), 'price read-back again');
          return { handled: true, action: 'price-read-back', amount: corrected };
        }
        return { handled: true, ...(closing ? await writeClosingPrice(listing, from, corrected) : await writeNewPrice(listing, from, corrected)) };
      }
      if (priceExtraction.isPriceDeclined(text)) {
        const outcome = closing ? await takeClosingPrice(listing, from, 'passer') : await takeNewPrice(listing, from, 'passer');
        return { handled: true, ...outcome };
      }
      return { handled: false };
    }
    case KINDS.newPrice: {
      const outcome = await takeNewPrice(listing, from, text);
      return outcome ? { handled: true, ...outcome } : { handled: false };
    }
    case KINDS.viaPlatform: {
      const via = parseViaAnswer(text);
      if (via === null) return { handled: false };
      return { handled: true, ...(await answerVia(listing, from, via)) };
    }
    default:
      dbService.clearPendingListingAction(from);
      return { handled: false };
  }
}

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/** YYYY-MM-DD of `now` in Kinshasa (UTC+1, no DST). */
function kinshasaDay(now = new Date()) {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

function kinshasaDayStartUtc(now = new Date()) {
  return new Date(`${kinshasaDay(now)}T00:00:00+01:00`).toISOString();
}

function checkDue(now = new Date()) {
  if (!pg.isConfigured()) return false;
  if (now.getUTCHours() !== (CHECK_HOUR_KINSHASA + 23) % 24) return false;
  const last = dbService.getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  // job_runs stamps SQLite UTC `YYYY-MM-DD HH:MM:SS`.
  const at = Date.parse(`${String(last.succeeded_at).replace(' ', 'T')}Z`);
  return !Number.isFinite(at) || now.getTime() - at >= MIN_GAP_MS;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One daily pass. Returns what it did; throws only when it could not start
 * (the question log is missing), so the scheduler records a failure instead
 * of the job quietly asking again tomorrow.
 */
async function runAvailabilityCheck({ now = new Date(), pool = pg.getPool(), gapMs = SEND_GAP_MS } = {}) {
  const swept = dbService.sweepStalePendingListingActions(now.getTime());

  let due;
  try {
    ({ rows: due } = await pool.query(DUE_LISTINGS_SQL, [String(CONFIRM_AFTER_DAYS), String(ASK_INTERVAL_DAYS), MAX_DUE_PER_RUN]));
  } catch (err) {
    if (err.code === '42P01') {
      throw new Error('listing_availability_checks is missing — run migrations/20260929_listing_availability_checks.sql first');
    }
    throw err;
  }

  const byAgent = new Map();
  for (const listing of due) {
    const id = Number(listing.agent_id);
    byAgent.set(id, [...(byAgent.get(id) || []), listing]);
  }

  const askedToday = new Map();
  if (byAgent.size) {
    const { rows } = await pool.query(ASKED_TODAY_SQL, [kinshasaDayStartUtc(now), [...byAgent.keys()]]);
    for (const row of rows) askedToday.set(Number(row.agent_id), Number(row.n));
  }

  const tally = { due: due.length, asked: 0, failed: 0, agents: 0, skippedOpenQuestion: 0, skippedDailyCap: 0, swept };

  for (const [agentId, listings] of byAgent) {
    const phone = digits(listings[0].agent_phone);
    if (dbService.hasOpenAgentQuestion(phone)) {
      tally.skippedOpenQuestion += 1;
      continue;
    }
    let budget = MAX_ASKS_PER_AGENT_PER_DAY - (askedToday.get(agentId) || 0);
    if (budget <= 0) {
      tally.skippedDailyCap += 1;
      continue;
    }
    tally.agents += 1;

    for (const listing of listings) {
      if (budget <= 0) break;
      // Claimed before the send, so a crash between the two never re-asks
      // tomorrow; a send that fails releases the claim.
      const { rows } = await pool.query(RECORD_ASK_SQL, [listing.id, agentId, listing.price]);
      const checkId = rows[0]?.id;
      let delivery = null;
      try {
        delivery = await sendAsk(listing);
      } catch (err) {
        console.error(`[availability] asking about listing #${listing.id} failed: ${err.message}`);
      }
      if (!delivery) {
        tally.failed += 1;
        await pool.query('DELETE FROM listing_availability_checks WHERE id = $1', [checkId]).catch(() => {});
        break;
      }
      await pool.query('UPDATE listing_availability_checks SET delivery = $2 WHERE id = $1', [checkId, delivery]).catch(() => {});
      tally.asked += 1;
      budget -= 1;

      if (delivery === 'session-numbered') {
        // Text only: a typed "1" can mean just one question, so this agent
        // gets no other today, and this one claims their next message.
        dbService.setPendingListingAction({ waId: phone, kind: KINDS.response, propertyId: listing.id });
        break;
      }
      if (gapMs > 0) await sleep(gapMs);
    }
  }

  console.log(
    `[scheduler] ${JOB_NAME} — ${tally.asked} question(s) to ${tally.agents} agent(s), ${tally.due} due, `
      + `${tally.failed} failed, ${tally.skippedOpenQuestion} skipped (open question), ${tally.skippedDailyCap} at cap`,
  );
  return tally;
}

const availabilityCheckJob = { name: JOB_NAME, shouldRun: checkDue, run: () => runAvailabilityCheck() };

module.exports = {
  JOB_NAME,
  CONFIRM_AFTER_DAYS,
  ASK_INTERVAL_DAYS,
  MAX_ASKS_PER_AGENT_PER_DAY,
  PRICE_DEVIATION_LIMIT,
  KINDS,
  ANSWERS,
  DUE_LISTINGS_SQL,
  RECORD_ANSWER_SQL,
  STAMP_CONFIRMED_SQL,
  parseAvailabilityButtonId,
  parseAskAnswer,
  parseGoneAnswer,
  parseViaAnswer,
  priceNeedsReadBack,
  askButtons,
  goneButtons,
  viaButtons,
  askText,
  templateParams,
  listingLine,
  referenceLine,
  readBackText,
  isAuthorised,
  isLiveAndActive,
  checkDue,
  runAvailabilityCheck,
  handleAvailabilityButtonReply,
  handleAvailabilityTextReply,
  availabilityCheckJob,
};
