/**
 * Is a group batch worth sending to the engine?
 *
 * Brokers' groups are mostly listings, but not only: "bonjour la famille",
 * "toujours dispo ?", stickers, voice notes. Every batch the engine receives
 * costs an extraction call, so chatter is dropped here. A batch goes through
 * when it carries a photo, or when its text names a kind of property AND a
 * price — the same rule as the engine's services/listingBoundary.js
 * `standsAloneAsListing`.
 *
 * DUPLICATED ON PURPOSE from services/listingBoundary.js (fold, FAMILY_WORDS,
 * OFFER_WORDS, pricesIn, MIN_LISTING_LENGTH): this service is deployed and run
 * on its own and must not require engine modules. Change one, change the other.
 */

'use strict';

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

/** Every amount the text states as money: "1100$", "$ 1.100", "1 100 USD", "loyer : 800". */
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

/** A kind of property (or offer wording) AND a price, and more than a couple of words. */
function standsAloneAsListing(text) {
  const folded = fold(text);
  if (folded.length < MIN_LISTING_LENGTH) return false;
  const namesProperty = familiesIn(folded).length > 0 || OFFER_WORDS.test(folded);
  return namesProperty && pricesIn(folded).length > 0;
}

/**
 * @param {{ text: string, photoCount: number }} batch
 * @returns {boolean}
 */
function shouldForward({ text, photoCount }) {
  if (photoCount > 0) return true;
  return standsAloneAsListing(text);
}

module.exports = { shouldForward, standsAloneAsListing, pricesIn, familiesIn, fold };
