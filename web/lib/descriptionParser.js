import { AMENITY_KEYWORDS } from './constants';
import { matchedAmenities } from './listingView';

/**
 * What goes in a listing's "Caractéristiques principales" list, and where
 * each line actually came from.
 *
 * THREE SOURCES, IN ORDER OF HOW MUCH WE TRUST THEM
 *
 * 1. `listing.features` — a real text[] column on `properties`, written at
 *    intake by the engine's extraction pass over the agent's own WhatsApp
 *    message (services/openai.js), and backfilled for older rows by
 *    scripts/migrate-listing-features.js. Used verbatim when present. It is
 *    the only source that can carry a fact the keyword matcher has no word
 *    for ("eau et électricité 24h/24", "vue sur le fleuve").
 *
 * 2. Keyword matches against the listing's own text — `matchedAmenities`,
 *    over the same AMENITY_KEYWORDS map the "Plus de filtres" checkboxes
 *    already filter with server-side. These are real, not inferred: the
 *    listing said the word. This is what the detail page's "Équipements
 *    confirmés" chips were already doing; the list is just no longer capped
 *    at five out of a ten-key vocabulary, which was silently costing a
 *    well-described listing half its features.
 *
 * 3. `parseFeatureLines(description)` — the legacy fallback, for a row that
 *    predates the column and mentions no keyword we know.
 *
 * They are NOT concatenated. A listing with a real `features` column does
 * not also get the keyword pass appended: the two overlap heavily
 * ("climatisé" appears in both), and de-duplicating French prose against
 * translated amenity labels is not something that can be done reliably. One
 * source per listing, best available, and the caller is told which.
 */

/**
 * Stands in for an abbreviation's full stop across the sentence split, then
 * restored. Written as an escape, not as the literal character: U+E000 is
 * in the private use area and renders as nothing at all in most editors, so
 * a literal here would look like an empty string to the next reader.
 */
const ABBREVIATION_DOT = '\uE000';

/**
 * Split a free-text description into candidate bullet lines.
 *
 * Newlines first, and only then sentences. An agent who wrote a real list
 * ("- 3 chambres\n- parking\n- groupe électrogène") has already done the
 * work, and sentence-splitting that text would merge their lines back
 * together at the first one without a full stop.
 *
 * LIMITS, AND WHY THEY ARE NOT ARBITRARY
 * A "feature" is a phrase, not a paragraph. Kinshasa listings are
 * transcribed from WhatsApp and most are one flowing sentence — "Cet
 * appartement situé au premier niveau dans la commune de Bandalungwa est
 * disponible à la location." is a real one, and it is a description, not a
 * feature. Emitting it as a bullet would make the section look populated
 * while telling the reader nothing the paragraph below doesn't.
 *
 * So the sentence branch is ALL OR NOTHING: if any sentence is too long to
 * read as a feature, the whole result is discarded. Dropping only the long
 * ones is worse than doing nothing, because what survives is an arbitrary
 * half of a paragraph presented as the listing's key features — that real
 * description above yields exactly two such bullets, and the one fact it
 * opens with (which commune it is in) is the one that gets cut. The
 * newline branch keeps the weaker per-line filter: an agent who typed a
 * list made a real list, and one over-long line in it does not make the
 * other five stop being features.
 *
 * Either way, fewer than two surviving lines discards the result — one
 * bullet is a sentence with a tick next to it, not a list.
 *
 * The abbreviation guard matters for the same data: "Réf. 12", "env. 300 m²"
 * and "3 ch." all carry a full stop that does not end a sentence.
 *
 * @param {string} description
 * @param {{max?: number}} [options]
 * @returns {string[]} Possibly empty — that is a real answer, not a failure.
 */
export function parseFeatureLines(description, { max = 10 } = {}) {
  if (!description || typeof description !== 'string') return [];

  const MIN_LINE_CHARS = 3;
  const MAX_LINE_CHARS = 80;

  const byLine = description
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  // A placeholder so a full stop that is part of an abbreviation survives
  // the sentence split below, then restored. Cheaper and far more legible
  // than a lookbehind assertion listing every abbreviation inline.
  const ABBREVIATIONS = /\b(réf|ref|env|approx|av|bd|no|nº|n°|ch|sdb|cf|etc)\./gi;

  const splitOnSentences = byLine.length <= 1;
  const fragments = splitOnSentences
    ? (byLine[0] || '')
      .replace(ABBREVIATIONS, (match) => match.replace('.', ABBREVIATION_DOT))
      .split(/(?<=[.;!?])\s+/)
      .map((part) => part.split(ABBREVIATION_DOT).join('.'))
    : byLine;

  const seen = new Set();
  const lines = [];

  for (const fragment of fragments) {
    const cleaned = fragment
      // Leading bullet glyphs, dashes and list numbering an agent typed.
      .replace(/^[\s\-•*·–—]+/, '')
      .replace(/^\d+[).]\s*/, '')
      // A trailing sentence terminator reads as a typo in a bullet list.
      .replace(/[.;,\s]+$/, '')
      .trim();

    if (cleaned.length < MIN_LINE_CHARS) continue;
    if (cleaned.length > MAX_LINE_CHARS) {
      // See the doc comment: half a paragraph is worse than no list.
      if (splitOnSentences) return [];
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(cleaned);
    if (lines.length >= max) break;
  }

  // One bullet is a sentence with a tick next to it, not a feature list.
  return lines.length > 1 ? lines : [];
}

/** A real `features` value out of Postgres, or null. `text[]` arrives as a JS array. */
function columnFeatures(value, max) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, max);
  return cleaned.length ? cleaned : null;
}

/**
 * The listing's key features, resolved.
 *
 * @param {Object} listing A real row from lib/listings.js.
 * @param {Function} t     A bound translator (`useT()` / `await getT()`).
 * @param {{max?: number}} [options]
 * @returns {{items: Array<{id: string, label: string, amenityKey?: string, matched?: string}>,
 *           source: 'column'|'amenities'|'description'|null}}
 *   `source` is what lets the caller caption the list honestly — a keyword
 *   match against the listing's own prose is a weaker claim than a field the
 *   extraction pass actually filled, and the UI says so.
 */
export function listingFeatures(listing, t, { max = 10 } = {}) {
  if (!listing) return { items: [], source: null };

  const fromColumn = columnFeatures(listing.features, max);
  if (fromColumn) {
    return {
      items: fromColumn.map((label, i) => ({ id: `feature-${i}`, label })),
      source: 'column',
    };
  }

  // Uncapped over the real vocabulary rather than the old max=5: this is the
  // detail page, where there is room for everything the listing claimed.
  const amenities = matchedAmenities(listing, Object.keys(AMENITY_KEYWORDS).length);
  if (amenities.length) {
    return {
      items: amenities.map(({ key, matched }) => ({
        id: key,
        // `t` is required here, not optional — every key in AMENITY_KEYWORDS
        // has a dictionary entry, and falling back to the raw key would put
        // "dedicated_line" on a customer-facing page.
        label: t(`listings.amenities.${key}`),
        amenityKey: key,
        matched,
      })),
      source: 'amenities',
    };
  }

  const parsed = parseFeatureLines(listing.description, { max });
  if (parsed.length) {
    return {
      items: parsed.map((label, i) => ({ id: `line-${i}`, label })),
      source: 'description',
    };
  }

  // A listing whose description is one unsplittable sentence and mentions
  // nothing we recognise genuinely has no feature list. It renders as a
  // plain description, which is what it is.
  return { items: [], source: null };
}
