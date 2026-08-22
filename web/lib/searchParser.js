/**
 * Parses a single free-text search string (the /listings search box, or a
 * Hero search) into the structured filters lib/listings.js's getListings()
 * already supports — so "2 chambres à louer sous 800$" produces a real
 * beds_min/transaction_type/price_max instead of a doomed literal-substring
 * search for that whole sentence.
 *
 * Deliberately does NOT try to extract "meublé"/"piscine"/"forage" into a
 * structured filter: the AI intake parser (services/openai.js, engine repo)
 * does capture a free-text `amenities` array and `furnished` boolean, but
 * services/postgres.js's sync path never writes either past the local
 * intake queue — there is no `furnished` or amenity column on the public
 * `properties` table to filter against. Words like that are left in
 * `keywords` and ride the real ILIKE fallback in lib/listings.js
 * (title/description/address/quartier/reference/commune) instead of being
 * silently dropped or filtered against a column that doesn't exist.
 */
import { findLocationMention } from './gazetteer';

// English forms added alongside the French ones — a real gap found while
// testing "under 800": bilingual was previously only applied to
// beds/bath/transaction/property-type, not price.
const PRICE_MAX_PATTERNS = [
  /\bsous\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bmoins\s+de\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bmax(?:imum)?\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bjusqu'?[àa]\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bunder\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bbelow\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bless\s+than\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\$?\s*([\d.,]+)\s*\$?\s*max(?:imum)?\b/i,
];

// (?:^|\s) rather than \b before [àa]: JS's \b only recognizes ASCII word
// characters, so \bà never matches — confirmed directly (/\b[àa]\s+louer\b/
// fails against "à louer") rather than assumed. Every other boundary here
// sits next to a plain ASCII letter, where \b works as expected.
const PRICE_MIN_PATTERNS = [
  /(?:^|\s)[àa]\s+partir\s+de\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bplus\s+de\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bmin(?:imum)?\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bover\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\babove\s+\$?\s*([\d.,]+)\s*\$?/i,
  /\bmore\s+than\s+\$?\s*([\d.,]+)\s*\$?/i,
];

// Trilingual on purpose — the diaspora audience CurrencyToggle.js's own
// comment already calls out as a headline consideration searches in
// English too ("2 bedroom apartment"), not just French. Real report:
// that phrase produced 0 results because only French room/type words were
// recognized, so the whole English phrase fell through to a literal ILIKE
// search against French-language descriptions.
//
// Lingala terms (suku/basuku "room", ndako "house", lopango "plot",
// kofuta/kofutela "pay/rent", kosomba "buy") — verified against real
// dictionary sources before adding, not guessed: lingala.uk's dictionary
// entry for "suku" (plural "basuku"), and, specifically for the real-estate
// sense of "kofutela", two actual Kinshasa property listings using it in
// context (imcongo.com — "ndaku ... kofutela kinshasa lingwala"). See the
// commit message / conversation for the full source list — not repeated
// here since a dictionary can drift and this comment shouldn't become the
// thing that goes stale.
const BEDS_PATTERN = /\b(\d+)\s*(?:chambres?|ch\.?|bedrooms?|beds?|bd|basuku|sukus?|cukus?)\b/i;
const BATH_PATTERN = /\b(\d+)\s*(?:salles?\s+de\s+bain|sdb|bathrooms?|baths?)\b/i;

const TRANSACTION_TYPE_PATTERNS = [
  [/(?:^|\s)[àa]\s+louer\b/i, 'location'],
  [/\blocation\b/i, 'location'],
  [/\bto\s+rent\b/i, 'location'],
  [/\bfor\s+rent\b/i, 'location'],
  [/\brent\b/i, 'location'],
  [/\bkofutela\b/i, 'location'],
  [/\bkofuta\b/i, 'location'],
  [/(?:^|\s)[àa]\s+vendre\b/i, 'vente'],
  [/\bvente\b/i, 'vente'],
  [/\bfor\s+sale\b/i, 'vente'],
  [/\bto\s+buy\b/i, 'vente'],
  [/\bkosomba\b/i, 'vente'],
];

