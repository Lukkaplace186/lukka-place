/**
 * services/priceExtraction.js
 *
 * Reading "what did it close at?" out of an agent's WhatsApp reply.
 *
 * WHY NOT THE ONE-LINE REGEX
 * `/\b(\d{3,6})\s*(?:\$|usd|dollars)?\b/i` was the spec's suggestion, and on
 * real replies it is wrong in both directions: it reads "2026" out of
 * "loué en septembre 2026", misses a $80 rent entirely, and splits "1 100 $"
 * into 1 and 100. A closing price is the one figure the market export exists
 * to hold, so a wrong one is worse than none.
 *
 * THREE TIERS, most certain first
 *   1. exact  — the whole reply is a bare amount ("700", "1 100 $"). Saved
 *               directly, exactly as the anchored parser always did.
 *   2. regex  — one amount found inside a short sentence ("vendu à 700$").
 *   3. llm    — number words ("sept cents dollars") or several numbers. The
 *               model's answer is only accepted when it matches a number that
 *               is literally in the text (or the text has no digits at all),
 *               so it can pick between candidates but never invent one.
 * Tiers 2 and 3 set `needsConfirmation`: the figure is read back to the agent
 * and nothing is written until they say OUI.
 *
 * WHAT IS REFUSED, never guessed
 *   - a long message or one that reads like a property advert — that is a new
 *     listing arriving while a question is open, and must fall through to
 *     intake rather than close a transaction;
 *   - an amount in francs — we asked in USD and a conversion would be a
 *     number nobody agreed to;
 *   - anything the model cannot tie back to the text.
 *
 * Shared by services/viewingNotifications.js (the decline survey) and
 * routes/webhook.js (the "c'est loué" status flow). It requires neither of
 * them, which is what finally lets the two stop carrying duplicate copies of
 * the bare-amount parser.
 */

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

/** Anything longer is a message, not an answer to "quel prix ?". */
const MAX_ANSWER_LENGTH = 80;

/** Rent in Kinshasa does go below $100; a lone digit is a menu choice. */
const MIN_AMOUNT = 10;
const MAX_AMOUNT = 50_000_000;

function fold(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * The whole reply is an amount: "1200", "1 200", "1200$", "1.200 USD".
 * Anchored on purpose — a sentence that merely CONTAINS a number is handled by
 * the tiers below, with a confirmation step, never here.
 */
function parseBarePrice(text) {
  const raw = String(text || '').trim();
  const match = /^([\d][\d\s.,]*)\s*(?:\$|usd|dollars?)?$/i.exec(raw);
  if (!match) return null;
  const digits = match[1].replace(/[\s.,]/g, '');
  if (!digits) return null;
  const amount = Number.parseInt(digits, 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** "passer", "non", "skip" — declining to state the price. */
function isPriceDeclined(text) {
  return /^(?:passer?|non|no|skip|prefere?\s*pas|je\s*prefere\s*pas|pas\s*maintenant)[\s!.]*$/.test(fold(text));
}

/** "oui", "ok", "c'est ça" — confirming a figure we read back. */
function isAffirmative(text) {
  return /^(?:oui|ok|okay|d'?accord|c'?est\s*(?:ca|bon|exact|correct)|exact|correct|confirme[rz]?|yes|👍)[\s!.]*$/.test(fold(text));
}

/** Words that mean the message is a property advert, not a price. */
const LISTING_VOCABULARY =
  /\b(chambres?|salons?|douches?|cuisine|parcelle|appartement|maison|villa|studio|terrain|a\s+louer|a\s+vendre|garantie|m2|commune|quartier|portes?)\b|m²/;

const CDF_MARKER = /\b(fc|cdf|francs?)\b/;

const NUMBER_WORDS =
  /\b(cents?|mille|millions?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingts?|trente|quarante|cinquante|soixante)\b/;

/**
 * Every plausible amount in a short reply.
 *
 * Thousand-grouped figures ("1 100", "1.100", "12,500") are read whole; a
 * trailing "k" multiplies. Numbers followed by a unit that is not money
 * ("3 mois", "2 chambres", "10 %") are dropped, and so is anything outside
 * [MIN_AMOUNT, MAX_AMOUNT].
 */
function findAmountCandidates(text) {
  const raw = String(text || '');
  const re = /(\$\s*)?(\d{1,3}(?:[ .,  ]\d{3})+(?!\d)|\d+(?:[.,]\d+)?)\s*(k\b)?\s*(\$|usd\b|dollars?\b)?/gi;
  const out = [];
  let match;
  while ((match = re.exec(raw)) !== null) {
    const [whole, prefix, number, kilo, suffix] = match;
    const after = fold(raw.slice(match.index + whole.length, match.index + whole.length + 12));
    if (/^\s*(%|mois|ans?\b|chambres?|jours?|h\b|heures?)/.test(after)) continue;

    let amount;
    if (/^\d{1,3}(?:[ .,  ]\d{3})+$/.test(number)) {
      amount = Number.parseInt(number.replace(/[^\d]/g, ''), 10);
    } else {
      amount = Number.parseFloat(number.replace(',', '.'));
    }
    if (kilo) amount *= 1000;
    amount = Math.round(amount * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) continue;

    out.push({ amount, marked: Boolean(prefix || suffix || kilo) });
  }
  return out;
}

/**
 * The model tier. Replaced in scripts/verify-pipeline.js through
 * `module.exports.extractPriceWithModel`, which is why callers below go
 * through the exports object rather than the local binding.
 *
 * @returns {Promise<{amount_usd: number|null, currency: 'USD'|'CDF'|'UNKNOWN'}>}
 */
async function extractPriceWithModel(text) {
  // Lazy: services/openai.js requires viewingNotifications, which requires
  // this module — a top-level require would load a half-built openai.js.
  const { getClient } = require('./openai');
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'closing_price',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['amount_usd', 'currency'],
          properties: {
            amount_usd: { type: ['number', 'null'] },
            currency: { type: 'string', enum: ['USD', 'CDF', 'UNKNOWN'] },
          },
        },
      },
    },
    messages: [
      {
        role: 'system',
        content:
          "Un agent immobilier de Kinshasa répond à la question « Quel a été le prix final conclu (en USD) ? ». "
          + 'Extrais le montant final conclu. Si le message ne contient pas de montant final clair, '
          + "renvoie amount_usd: null. N'invente jamais de montant, ne convertis jamais de francs congolais : "
          + 'un montant en FC/CDF se renvoie avec currency "CDF". Un montant sans devise est "UNKNOWN".',
      },
      { role: 'user', content: String(text) },
    ],
  });
  const content = completion.choices?.[0]?.message?.content;
  return content ? JSON.parse(content) : null;
}

