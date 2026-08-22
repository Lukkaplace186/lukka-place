/**
 * services/locations.js
 *
 * Master data for Kinshasa's commune -> quartier hierarchy (kinshasa_locations.json),
 * plus dependency-free fuzzy normalisation so extraction variants ("Ma Campagne",
 * "gombé", "Djili") collapse onto the canonical spelling the rest of the system
 * (the prompt, the DB, the live Supabase site) already expects.
 */

const path = require('path');

const RAW_LOCATIONS = require(path.join(__dirname, '..', 'kinshasa_locations.json'));

/**
 * Two communes in the master JSON carry an apostrophe ("N'Djili", "N'Sele") that
 * predates this file — the codebase's existing commune list (services/openai.js,
 * services/aiParser.js) and the live Supabase data (its `amenities` rows, which
 * this engine tags communes through — see services/postgres.js) both spell them
 * without one. Canonicalise here rather than carry two spellings through the
 * system; the JSON file itself is left exactly as supplied.
 */
const COMMUNE_KEY_ALIASES = {
  "N'Djili": 'Ndjili',
  "N'Sele": 'Nsele',
};

/** commune (canonical spelling) -> quartier[] */
const LOCATIONS = Object.fromEntries(
  Object.entries(RAW_LOCATIONS).map(([commune, quartiers]) => [
    COMMUNE_KEY_ALIASES[commune] || commune,
    quartiers,
  ]),
);

const COMMUNES = Object.keys(LOCATIONS);

/** Every quartier in the city, flattened — used when the commune isn't known yet. */
const ALL_QUARTIERS = Object.values(LOCATIONS).flat();

// Hand-picked aliases for spellings common enough that edit-distance alone would
// either miss them (multi-word contractions like "Ma Campagne") or risk a false
// positive against a different real commune/quartier.
const COMMUNE_ALIASES = {
  'la gombe': 'Gombe',
  gombe: 'Gombe',
  bandal: 'Bandalungwa',
  djili: 'Ndjili',
  ndjili: 'Ndjili',
  nsele: 'Nsele',
  kin: 'Kinshasa',
};

const QUARTIER_ALIASES = {
  'ma campagne': 'Macampagne',
  macampagne: 'Macampagne',
};

/** Strip accents/case for forgiving free-text matches — same convention as
 *  services/postgres.js's normaliseText. */
function normaliseText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Classic edit-distance DP, O(m*n) — fine at this scale (longest quartier name
 *  is a few words, and the candidate pool tops out in the low hundreds). */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const row = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) row[j] = j;

  for (let i = 1; i <= m; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * Best fuzzy match of `input` against `candidates`, or null if nothing is close
 * enough to trust. Tolerance scales with word length so a short name like
 * "Gombe" can't absorb as many typos as "Kimbanseke" before it risks matching
 * the wrong place entirely.
 */
function bestMatch(input, candidates) {
  const needle = normaliseText(input);
  if (!needle) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(needle, normaliseText(candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  const tolerance = Math.max(1, Math.floor(needle.length * 0.3));
  return bestDistance <= tolerance ? best : null;
}

/**
 * Canonical commune name for a free-text guess ("gombé", "Bandal", "Djili"), or
 * null if nothing in the master list is a confident match.
 */
function resolveCommune(input) {
  if (!input) return null;
  const key = normaliseText(input);
  if (COMMUNE_ALIASES[key]) return COMMUNE_ALIASES[key];
  return bestMatch(input, COMMUNES);
}

/**
 * Canonical quartier name for a free-text guess. Searches within `commune`'s own
 * list when the commune is already known — tighter, and avoids a quartier name
 * that happens to also exist under a different commune matching the wrong one.
 * Falls back to every quartier in the city when the commune isn't known.
 */
function resolveQuartier(input, commune) {
  if (!input) return null;
  const key = normaliseText(input);
  if (QUARTIER_ALIASES[key]) return QUARTIER_ALIASES[key];

  const canonicalCommune = commune ? resolveCommune(commune) : null;
  const pool = canonicalCommune ? LOCATIONS[canonicalCommune] : ALL_QUARTIERS;

  return bestMatch(input, pool);
}

/**
 * The exact quartier list for one commune — the data a cascading "commune"
 * dropdown uses to populate its "quartier" sibling. Accepts a raw guess
 * ("gombé") as well as the canonical spelling; returns [] for an unknown
 * commune rather than throwing, so a not-yet-selected commune is a normal,
 * quiet state for a form to be in.
 */
function quartiersForCommune(commune) {
  if (!commune) return [];
  const canonical = resolveCommune(commune) || commune;
  return LOCATIONS[canonical] || [];
}

/**
 * Strict (non-fuzzy) membership check: is `quartier` exactly one of the
 * canonical quartiers listed for `commune`? Used to decide whether a
 * previously-selected quartier survives a commune change — deliberately
 * exact rather than resolveQuartier's fuzzy match, since a cascading
 * dropdown's own options are always the canonical strings already.
 */
function isValidQuartier(commune, quartier) {
  if (!commune || !quartier) return false;
  return quartiersForCommune(commune).includes(quartier);
}

/**
 * Cascading-select logic for a commune/quartier form pair, framework- and
 * DOM-agnostic so it is usable from any future frontend (or straight from a
 * test) without dragging in a UI dependency here.
 *
 * @param {Object} params
 * @param {string|null} params.newCommune       The commune just selected.
 * @param {string|null} [params.currentQuartier] The quartier currently selected, if any.
 * @returns {{commune: string|null, quartier: string|null, quartiers: string[]}}
 *          `commune` normalised to its canonical spelling; `quartier` is kept
 *          only if still valid under the new commune, otherwise reset to
 *          null; `quartiers` is the option list to render for it.
 */
function cascadeCommuneChange({ newCommune, currentQuartier = null }) {
  const canonicalCommune = newCommune ? resolveCommune(newCommune) || newCommune : null;
  const quartiers = quartiersForCommune(canonicalCommune);
  const quartier = isValidQuartier(canonicalCommune, currentQuartier) ? currentQuartier : null;

  return { commune: canonicalCommune, quartier, quartiers };
}

module.exports = {
  LOCATIONS,
  COMMUNES,
  ALL_QUARTIERS,
  resolveCommune,
  resolveQuartier,
  quartiersForCommune,
  isValidQuartier,
  cascadeCommuneChange,
  normaliseText,
  COMMUNE_KEY_ALIASES,
};