// Mapped only to real, currently-queryable values — checked directly
// against the live category_content table before writing this, not
// assumed: today only "appartement" and "maison" have real approved
// listings, and "villa"/"terrain" only exist as PARCELLE_SUBTYPES
// (lib/constants.js), never as a top-level property_type on their own.
// "villa"/"terrain nu" therefore resolve through parcelle_subtype, matching
// exactly how root CLAUDE.md's classification rules define them — mapping
// "villa" straight to property_type=maison would be a real, wrong guess.
const PROPERTY_TYPE_PATTERNS = [
  [/\b(?:appartements?|apartments?|flats?|studios?)\b/i, { property_type: 'appartement' }],
  [/\bvillas?\b/i, { property_type: 'parcelle', parcelle_subtype: 'villa' }],
  [/\b(?:terrains?|plots?|land|lopango)\b/i, { property_type: 'parcelle', parcelle_subtype: 'terrain_nu' }],
  [/\b(?:maisons?|houses?|ndako|ndaku)\b/i, { property_type: 'maison' }],
];

// LKP-2026-0091 (services/openai.js's real generated format, engine repo) —
// tolerant of missing dashes/spaces and case. Also the informal ways a
// visitor might type a remembered reference: "réf 91", "ref: 91", "#91" —
// these carry only the trailing digits, matched as a loose ILIKE fallback
// (there's no way to reconstruct the full LKP-YYYY-NNNN code from a bare
// number) rather than a structured exact filter.
const REFERENCE_PATTERNS = [
  { pattern: /\bLKP[-\s]?(\d{4})[-\s]?(\d+)\b/i, build: (m) => `LKP-${m[1]}-${m[2]}` },
  { pattern: /\b(?:r[ée]f(?:[ée]rence)?s?|ref)\s*[:\s]?\s*(\d+)\b/i, build: (m) => m[1] },
  { pattern: /#(\d+)\b/, build: (m) => m[1] },
];

/** "1.500" / "1,500" / "1500" -> 1500. Returns null if not a finite number. */
function parseAmount(raw) {
  const cleaned = raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Exported so SearchBar.js's live preview can build the exact same kind of
// "remove this one matched span" regex it uses internally, without a second
// copy of this one-liner drifting out of sync.
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
 *   quartier: string|undefined,
 *   keywords: string,
 *   spans: Object<string, string>,
 * }}
 */
