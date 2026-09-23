/**
 * The words left over once lib/searchParser.js has taken out everything it
 * understood (price, rooms, type, place) — turned into the tokens the
 * listings query actually matches on.
 *
 * WHY TOKENS, NOT ONE PHRASE. The leftover text used to reach lib/listings.js
 * as a single ILIKE phrase, so one filler word sank a whole search:
 * "maison à louer Lemba pas cher" asked every listing to contain the literal
 * text "pas cher", and "appart 2ch gombe 500$" the text "appart 500$". Both
 * returned nothing while matching listings were live. Now filler is dropped
 * here, each remaining word is matched on its own (any order, any column),
 * and lib/listings.js drops the words entirely — and says so — when they
 * would still empty the page.
 *
 * Pure and dependency-free: the parser (client) and the query (server) share
 * it, so both sides agree on what counts as a real word.
 */

/** "Mamán Yémo" -> "maman yemo". Same folding the SQL side applies. */
export function foldAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .toLowerCase();
}

/**
 * Words that carry no search meaning on their own — connectors, politeness,
 * "I'm looking for", price talk the parser has already read (or cannot), and
 * the city itself (every listing is in Kinshasa). French, English and the
 * Lingala a Kinshasa visitor actually mixes in.
 *
 * Deliberately NOT here: anything that describes the property ("meublé",
 * "piscine", "duplex", "forage", "groupe"). Those are real requests and must
 * reach the description search.
 */
const FILLER = new Set([
  // French connectors and articles
  'a', 'au', 'aux', 'avec', 'ce', 'ces', 'cet', 'cette', 'dans', 'de', 'des', 'du', 'd', 'en', 'et', 'l', 'la',
  'le', 'les', 'ma', 'mes', 'mon', 'ou', 'par', 'pour', 'pres', 'proche', 'qui', 'que', 'sur', 'un', 'une', 'vers',
  'y', 'cote', 'autour', 'environ', 'aussi', 'tres', 'plus', 'moins', 'sous', 'entre', 'max', 'maximum', 'min',
  'minimum', 'jusqu', 'jusque', 'partir', 'dispo', 'disponible', 'disponibles', 'commune', 'quartier',
  'avenue', 'av', 'rue', 'numero', 'no', 'zone', 'secteur', 'coin',
  // Size and taste words nobody's listing text reliably carries
  'petit', 'petite', 'petits', 'petites', 'grand', 'grande', 'grands', 'grandes', 'joli', 'jolie', 'beau', 'bel',
  'belle', 'bonne', 'super', 'top', 'nice', 'good', 'big', 'small',
  // Asking / wanting
  'je', 'j', 'cherche', 'recherche', 'recherchons', 'cherchons', 'veux', 'voudrais', 'besoin', 'svp', 'stp',
  'merci', 'bonjour', 'urgent', 'urgence', 'vite', 'bien', 'biens', 'propriete', 'proprietes', 'annonce',
  'annonces', 'offre', 'offres', 'logement', 'logements',
  // Price talk (the number itself is read by the parser; these are the rest)
  'budget', 'prix', 'cher', 'chere', 'pas', 'bon', 'marche', 'abordable', 'moyen', 'loyer', 'mois', 'mensuel',
  'dollar', 'dollars', 'usd', 'us', 'fc', 'franc', 'francs', 'cdf', 'k',
  // English
  'the', 'an', 'in', 'at', 'on', 'near', 'nearby', 'around', 'with', 'for', 'of', 'to', 'and', 'or', 'i', 'im',
  'looking', 'want', 'need', 'please', 'cheap', 'affordable', 'under', 'below', 'over', 'above', 'less', 'than',
  'more', 'per', 'month', 'property', 'properties', 'listing', 'listings', 'available',
  // Lingala
  'na', 'ya', 'nazali', 'naluki', 'nalingi', 'po', 'mpo',
  // The city — every listing is in it
  'kinshasa', 'kin', 'kinsasa', 'rdc', 'drc', 'congo', 'ville',
]);

/** A bare number or a currency sign: already read by the parser, or unreadable. */
function isNumberish(word) {
  return /^[\d.,$€%+/-]+[k]?$/.test(word);
}

/**
 * @param {string} text  leftover keywords (or a raw `q` param)
 * @returns {string[]}  folded, de-duplicated words worth matching
 */
export function keywordTokens(text) {
  const words = foldAccents(text)
    // Apostrophes split elisions ("l'upn" -> "l", "upn"); anything that is not
    // a letter or digit separates words.
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const out = [];
  for (const word of words) {
    if (FILLER.has(word)) continue;
    if (isNumberish(word)) continue;
    // One letter is never a search on its own (a stray "l", "d", "s").
    if (word.length < 2) continue;
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * The leftover text a visitor sees in the URL: the kept words, in order, with
 * their own spelling ("meublé", not "meuble") — only the filler is gone.
 */
export function cleanKeywords(text) {
  const kept = new Set(keywordTokens(text));
  const out = [];
  const seen = new Set();
  for (const word of String(text || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const folded = foldAccents(word);
    if (!kept.has(folded) || seen.has(folded)) continue;
    seen.add(folded);
    out.push(word.toLowerCase());
  }
  return out.join(' ');
}
