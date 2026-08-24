/**
 * Kinshasa place-name search for the location autocomplete
 * (components/LocationAutocomplete.js, app/api/locations/autocomplete).
 *
 * Real gazetteer data — the 24 communes, their quartiers, and well-known
 * landmarks — not fabricated. It intentionally lives separate from
 * `services/locations.js`'s commune/quartier hierarchy (the root
 * `kinshasa_locations.json`, fetched over the engine's `GET /locations`):
 * that hierarchy only carries commune → quartier names, has no landmark
 * data, and its consumer (FilterBar's Commune/Quartier pills) is a
 * different, already-working interaction this feature doesn't replace.
 *
 * Commune names here are the canonical DB-facing spelling — the same one
 * `p.commune` resolves to via the `property_amenities` → `amenity_contents`
 * subquery in lib/listings.js (`Ndjili`/`Nsele`, no apostrophe — see
 * services/locations.js's own alias table in the engine repo for why).
 * Selecting a commune suggestion must produce a `?commune=` value that
 * actually matches real rows, not the accented apostrophe spelling a
 * gazetteer would otherwise use.
 */
import gazetteer from './data/kinshasa-gazetteer.json';

/** Curated fallback order for "no query yet" — mirrors the same handful of
 *  central communes already used as the fallback in Footer.js and the old
 *  ExploreCommunes.js, so the autocomplete's empty state doesn't invent a
 *  new ranking out of nowhere. */
const DEFAULT_COMMUNE_ORDER = ['Gombe', 'Ngaliema', 'Limete', 'Kintambo', 'Lemba', 'Bandalungwa', 'Kalamu', 'Ngaba'];