export function parseSearchQuery(text) {
  // typeof-checked rather than String(text || '') — the latter happily
  // stringifies a stray non-string (a React SyntheticEvent, an object) into
  // literal text like "[object Object]" instead of failing safe. That
  // exact class of bug reached production once already (a bare
  // `onClick={submitFreeText}` handing its click event to this function) —
  // this is the second layer of defense, not just the onClick fix.
  let remaining = typeof text === 'string' ? text : '';
  const result = {};
  // The exact raw substring each field was parsed from, keyed the same as
  // the field itself — SearchBar.js's live preview uses this to remove one
  // filter's own text from the input when its pill is tapped, without
  // touching any other recognized field's text.
  const spans = {};

  const referenceMatch = REFERENCE_PATTERNS.map(({ pattern, build }) => {
    const m = remaining.match(pattern);
    return m ? { m, build } : null;
  }).find(Boolean);
  if (referenceMatch) {
    result.reference = referenceMatch.build(referenceMatch.m);
    spans.reference = referenceMatch.m[0];
    remaining = remaining.replace(referenceMatch.m[0], ' ');
  }

  for (const pattern of PRICE_MAX_PATTERNS) {
    const match = remaining.match(pattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (amount != null) {
      result.price_max = amount;
      spans.price_max = match[0];
      remaining = remaining.replace(match[0], ' ');
      break;
    }
  }

  for (const pattern of PRICE_MIN_PATTERNS) {
    const match = remaining.match(pattern);
    if (!match) continue;
    const amount = parseAmount(match[1]);
    if (amount != null) {
      result.price_min = amount;
      spans.price_min = match[0];
      remaining = remaining.replace(match[0], ' ');
      break;
    }
  }

  const bedsMatch = remaining.match(BEDS_PATTERN);
  if (bedsMatch) {
    result.beds_min = Number.parseInt(bedsMatch[1], 10);
    spans.beds_min = bedsMatch[0];
    remaining = remaining.replace(bedsMatch[0], ' ');
  }

  const bathMatch = remaining.match(BATH_PATTERN);
  if (bathMatch) {
    result.bath_min = Number.parseInt(bathMatch[1], 10);
    spans.bath_min = bathMatch[0];
    remaining = remaining.replace(bathMatch[0], ' ');
  }

  for (const [pattern, value] of TRANSACTION_TYPE_PATTERNS) {
    const match = remaining.match(pattern);
    if (!match) continue;
    result.transaction_type = value;
    spans.transaction_type = match[0];
    remaining = remaining.replace(match[0], ' ');
    break;
  }

  for (const [pattern, values] of PROPERTY_TYPE_PATTERNS) {
    const match = remaining.match(pattern);
    if (!match) continue;
    Object.assign(result, values);
    spans.property_type = match[0];
    remaining = remaining.replace(match[0], ' ');
    break;
  }

  // Real communes/quartiers/landmarks (lib/gazetteer.js — the same curated
  // data LocationAutocomplete.js's dropdown uses), not a guess: "à
  // Ngaliema" resolves to a real `commune` filter the same way picking it
  // from the dropdown would. A landmark match (e.g. "Saint Luc") sets
  // `commune` too but deliberately isn't stripped from the text below — it
  // still needs to reach the real ILIKE fallback in lib/listings.js, since
  // there's no structured landmark column to filter on directly.
  const location = findLocationMention(remaining);
  if (location) {
    result.commune = location.commune;
    if (location.type === 'quartier') result.quartier = location.label;
    spans.commune = location.matchedText;
    if (location.type !== 'landmark') {
      // Also consumes a preceding locative preposition ("à Ngaliema", "au
      // Ma Campagne") so it doesn't strand a dangling "à" in `keywords` —
      // remaining.keywords is matched as one literal ILIKE phrase (see
      // lib/listings.js), so a stray connector word makes an otherwise-real
      // match fail.
      // (?:^|\s) rather than \b before the preposition group: same ASCII-only
      // \b limitation as the price/transaction patterns above — \bà never
      // matches.
      // matchedText, not location.label: for a fuzzy/typo match ("limite"
      // resolving to the real commune "Limete") the canonical label never
      // actually appears in the text — stripping it would be a no-op and
      // leave the typo itself sitting in `keywords`, polluting the ILIKE
      // fallback with a literal misspelling no real listing would contain.
      // English prepositions (in/at/near) alongside the French ones, and
      // Lingala's own catch-all locative "na" ("na Ngaliema" — verified,
      // Lingala has essentially one general-purpose preposition, not a
      // separate word per relation) — a real case this surfaced: "house for
      // rent in Ngaliema" left a dangling "in" in keywords, which as a bare
      // ILIKE term matches almost any description (a near-universal 2-letter
      // substring), silently over-broadening rather than failing loudly.
      const prepositionPattern = new RegExp(
        `(?:(?:^|\\s)(?:[àa]|au|aux|en|dans|de|du|des|in|at|near|na)\\s+)?${escapeRegExp(location.matchedText)}`,
        'i',
      );
      const prepositionMatch = remaining.match(prepositionPattern);
      if (prepositionMatch) spans.commune = prepositionMatch[0].trim();
      remaining = remaining.replace(prepositionPattern, ' ');
    }
  }

  result.keywords = remaining.replace(/\s+/g, ' ').trim();
  result.spans = spans;
  return result;
}
