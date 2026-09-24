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
  return normalize(value).replace(/[\s'’-]/g, '');
}

/** normalize(), with hyphens and apostrophes read as spaces: "Cité-Verte",
 *  "cite verte" and "cité verte" are the same place to a visitor typing it.
 *  Character-for-character the same length as its input (each separator is
 *  replaced, never removed), so an index found here is an index into the
 *  original text — see findLocationMention's matchedText. */
function spaced(value) {
  return stripDiacritics(String(value || '')).toLowerCase().replace(/[-'’]/g, ' ');
}

/**
 * Everyday words that must never be read as a place by the fuzzy tiers below.
 * Each of these was a real misfire: "chambre salon" (the commonest rental
 * phrase in Kinshasa) became the quartier Salongo, "petit appart" became the
 * landmark "Petites Sœurs des Pauvres", "cité" became "Cité de l'O.U.A.",
 * "mont" became Mont-Fleury. An exact, whole-label match still works — a
 * visitor who types "Salongo" gets Salongo — only the guessing is refused.
 */
const FUZZY_STOPWORDS = new Set([
  'chambre', 'chambres', 'salon', 'salons', 'petit', 'petite', 'petits', 'petites', 'grand', 'grande', 'grands',
  'grandes', 'cite', 'mont', 'maison', 'maisons', 'appartement', 'appartements', 'appart', 'apparts', 'studio',
  'studios', 'villa', 'villas', 'terrain', 'terrains', 'parcelle', 'parcelles', 'duplex', 'immeuble', 'bureau',
  'bureaux', 'magasin', 'depot', 'entrepot', 'avec', 'pour', 'dans', 'louer', 'vendre', 'vente', 'location',
  'achat', 'acheter', 'prix', 'budget', 'dollars', 'moins', 'entre', 'sous', 'quartier', 'commune', 'avenue',
  'route', 'place', 'rond', 'point', 'marche', 'pont', 'port', 'hopital', 'ecole', 'eglise', 'universite',
  'hotel', 'residence', 'meuble', 'meublee', 'meubles', 'piscine', 'garage', 'jardin', 'neuf', 'neuve',
  'nouveau', 'nouvelle', 'belle', 'propre', 'calme', 'securise', 'securisee', 'house', 'houses', 'apartment',
  'apartments', 'flat', 'flats', 'bedroom', 'bedrooms', 'room', 'rooms', 'near', 'with', 'rent', 'sale',
  'kinshasa', 'cherche', 'recherche', 'pieces', 'douche', 'douches', 'toilette', 'toilettes', 'cuisine',
  'porte', 'portes', 'etage', 'niveau', 'plain', 'pied', 'haut', 'standing', 'luxe', 'moderne',
]);

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
// How Kinshasa writes the same place two ways: "St Luc" / "Saint Luc",
// "Rond-Point Victoire" / "RP Victoire", "Bd du 30 Juin". Each pair is
// word-bounded and applied to the SPACED label, both directions.
const WORD_ALIASES = [
  ['saint', 'st'],
  ['sainte', 'ste'],
  ['rond point', 'rp'],
  ['boulevard', 'bd'],
  ['avenue', 'av'],
  ['universite', 'univ'],
];

/** Every other spelling of a spaced label under WORD_ALIASES (excluding itself). */
export function labelAliases(spacedLabel) {
  const out = new Set();
  for (const [long, short] of WORD_ALIASES) {
    for (const [from, to] of [[long, short], [short, long]]) {
      const re = new RegExp(`(^|\\s)${from}(?=\\s|$)`, 'g');
      if (re.test(spacedLabel)) out.add(spacedLabel.replace(re, `$1${to}`));
    }
  }
  out.delete(spacedLabel);
  return [...out];
}

function indexRows(type, label, commune) {
  const base = spaced(label).trim();
  // Alias rows keep the real label: a search for "Saint Luc" still answers
  // "St Luc", the spelling the data (and the listings) use.
  return [base, ...labelAliases(base)].map((form) => ({ type, label, commune, norm: normalize(label), spaced: form }));
}

const INDEX = gazetteer.flatMap(({ commune, quartiers, landmarks }) => {
  const rows = indexRows('commune', commune, commune);
  for (const quartier of quartiers) rows.push(...indexRows('quartier', quartier, commune));
  for (const landmark of landmarks) rows.push(...indexRows('landmark', landmark, commune));
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
  //
  // Everyday words (FUZZY_STOPWORDS) are never candidates: "salon" is a
  // prefix of Salongo, and "chambre salon" is not a search for Salongo.
  const words = normalize(text)
    .split(/[\s'’-]+/)
    .filter(Boolean)
    .filter((word) => !FUZZY_STOPWORDS.has(word));
  if (!words.length) return null;

  for (const word of words) {
    const looseWord = word.replace(/'/g, '');
    if (looseWord.length < 4) continue;

    const hits = [];
    for (const row of INDEX) {
      const looseLabel = looseNormalize(row.label);
      if (looseLabel.length < 4) continue;
      if (looseWord === looseLabel) return { ...row, matchedText: word };
      if (looseLabel.startsWith(looseWord)) hits.push(row);
    }
    if (hits.length === 0) continue;

    // A commune prefix ("bandal", "kasa") wins outright.
    const communeHit = hits.find((row) => row.type === 'commune');
    if (communeHit) return { ...communeHit, matchedText: word };

    // "binza" is the start of four different Ngaliema quartiers
    // (Binza-Delvaux, -IPN, -Météo, -Pigeon). Picking the first one narrowed
    // a search for the whole Binza area to Delvaux alone. When every hit
    // lies in one commune, the honest reading is that commune.
    const distinct = new Set(hits.map((row) => `${row.type}:${row.label}`));
    const communes = new Set(hits.map((row) => row.commune));
    if (distinct.size > 1 && communes.size === 1) {
      const [commune] = communes;
      return { type: 'commune', label: commune, commune, norm: normalize(commune), matchedText: word };
    }
    return { ...hits[0], matchedText: word };
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
  // Hyphens and apostrophes read as spaces on both sides, so "cite verte"
  // finds "Cité-Verte" and "mont fleury" finds "Mont-Fleury".
  const q = spaced(query).replace(/\s+/g, ' ').trim();
  if (!q) return [];

  const matches = [];
  for (const row of INDEX) {
    const matchIndex = row.spaced.indexOf(q);
    if (matchIndex === -1) continue;
    // Also matches a word boundary within the label ("marché" inside
    // "marché de matete" should rank like a prefix match, not a mid-word
    // substring) — cheap enough to check per candidate since the list is
    // already narrowed to real substring hits.
    const isWordStart = matchIndex === 0 || row.spaced[matchIndex - 1] === ' ';
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
    const { spaced: _spaced, ...rest } = m;
    out.push(rest);
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
 * Requires the label to start AND end at a word boundary in the text and
 * picks the longest match when several are found — both cut down on a
 * short, common quartier name accidentally firing on an unrelated word.
 *
 * Hyphens and apostrophes count as spaces on both sides ("cite verte" is
 * Cité-Verte), and `matchedText` is always the visitor's OWN text at that
 * position — what the parser has to strip — never the canonical label.
 *
 * `alsoIn` lists the other communes where the same quartier name exists
 * (Salongo is a quartier of Kasa-Vubu, Limete AND Lemba): the parser searches
 * all of them rather than silently picking the first.
 *
 * @param {string} text
 * @returns {{type: 'commune'|'quartier'|'landmark', label: string, commune: string, matchedText: string, alsoIn: string[]}|null}
 */
export function findLocationMention(text) {
  const source = String(text || '');
  const norm = spaced(source);
  if (!norm.trim()) return null;
  const sameLength = norm.length === source.length;

  let best = null;
  let bestIndex = -1;
  for (const row of INDEX) {
    // Floor of 3, not 4: real short labels exist in this gazetteer (CPA, a
    // real Ngaliema quartier; Yuo). Safe because the match must also END at
    // a word boundary, so "Golf" can never fire on the start of a longer word.
    if (row.spaced.length < 3) continue;
    let from = 0;
    while (from <= norm.length) {
      const matchIndex = norm.indexOf(row.spaced, from);
      if (matchIndex === -1) break;
      from = matchIndex + 1;
      // Apostrophe counts as a leading boundary too (French elision:
      // "près de l'UPN") — spaced() already turned it into a space.
      const isWordStart = matchIndex === 0 || !/[\p{L}\p{N}]/u.test(norm[matchIndex - 1]);
      if (!isWordStart) continue;
      const endIndex = matchIndex + row.spaced.length;
      const isWordEnd = endIndex === norm.length || !/[\p{L}\p{N}]/u.test(norm[endIndex]);
      if (!isWordEnd) continue;
      if (!best || row.spaced.length > best.spaced.length) {
        best = row;
        bestIndex = matchIndex;
      }
      break;
    }
  }

  if (best) {
    const matchedText = sameLength ? source.slice(bestIndex, bestIndex + best.spaced.length) : best.label;
    const alsoIn =
      best.type === 'quartier'
        ? [
            ...new Set(
              INDEX.filter((r) => r.type === 'quartier' && r.spaced === best.spaced && r.commune !== best.commune).map(
                (r) => r.commune,
              ),
            ),
          ]
        : [];
    return { type: best.type, label: best.label, commune: best.commune, matchedText, alsoIn };
  }

  const fuzzy = fuzzyLocationMatch(source);
  return fuzzy
    ? { type: fuzzy.type, label: fuzzy.label, commune: fuzzy.commune, matchedText: fuzzy.matchedText, alsoIn: [] }
    : null;
}


/** @returns {string[]} every real commune name, in gazetteer order */
export function allCommuneNames() {
  return gazetteer.map((c) => c.commune);
}

export function defaultCommuneOrder() {
  return DEFAULT_COMMUNE_ORDER;
}
