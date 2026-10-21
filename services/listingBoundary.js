/**
 * Is this burst a NEW listing, or a correction of the one in context?
 *
 * The model answers that question itself, and with a draft (or a recently
 * published listing) in context the prompt tells it to lean hard towards
 * "correction" (services/openai.js, BOUCLE DE CORRECTION). For an agent who
 * posts listing after listing, that lean is wrong: measured on 2026-10-20, one
 * sender's complete listings — 8 photos, a price, "OFFRE DE LOCATION…" — came
 * back `is_listing: false` and were merged into the previous property as
 * "corrections", one of them into the agent's NAME at onboarding. Nothing was
 * dropped; whole properties were folded into other ones.
 *
 * So the boundary is decided here, deterministically, from what THIS message
 * says — never from the extraction, which in correction mode is the merged
 * draft and cannot tell what the new message contributed.
 *
 *  - A message that stands alone as a listing (names a kind of property AND
 *    states a price) and carries photos is a new listing, unless every core
 *    fact it states matches the listing in context (a restatement of it).
 *  - Without photos, it is a new listing only when the model itself called it
 *    one (intent 'listing'), it is long enough to be a description rather than
 *    an edit, and a core fact — price, kind of property, commune — differs.
 *  - With nothing in context (only the onboarding name question open), a
 *    text that stands alone and that the model called a listing is one.
 *  - Correction wording ("pas X mais Y", "au lieu de", a leading "non") vetoes
 *    both: "non, c'est une villa à 1500$" is the correction loop working.
 *
 * Short edits ("non 1100$", "4 chambres", "c'est à Limete") never qualify: they
 * name no kind of property, or no price, which is what keeps the correction
 * loop intact.
 */

'use strict';

const { COMMUNES, placeKey } = require('./locations');

/** Shortest text that can be a self-standing description without photos. */
const MIN_TEXT_ONLY_LENGTH = 80;
/** Shortest text that can be a self-standing description at all. */
const MIN_LISTING_LENGTH = 25;

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Coarse families, so "villa" vs "parcelle" (one classification question) is not a difference. */
const FAMILY_WORDS = [
  ['appartement', /\b(?:appartements?|apartements?|appart|studios?|flat)\b/],
  ['maison', /\b(?:villas?|maisons?|parcelles?|duplex|pavillon|complexe|type locataire|portes)\b/],
  ['terrain', /\b(?:terrains?|lopin)\b/],
  ['commercial', /\b(?:bureaux?|boutiques?|entrepots?|magasins?|immeubles?|locaux commerciaux|local commercial|hangar)\b/],
];

/** Words that make a text read as a property offer even when no family word is present. */
const OFFER_WORDS = /\b(?:a louer|a vendre|en location|en vente|location|offre de location|chambres? a coucher|\d+\s*(?:ch|chambres?|pieces?)\b)/;

function familiesIn(text) {
  const folded = fold(text);
  return FAMILY_WORDS.filter(([, re]) => re.test(folded)).map(([family]) => family);
}

function familyOfListing(row) {
  if (!row) return null;
  const type = fold(row.property_type);
  if (!type) return null;
  for (const [family, re] of FAMILY_WORDS) {
    if (family === type || re.test(type)) return family;
  }
  if (type === 'parcelle') return row.parcelle_subtype === 'terrain_nu' ? 'terrain' : 'maison';
  return null;
}

/**
 * Every amount the text states as money: "1100$", "$ 1.100", "1 100 USD",
 * "loyer : 800", "prix 85 000". Thousands separators are folded away; a
 * decimal comma ("1,5") is not a price this market quotes.
 */
function pricesIn(text) {
  const folded = fold(text);
  const amounts = new Set();
  const toNumber = (raw) => {
    const digits = String(raw).replace(/[\s.,]/g, '');
    const n = Number.parseInt(digits, 10);
    return Number.isFinite(n) ? n : null;
  };
  const patterns = [
    /(\d{1,3}(?:[ .,]\d{3})+|\d+)\s*(?:\$|usd|us\$|dollars?|fc|cdf|francs?)/g,
    /(?:\$|usd)\s*(\d{1,3}(?:[ .,]\d{3})+|\d+)/g,
    /\b(?:loyer|prix|montant|cout)\s*(?:mensuel\s*)?(?:est\s*(?:de\s*)?)?[:=]?\s*(\d{1,3}(?:[ .,]\d{3})+|\d+)/g,
  ];
  for (const re of patterns) {
    for (const match of folded.matchAll(re)) {
      const n = toNumber(match[1]);
      if (n && n >= 10) amounts.add(n);
    }
  }
  return [...amounts];
}

