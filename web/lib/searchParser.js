/**
 * Parses a single free-text search string (the /listings search box, or a
 * Hero search) into the structured filters lib/listings.js's getListings()
 * already supports — so "2 chambres à louer sous 800$" produces a real
 * beds_min/transaction_type/price_max instead of a doomed literal-substring
 * search for that whole sentence.
 *
 * Written for how people in Kinshasa actually type, not for tidy input
 * (2026-09-23 pass — every phrase below was a real miss before it):
 *   - prices with no "sous"/"max": "500$", "800 usd", "1000 dollars",
 *     "1500usd", "1.5k", "budget 800", and ranges ("entre 500 et 1000",
 *     "500-800$", "de 300 à 600 $");
 *   - rooms as words ("deux chambres", Lingala "suku mibale"), as pièces
 *     ("3 pièces" = 2 chambres + salon), and "chambre salon" — the commonest
 *     rental phrase in the city, which used to resolve to the quartier
 *     Salongo;
 *   - abbreviations and typos ("appart", "apt", "appartemnt");
 *   - several places at once ("Gombe ou Ngaliema"), all searched;
 *   - "Kinshasa" meaning the city, not the commune of that name.
 *
 * Deliberately does NOT try to extract "meublé"/"piscine"/"forage" into a
 * structured filter: there is no `furnished` or amenity column on the public
 * `properties` table to filter against. Words like that are left in
 * `keywords` and reach the description search in lib/listings.js, which
 * matches each word on its own and drops them — saying so — when they would
 * empty the page. Filler ("pas cher", "near", "svp") is removed here, by
 * lib/searchKeywords.js, the same list the server applies.
 */
import { findLocationMention } from './gazetteer';
import { cleanKeywords } from './searchKeywords';

/** Most places one search may name — same ceiling as a customer request
 *  (MAX_REQUEST_COMMUNES) and the engine's leadCommunes. */
export const MAX_SEARCH_COMMUNES = 5;

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

// French, English, and Lingala (moko, mibale, misato, minei, mitano — the
// standard Lingala cardinals).
const NUMBER_WORDS = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  moko: 1, mibale: 2, misato: 3, minei: 4, mitano: 5,
};
const NUMBER_WORD_SOURCE = Object.keys(NUMBER_WORDS).join('|');
const COUNT = `(\\d{1,2}|${NUMBER_WORD_SOURCE})`;

function countValue(raw) {
  const lower = String(raw).toLowerCase();
  if (NUMBER_WORDS[lower] != null) return NUMBER_WORDS[lower];
  const n = Number.parseInt(lower, 10);
  return Number.isFinite(n) ? n : null;
}

// An amount as typed: "1500", "1 500", "1.500", "1,500", "1.5k", "2k",
// "150 mille". Capture 1 = the digits, capture 2 = a thousands suffix.
const AMT = '(\\d{1,3}(?:[ .,]\\d{3})+|\\d+(?:[.,]\\d+)?)(\\s*(?:k|mille)\\b)?';
const CUR = '(?:\\$|(?:us\\$|usd|dollars?|dol)\\b)';