function stripDiacritics(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normalize(value) {
  return stripDiacritics(String(value || '')).toLowerCase().trim();
}

/** Same as normalize(), plus spaces/hyphens/apostrophes stripped — so
 *  "macampagne" (one word, how it's commonly typed and even how the root
 *  kinshasa_locations.json itself spells it) lines up with this gazetteer's
 *  "Ma Campagne" without needing a second hardcoded spelling on file. */
function looseNormalize(value) {
  return normalize(value).replace(/[\s'-]/g, '');
}

/** Classic edit distance (insert/delete/substitute), O(a.length * b.length).
 *  Both inputs here are always short place names, so this is cheap even run
 *  per-candidate. Used only as a last-resort tier below, after exact and
 *  loose matching have both failed. */
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Flattened once at module load — every commune, quartier and landmark as
// one searchable row. ~600 short strings; a linear scan per request is
// well under a millisecond, no search index needed.
const INDEX = gazetteer.flatMap(({ commune, quartiers, landmarks }) => {
  const rows = [{ type: 'commune', label: commune, commune, norm: normalize(commune) }];
  for (const quartier of quartiers) {
    rows.push({ type: 'quartier', label: quartier, commune, norm: normalize(quartier) });
  }
  for (const landmark of landmarks) {
    rows.push({ type: 'landmark', label: landmark, commune, norm: normalize(landmark) });
  }
  return rows;
});

const TYPE_WEIGHT = { commune: 0, quartier: 1, landmark: 2 };

/**
 * Fallback for when exact substring matching finds nothing — catches
 * spelling variants that are still real place names, not fabricated ones:
 *
 *   - Spacing/apostrophe variants ("macampagne" for "Ma Campagne", how the
 *     root kinshasa_locations.json itself spells it as one word) — checked
 *     against every type (commune/quartier/landmark).
 *   - Small typos ("limite" for "Limete", "kitambo" for "Kintambo") via
 *     edit-distance tolerance — restricted to communes only (24 entries,
 *     low false-positive risk; there are hundreds of quartiers/landmarks,
 *     many short, where this would misfire more than it would help).
 *   - Abbreviations ("bandal" for "Bandalungwa") via a loose prefix check,
 *     same pass as the spacing variants above.
 *
 * Deliberately not a hand-maintained per-commune alias list (the kind that
 * needs a new entry for every new typo someone happens to type) — this is
 * the generic mechanism that already covers all of the above.
 */
function fuzzyLocationMatch(text) {
  // Word-based (not whole-text) so the caller always knows exactly which
  // original word triggered the match, and can strip *that* — not the
  // canonical label, which for a real typo ("limite") never appears
  // verbatim in the text at all. Every case this exists for (a misspelled
  // commune, a spaced-out one typed as one word, an abbreviation) is a
  // single token anyway.
  const words = normalize(text).split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;

  for (const word of words) {
    const looseWord = word.replace(/'/g, '');
    if (looseWord.length < 4) continue;
    for (const row of INDEX) {
      const looseLabel = looseNormalize(row.label);
      if (looseLabel.length < 4) continue;
      if (looseWord === looseLabel || looseLabel.startsWith(looseWord)) {
        return { ...row, matchedText: word };
      }
    }
  }

  for (const word of words) {
    if (word.length < 4) continue;
    for (const row of INDEX) {
      if (row.type !== 'commune') continue;
      const looseLabel = looseNormalize(row.label);
      if (looseLabel.length < 4) continue;
      const maxDist = looseLabel.length >= 8 ? 2 : 1;
      if (Math.abs(word.length - looseLabel.length) > maxDist) continue;
      if (editDistance(word, looseLabel) <= maxDist) return { ...row, matchedText: word };
    }
  }

  // Same edit-distance idea, now for quartiers and landmarks — previously
  // restricted to the 24 communes only, leaving the ~600-row quartier/
  // landmark list (most of what a visitor actually types from memory)
  // uncorrected. Deliberately stricter than the commune tier above: a
  // 6-char floor (not 4) and a fixed maxDist of 1 regardless of length —
  // at this row count, a distance-2 tolerance starts collapsing two
  // genuinely different short quartier names into each other rather than
  // just catching a typo of one.
  for (const word of words) {
    if (word.length < 6) continue;
    for (const row of INDEX) {
      if (row.type === 'commune') continue; // already tried above
      const looseLabel = looseNormalize(row.label);
      if (looseLabel.length < 6) continue;
      if (Math.abs(word.length - looseLabel.length) > 1) continue;
      if (editDistance(word, looseLabel) <= 1) return { ...row, matchedText: word };
    }
  }

  return null;
}

/**
 * @param {string} query
 * @param {number} [limit=8]
 * @returns {Array<{type: 'commune'|'quartier'|'landmark', label: string, commune: string, matchIndex: number}>}
 */
export function searchGazetteer(query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];

  const matches = [];
  for (const row of INDEX) {
    const matchIndex = row.norm.indexOf(q);
    if (matchIndex === -1) continue;
    // Also matches a word boundary within the label ("marché" inside
    // "marché de matete" should rank like a prefix match, not a mid-word
    // substring) — cheap enough to check per candidate since the list is
    // already narrowed to real substring hits.
    const isWordStart = matchIndex === 0 || row.norm[matchIndex - 1] === ' ' || row.norm[matchIndex - 1] === '-';
    matches.push({ ...row, matchIndex, rank: isWordStart ? 0 : 1 });
  }

  // No exact substring hit at all (not even a mid-word one) — try the
  // typo/spacing/abbreviation fallback before giving up. Only when matches
  // is empty: a query that already has real substring hits shouldn't have
  // an unrelated fuzzy guess muscling in above them.
  if (matches.length === 0) {
    const fuzzy = fuzzyLocationMatch(query);
    if (fuzzy) matches.push({ ...fuzzy, matchIndex: 0, rank: 2 });
  }

  matches.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    if (TYPE_WEIGHT[a.type] !== TYPE_WEIGHT[b.type]) return TYPE_WEIGHT[a.type] - TYPE_WEIGHT[b.type];
    return a.label.length - b.label.length;
  });

  // Dedupe identical labels within the same commune (a few landmark names
  // repeat verbatim as their own commune's headline entry, e.g. "Bon
  // Marché" in Barumbu).
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    const key = `${m.type}:${m.commune}:${m.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Finds the best real commune/quartier/landmark mentioned anywhere inside a
 * longer piece of text — the reverse of searchGazetteer() (which checks
 * whether a short query is a substring of a label; this checks whether a
 * label is a substring of a longer sentence). Used by lib/searchParser.js so
 * "2 chambres à louer à Ngaliema" resolves a real `commune` filter instead
 * of leaving "Ngaliema" as a doomed literal-substring keyword search.
 *
 * Requires the label to start at a word boundary in the text (not just
 * anywhere mid-word) and picks the longest match when several are found —
 * both cut down on a short, common quartier name (e.g. a 4-letter one)
 * accidentally firing on an unrelated word.
 *
 * @param {string} text
 * @returns {{type: 'commune'|'quartier'|'landmark', label: string, commune: string}|null}
 */
export function findLocationMention(text) {
  const norm = normalize(text);
  if (!norm) return null;

  let best = null;
  for (const row of INDEX) {
    // Floor of 3, not 4: real short labels exist in this gazetteer today
    // (CPA, a real Ngaliema quartier; Yuo) that a 4-char floor silently
    // made unreachable here even though they already work fine in the
    // autocomplete dropdown (searchGazetteer has no such gate at all) —
    // confirmed by checking every label's length before picking this
    // number, not guessed. Safe to lower because of the *added* trailing-
    // boundary check just below, which this function didn't have before:
    // previously a short label only had to *start* at a word boundary, so
    // "Golf" could in principle have matched the first four letters of an
    // unrelated longer word. Requiring the match to also *end* at a word
    // boundary (or the end of the string) is what actually makes a 3-char
    // floor safe, not the floor number itself.
    if (row.norm.length < 3) continue;
    const matchIndex = norm.indexOf(row.norm);
    if (matchIndex === -1) continue;
    // Apostrophe counts as a leading boundary too — real French elision
    // ("l'UPN", "d'Ozone") puts a vowel-initial name directly against a
    // preceding apostrophe with no space at all. Confirmed this was a real
    // gap while adding UPN: "près de l'UPN" would otherwise fail the
    // word-start check entirely (the character right before "upn" is "'",
    // which wasn't in the accepted boundary set).
    const isWordStart =
      matchIndex === 0 || [' ', '-', "'"].includes(norm[matchIndex - 1]);
    if (!isWordStart) continue;
    const endIndex = matchIndex + row.norm.length;
    const isWordEnd = endIndex === norm.length || norm[endIndex] === ' ' || norm[endIndex] === '-';
    if (!isWordEnd) continue;
    if (!best || row.norm.length > best.norm.length) best = row;
  }

  // `matchedText` is what the caller (lib/searchParser.js) actually strips
  // out of the free text — the real label for an exact match (it appears
  // verbatim), but the literal typed word for a fuzzy one, since the
  // canonical label ("Limete") never appears in a text that only contains
  // the typo ("limite").
  if (best) return { type: best.type, label: best.label, commune: best.commune, matchedText: best.label };

  const fuzzy = fuzzyLocationMatch(text);
  return fuzzy ? { type: fuzzy.type, label: fuzzy.label, commune: fuzzy.commune, matchedText: fuzzy.matchedText } : null;
}

/** @returns {string[]} every real commune name, in gazetteer order */
export function allCommuneNames() {
  return gazetteer.map((c) => c.commune);
}

export function defaultCommuneOrder() {
  return DEFAULT_COMMUNE_ORDER;
}