/** Communes the text names outright (word-bounded, accent- and case-folded). */
function communesIn(text) {
  const key = ` ${placeKey(text)} `;
  return COMMUNES.filter((commune) => {
    const ck = placeKey(commune);
    return ck && key.includes(` ${ck} `);
  });
}

/** The wording of an edit. A listing never opens with "non" or says "au lieu de". */
function readsAsCorrection(text) {
  const folded = fold(text);
  return /^(?:non|nn|nan|pardon|erreur|correction)\b/.test(folded)
    || /\bau lieu de\b/.test(folded)
    || /\bet non (?:pas )?\d/.test(folded)
    || /\bpas\b[^.!?\n]{1,40}\bmais\b/.test(folded)
    || /\bc(?:'| )?est pas\b/.test(folded)
    || /\bplutot\b/.test(folded)
    || /\bje (?:corrige|rectifie)\b/.test(folded);
}

/**
 * Does the text, by itself, describe a property on offer? A kind of property
 * (or offer wording) AND a price, and more than a couple of words.
 */
function standsAloneAsListing(text) {
  const folded = fold(text);
  if (folded.length < MIN_LISTING_LENGTH) return false;
  const namesProperty = familiesIn(folded).length > 0 || OFFER_WORDS.test(folded);
  return namesProperty && pricesIn(folded).length > 0;
}

/**
 * Which core facts of the text contradict the listing in context.
 * Only facts BOTH sides state can differ; an unknown is never a difference.
 */
function coreDifferences(text, row) {
  const differences = [];
  if (!row) return differences;

  const prices = pricesIn(text);
  const rowPrice = Number(row.price);
  if (prices.length && Number.isFinite(rowPrice) && rowPrice > 0) {
    const matches = prices.some((p) => Math.abs(p - rowPrice) <= Math.max(1, rowPrice * 0.01));
    if (!matches) differences.push('price');
  }

  const families = familiesIn(text);
  const rowFamily = familyOfListing(row);
  if (families.length === 1 && rowFamily && families[0] !== rowFamily) differences.push('property_type');

  const communes = communesIn(text);
  if (communes.length && row.commune) {
    const rowKey = placeKey(row.commune);
    if (!communes.some((c) => placeKey(c) === rowKey)) differences.push('commune');
  }

  return differences;
}

/**
 * The decision. Returns null (leave the model's verdict alone) or the reason
 * the burst must be stored as its own listing.
 *
 * @param {Object} input
 * @param {string} input.text        The burst's combined text (captions included).
 * @param {number} input.photoCount  Photos in THIS burst.
 * @param {string} [input.intent]    The model's intent for the burst.
 * @param {Object} [input.context]   The listing the model was told this is about.
 * @returns {{reason: string, differences: string[]}|null}
 */
function newListingReason({ text, photoCount = 0, intent = null, context = null } = {}) {
  if (!standsAloneAsListing(text) || readsAsCorrection(text)) return null;

  const differences = coreDifferences(text, context);

  if (photoCount > 0) {
    // Every core fact it states agrees with the listing in context, and it
    // states at least one: the agent re-sent the same property with photos.
    const agrees = context && differences.length === 0
      && (pricesIn(text).length || communesIn(text).length);
    if (agrees) return null;
    return { reason: 'photos-and-own-listing', differences };
  }

  if (intent !== 'listing') return null;
  // Nothing in context (the name question is what is open): there is no
  // listing to correct, so the model's own "listing" is the whole question.
  if (!context) return { reason: 'own-listing', differences };
  if (fold(text).length < MIN_TEXT_ONLY_LENGTH) return null;
  if (!differences.length) return null;
  return { reason: 'core-fields-differ', differences };
}

module.exports = {
  newListingReason,
  standsAloneAsListing,
  readsAsCorrection,
  coreDifferences,
  pricesIn,
  communesIn,
  familiesIn,
  MIN_TEXT_ONLY_LENGTH,
};