/** Returns a number in dollars, or null. */
function parseAmount(digits, suffix) {
  if (!digits) return null;
  const compact = digits.replace(/\s/g, '');
  if (suffix && suffix.trim()) {
    const value = Number.parseFloat(compact.replace(',', '.'));
    return Number.isFinite(value) ? Math.round(value * 1000) : null;
  }
  const cleaned = compact.replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

const re = (source) => new RegExp(source, 'i');

// Ranges come first: "entre 500 et 1000" must not be read as a max of 500.
const PRICE_RANGE_PATTERNS = [
  re(`\\b(?:entre|between)\\s+\\$?\\s*${AMT}\\s*${CUR}?\\s*(?:et|and|-|–|à|a|to)\\s*\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\b(?:de|from)\\s+\\$?\\s*${AMT}\\s*${CUR}?\\s*(?:à|a|to|-|–)\\s*\\$?\\s*${AMT}\\s*${CUR}?`),
  // "500-800$", "$500 - $800": a currency sign somewhere makes it a price.
  re(`\\$\\s*${AMT}\\s*(?:-|–|à|to)\\s*\\$?\\s*${AMT}`),
  re(`(?:^|\\s)${AMT}\\s*(?:-|–|à|to)\\s*${AMT}\\s*${CUR}`),
  // "500-800" with no sign at all: two amounts that both look like rents.
  re(`(?:^|\\s)(\\d{3,6})()\\s*[-–]\\s*(\\d{3,6})()(?=\\s|$)`),
];

// English forms alongside the French ones — "under 800" was a real miss.
const PRICE_MAX_PATTERNS = [
  re(`\\bsous\\s+(?:les\\s+)?\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\b(?:pas\\s+plus\\s+de|moins\\s+de)\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\bmax(?:imum)?\\s*:?\\s*\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\bjusqu'?\\s*[àa]\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\bbudget\\s*(?:de|max(?:imum)?|:)?\\s*\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\b(?:under|below|up\\s+to|less\\s+than|max)\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\$?\\s*${AMT}\\s*${CUR}?\\s*max(?:imum)?\\b`),
];

// (?:^|\s) rather than \b before [àa]: JS's \b only recognizes ASCII word
// characters, so \bà never matches.
const PRICE_MIN_PATTERNS = [
  re(`(?:^|\\s)[àa]\\s+partir\\s+de\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\bplus\\s+de\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\bmin(?:imum)?\\s*:?\\s*\\$?\\s*${AMT}\\s*${CUR}?`),
  re(`\\b(?:over|above|more\\s+than|from)\\s+\\$?\\s*${AMT}\\s*${CUR}?`),
];

// An amount with a currency and no qualifier — "appart 500$", "800 usd".
// Read as a ceiling: nobody types their budget hoping to pay more.
const PRICE_BARE_CURRENCY_PATTERNS = [re(`\\$\\s*${AMT}`), re(`(?:^|\\s)${AMT}\\s*${CUR}`)];

// A standalone number with nothing around it ("maison lemba 400"). Only a
// whole word — "15x20" and "500m2" are dimensions, not prices — and only from
// 150 up, below which it is a street or door number far more often than a
// rent. Applied last, after rooms, references and qualified prices are gone.
const PRICE_BARE_NUMBER = re(`(?:^|\\s)(\\d{3,7}|\\d{1,3}(?:[ .,]\\d{3})+|\\d+(?:[.,]\\d+)?)(\\s*(?:k|mille)\\b)?(?=\\s|$)`);
const BARE_NUMBER_MIN = 150;

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

// "chambre salon", "1 chambre-salon", "2 chambres et salon", "ch+salon" — a
// unit with N bedrooms and a living room. Before this it resolved to the
// quartier Salongo.
const CHAMBRE_SALON_PATTERN = re(
  `(?:(?:^|\\s)${COUNT}\\s*)?\\b(?:chambres?|ch)\\s*(?:[-+&/]|et|\\s)\\s*salons?\\b`,
);

// Trilingual on purpose — the diaspora audience searches in English too
// ("2 bedroom apartment"). Lingala: suku/basuku (room), verified against
// dictionary sources when first added.
const BEDS_PATTERN = re(
  `(?:^|\\s)${COUNT}\\s*(?:chambres?|chambr|chbres?|chbrs?|chb|ch\\.?|bedrooms?|beds?|bd|br|basuku|sukus?|cukus?)\\b`,
);
// Lingala puts the number after the noun: "basuku mibale".
const BEDS_LINGALA_PATTERN = re(`\\b(?:basuku|suku)\\s+(moko|mibale|misato|minei|mitano)\\b`);
// "3 pièces" = 3 rooms counting the living room, i.e. 2 bedrooms.
const PIECES_PATTERN = re(`(?:^|\\s)${COUNT}\\s*(?:pi[eè]ces?|pcs?)\\b`);
const BATH_PATTERN = re(
  `(?:^|\\s)${COUNT}\\s*(?:salles?\\s+de\\s+bains?|sdb|bathrooms?|baths?|douches?)\\b`,
);

// ---------------------------------------------------------------------------
// Transaction and type
// ---------------------------------------------------------------------------

const TRANSACTION_TYPE_PATTERNS = [
  [/(?:^|\s)[àa]\s+louer\b/i, 'location'],
  [/\ben\s+location\b/i, 'location'],
  [/\blocation\b/i, 'location'],
  [/\blouer\b/i, 'location'],
  [/\b(?:to|for)\s+rent\b/i, 'location'],
  [/\brent(?:al|ing)?\b/i, 'location'],
  [/\bkofutela\b/i, 'location'],
  [/\bkofuta\b/i, 'location'],
  [/(?:^|\s)[àa]\s+vendre\b/i, 'vente'],
  [/\bvente\b/i, 'vente'],
  [/\bvendre\b/i, 'vente'],
  [/\b(?:achat|acheter|acqu[ée]rir)\b/i, 'vente'],
  [/\bfor\s+sale\b/i, 'vente'],
  [/\b(?:to\s+)?buy(?:ing)?\b/i, 'vente'],
  [/\bkosomba\b/i, 'vente'],
];

// Mapped only to real, currently-queryable values: "appartement" and
// "maison" are the live categories; "villa"/"terrain" exist as
// PARCELLE_SUBTYPES (lib/constants.js), never as a top-level property_type.
// `ap+ar?t\w*` covers appartement, appart, apparts, apartment, apartement and
// the typo "appartemnt"; `ap+t` covers apt/appt.
const PROPERTY_TYPE_PATTERNS = [
  [/\b(?:ap+ar?t\w*|ap+ts?|flats?|studios?)\b/i, { property_type: 'appartement' }],
  [/\bvillas?\b/i, { property_type: 'parcelle', parcelle_subtype: 'villa' }],
  [/\b(?:terrains?|plots?|land|lopango)\b/i, { property_type: 'parcelle', parcelle_subtype: 'terrain_nu' }],
  [/\b(?:maisons?|maisonnettes?|houses?|homes?|ndako|ndaku)\b/i, { property_type: 'maison' }],
];

// LKP-2026-0091 (services/openai.js's real generated format, engine repo) —
// tolerant of missing dashes/spaces and case. Also the informal ways a
// visitor might type a remembered reference: "réf 91", "ref: 91", "#91" —
// these carry only the trailing digits, matched as a loose ILIKE fallback.
const REFERENCE_PATTERNS = [
  { pattern: /\bLKP[-\s]?(\d{4})[-\s]?(\d+)\b/i, build: (m) => `LKP-${m[1]}-${m[2]}` },
  { pattern: /\b(?:r[ée]f(?:[ée]rence)?s?|ref)\s*[:\s]?\s*(\d+)\b/i, build: (m) => m[1] },
  { pattern: /#(\d+)\b/, build: (m) => m[1] },
];

// A locative word before a place ("à Ngaliema", "au Ma Campagne", "in
// Gombe", Lingala "na Ngaliema"), consumed with it so it never strands in
// the keywords.
const PREPOSITIONS = '(?:[àa]|au|aux|en|dans|de|du|des|vers|pr[eè]s\\s+de|c[oô]t[ée]\\s+de|in|at|near|around|na)';

// Kinshasa's centre-ville is Gombe; this is how people ask for it.
const DOWNTOWN_PATTERN = /(?:(?:^|\s)(?:[àa]u|in|dans\s+le)\s+)?\b(?:centre[\s-]?ville|kin[\s-]?centre|downtown|city\s+cent(?:er|re))\b/i;

// Exported so LocationAutocomplete's live preview can build the exact same
// kind of "remove this one matched span" regex.
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} text
 * @returns {{
 *   transaction_type: ('location'|'vente')|undefined,
 *   property_type: ('appartement'|'maison'|'parcelle')|undefined,
 *   parcelle_subtype: ('villa'|'terrain_nu')|undefined,
 *   reference: string|undefined,
 *   price_min: number|undefined,
 *   price_max: number|undefined,
 *   beds_min: number|undefined,
 *   bath_min: number|undefined,
 *   commune: string|undefined,
 *   communes: string[]|undefined,
 *   quartier: string|undefined,
 *   keywords: string,
 *   spans: Object<string, string|string[]>,
 * }}
 */
export function parseSearchQuery(text) {
  // typeof-checked rather than String(text || '') — a stray non-string (a
  // React SyntheticEvent) once reached production as the literal search
  // "[object Object]". This is the second layer of defense.
  let remaining = typeof text === 'string' ? text : '';
  const original = remaining.toLowerCase();
  const result = {};
  // The exact raw substring each field was parsed from — the live preview
  // removes one filter's own text from the input when its pill is tapped.
  const spans = {};

  function take(match, field) {
    spans[field] = spans[field] ? `${spans[field]} ${match[0].trim()}` : match[0].trim();
    remaining = remaining.replace(match[0], ' ');
  }

  // --- Reference ------------------------------------------------------------
  for (const { pattern, build } of REFERENCE_PATTERNS) {
    const m = remaining.match(pattern);
    if (!m) continue;
    result.reference = build(m);
    take(m, 'reference');
    break;
  }

  // --- Rooms (before prices, so "2 chambres 1 500$" is 2 rooms and $1,500) --
  const chambreSalon = remaining.match(CHAMBRE_SALON_PATTERN);
  if (chambreSalon) {
    const n = chambreSalon[1] != null ? countValue(chambreSalon[1]) : 1;
    if (n != null && n > 0) result.beds_min = n;
    take(chambreSalon, 'beds_min');
  }

  if (result.beds_min == null) {
    const beds = remaining.match(BEDS_PATTERN);
    const lingala = beds ? null : remaining.match(BEDS_LINGALA_PATTERN);
    const pieces = beds || lingala ? null : remaining.match(PIECES_PATTERN);
    if (beds) {
      const n = countValue(beds[1]);
      if (n != null && n > 0) result.beds_min = n;
      take(beds, 'beds_min');
    } else if (lingala) {
      result.beds_min = countValue(lingala[1]);
      take(lingala, 'beds_min');
    } else if (pieces) {
      const n = countValue(pieces[1]);
      // A studio is one pièce; it still has somewhere to sleep.
      if (n != null && n > 0) result.beds_min = Math.max(n - 1, 1);
      take(pieces, 'beds_min');
    }
  }

  const bath = remaining.match(BATH_PATTERN);
  if (bath) {
    const n = countValue(bath[1]);
    if (n != null && n > 0) result.bath_min = n;
    take(bath, 'bath_min');
  }

  // --- Price ----------------------------------------------------------------
  for (const pattern of PRICE_RANGE_PATTERNS) {
    const m = remaining.match(pattern);
    if (!m) continue;
    const a = parseAmount(m[1], m[2]);
    const b = parseAmount(m[3], m[4]);
    if (a == null || b == null) continue;
    result.price_min = Math.min(a, b);
    result.price_max = Math.max(a, b);
    take(m, 'price_max');
    spans.price_min = spans.price_max;
    break;
  }

  if (result.price_max == null) {
    for (const pattern of PRICE_MAX_PATTERNS) {
      const m = remaining.match(pattern);
      if (!m) continue;
      const amount = parseAmount(m[1], m[2]);
      if (amount == null) continue;
      result.price_max = amount;
      take(m, 'price_max');
      break;
    }
  }

  if (result.price_min == null) {
    for (const pattern of PRICE_MIN_PATTERNS) {
      const m = remaining.match(pattern);
      if (!m) continue;
      const amount = parseAmount(m[1], m[2]);
      if (amount == null) continue;
      result.price_min = amount;
      take(m, 'price_min');
      break;
    }
  }

  if (result.price_max == null && result.price_min == null) {
    for (const pattern of PRICE_BARE_CURRENCY_PATTERNS) {
      const m = remaining.match(pattern);
      if (!m) continue;
      const amount = parseAmount(m[1], m[2]);
      if (amount == null || amount <= 0) continue;
      result.price_max = amount;
      take(m, 'price_max');
      break;
    }
  }

  if (result.price_max == null && result.price_min == null) {
    const m = remaining.match(PRICE_BARE_NUMBER);
    if (m) {
      const amount = parseAmount(m[1], m[2]);
      if (amount != null && amount >= BARE_NUMBER_MIN) {
        result.price_max = amount;
        take(m, 'price_max');
      }
    }
  }

  // --- Transaction and type ---------------------------------------------------
  for (const [pattern, value] of TRANSACTION_TYPE_PATTERNS) {
    const m = remaining.match(pattern);
    if (!m) continue;
    result.transaction_type = value;
    take(m, 'transaction_type');
    break;
  }

  for (const [pattern, values] of PROPERTY_TYPE_PATTERNS) {
    const m = remaining.match(pattern);
    if (!m) continue;
    Object.assign(result, values);
    take(m, 'property_type');
    break;
  }

  // --- Places -----------------------------------------------------------------
  // Real communes/quartiers/landmarks (lib/gazetteer.js — the same curated
  // data LocationAutocomplete.js's dropdown uses). Up to five, all searched:
  // "Gombe ou Ngaliema" used to keep only one and drop the other in silence.
  //
  // `lookIn` is the text still searched for places; `remaining` is what
  // becomes keywords. They differ for a landmark ("Saint Luc"): its words
  // stay in the keywords, since there is no landmark column and the listing
  // text is where it shows up, but it must not be found twice.
  let lookIn = remaining;
  const places = [];
  const placeSpans = [];

  // "centre-ville" / "Kin centre" / "downtown" is how Kinshasa names Gombe.
  const downtown = lookIn.match(DOWNTOWN_PATTERN);
  if (downtown) {
    lookIn = lookIn.replace(downtown[0], ' ');
    remaining = remaining.replace(downtown[0], ' ');
    places.push({ type: 'commune', label: 'Gombe', commune: 'Gombe', matchedText: downtown[0].trim(), alsoIn: [] });
    placeSpans.push(downtown[0].trim());
  }

  for (let guard = 0; guard < 8 && places.length < MAX_SEARCH_COMMUNES; guard += 1) {
    const location = findLocationMention(lookIn);
    if (!location) break;

    const prepositionPattern = new RegExp(
      `(?:(?:^|\\s)${PREPOSITIONS}\\s+)?${escapeRegExp(location.matchedText)}`,
      'i',
    );

    // "Kinshasa" is the city every listing is in far more often than the
    // commune of that name — unless the visitor says "commune de Kinshasa".
    const isCityName =
      location.type === 'commune' &&
      location.commune === 'Kinshasa' &&
      !new RegExp(`commune\\s+(?:de\\s+)?${escapeRegExp(location.matchedText)}`, 'i').test(lookIn);

    const spanMatch = lookIn.match(prepositionPattern);
    lookIn = lookIn.replace(prepositionPattern, ' ');

    if (isCityName) {
      remaining = remaining.replace(prepositionPattern, ' ');
      continue;
    }

    if (location.type !== 'landmark') {
      remaining = remaining.replace(prepositionPattern, ' ');
    }
    places.push(location);
    placeSpans.push(spanMatch ? spanMatch[0].trim() : location.matchedText);
  }

  if (places.length > 0) {
    // In the order the visitor typed them: the first place named is the one
    // the heading, the map and a single-commune reader use.
    const order = places.map((place, i) => ({ place, span: placeSpans[i], at: original.indexOf(String(placeSpans[i]).toLowerCase()) }));
    order.sort((a, b) => (a.at === -1 ? Infinity : a.at) - (b.at === -1 ? Infinity : b.at));
    places.splice(0, places.length, ...order.map((o) => o.place));
    placeSpans.splice(0, placeSpans.length, ...order.map((o) => o.span));

    const [primary] = places;
    result.commune = primary.commune;
    // A single named quartier narrows to it. Two different places in one
    // search ("Binza ou Ma Campagne") mean the area around both — searching
    // one quartier would drop the other.
    const quartiers = new Set(places.filter((p) => p.type === 'quartier').map((p) => p.label));
    if (primary.type === 'quartier' && places.every((p) => p.type === 'quartier') && quartiers.size === 1) {
      result.quartier = primary.label;
    }
    const communes = [];
    for (const place of places) {
      for (const name of [place.commune, ...(place.alsoIn || [])]) {
        if (!communes.includes(name) && communes.length < MAX_SEARCH_COMMUNES) communes.push(name);
      }
    }
    if (communes.length > 1) result.communes = communes;
    spans.commune = placeSpans.length === 1 ? placeSpans[0] : placeSpans;
  }

  result.keywords = cleanKeywords(remaining);
  result.spans = spans;
  return result;
}