/**
 * @param {string} text The agent's reply.
 * @returns {Promise<{
 *   amount: number|null,
 *   source?: 'exact'|'regex'|'llm',
 *   needsConfirmation?: boolean,
 *   declined?: boolean,
 *   reason?: string,
 * }>}
 */
async function parseAgentPriceResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) return { amount: null, reason: 'empty' };
  if (isPriceDeclined(raw)) return { amount: null, declined: true };

  const bare = parseBarePrice(raw);
  if (bare !== null) return { amount: bare, source: 'exact', needsConfirmation: false };

  const folded = fold(raw);
  if (raw.length > MAX_ANSWER_LENGTH || LISTING_VOCABULARY.test(folded)) {
    return { amount: null, reason: 'not-an-answer' };
  }
  if (CDF_MARKER.test(folded)) return { amount: null, reason: 'cdf' };

  const candidates = findAmountCandidates(raw);
  const marked = candidates.filter((c) => c.marked);
  const pick = candidates.length === 1 ? candidates[0] : marked.length === 1 ? marked[0] : null;
  if (pick) return { amount: pick.amount, source: 'regex', needsConfirmation: true };

  if (candidates.length < 2 && !NUMBER_WORDS.test(folded)) {
    return { amount: null, reason: 'no-amount' };
  }

  let answer;
  try {
    answer = await module.exports.extractPriceWithModel(raw);
  } catch (err) {
    console.error(`[price] model extraction failed: ${err.message}`);
    return { amount: null, reason: 'model-failed' };
  }

  const value = Number(answer?.amount_usd);
  if (!answer || answer.currency === 'CDF' || !Number.isFinite(value) || value < MIN_AMOUNT || value > MAX_AMOUNT) {
    return { amount: null, reason: 'model-no-amount' };
  }
  const amount = Math.round(value * 100) / 100;
  // The model may choose among the numbers in the text, never add one.
  const hasDigits = /\d/.test(raw);
  if (hasDigits && !candidates.some((c) => c.amount === amount)) {
    return { amount: null, reason: 'model-unsupported' };
  }
  return { amount, source: 'llm', needsConfirmation: true };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * sold − list, and that as a percentage of list. Negative is the normal case
 * (it closed below asking). Null when there is no real asking price to measure
 * against — a delta against 0 or a missing price is not a discount.
 */
function computePriceDelta(listPrice, soldPrice) {
  const list = Number(listPrice);
  const sold = Number(soldPrice);
  if (!Number.isFinite(list) || list <= 0 || !Number.isFinite(sold) || sold <= 0) {
    return { deltaUsd: null, deltaPct: null };
  }
  const deltaUsd = round2(sold - list);
  return { deltaUsd, deltaPct: round2((deltaUsd / list) * 100) };
}

/** "1 100 $" — the figure as an agent reads it back. */
function formatUsd(amount) {
  return `${Number(amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $`;
}

/** "−6,7 %" / "+2 %" — signed, French decimal comma. */
function formatPct(pct) {
  if (pct == null) return null;
  const rounded = Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('fr-FR')} %`;
}

module.exports = {
  parseAgentPriceResponse,
  parseBarePrice,
  isPriceDeclined,
  isAffirmative,
  findAmountCandidates,
  extractPriceWithModel,
  computePriceDelta,
  formatUsd,
  formatPct,
  MAX_ANSWER_LENGTH,
  MIN_AMOUNT,
};
