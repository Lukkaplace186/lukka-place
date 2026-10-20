/**
 * services/locations.js
 *
 * Master data for the commune -> quartier hierarchy of every city Lukka Place
 * covers (Kinshasa: kinshasa_locations.json; the others: drc_locations.json,
 * through services/cities.js), plus dependency-free fuzzy normalisation so
 * extraction variants ("Ma Campagne", "gombé", "Djili") collapse onto the
 * canonical spelling the rest of the system (the prompt, the DB, the live
 * Supabase site) already expects.
 *
 * Multi-city rule (2026-10-20): a name found in Kinshasa AND elsewhere, read
 * with no city to go on, keeps its Kinshasa reading — exactly what it meant
 * before other cities existed, and still what nearly every message means. A
 * city (stated by the agent, read by the model, or implied by a commune only
 * one city has) restricts every lookup to that city's communes.
 */

const path = require('path');

const cities = require('./cities');

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

/** commune key -> quartier[], every city (keys are unique nationwide — services/cities.js,
 *  which applies COMMUNE_KEY_ALIASES to Kinshasa's file the same way). */
const LOCATIONS = Object.fromEntries(
  Object.values(cities.CITIES).flatMap((city) => Object.entries(city.communes)),
);

const COMMUNES = Object.keys(LOCATIONS);

/** Kinshasa's 24, in file order — what Kinshasa-only readers (prompts, tests) mean. */
const KINSHASA_COMMUNES = cities.communesOfCity(cities.DEFAULT_CITY);

/** Every quartier in every city, flattened — used when the commune isn't known yet. */
const ALL_QUARTIERS = Object.values(LOCATIONS).flat();

const isKinshasa = (commune) => cities.cityOfCommune(commune) === cities.DEFAULT_CITY;

/**
 * Narrow candidate communes by city: to that city's when one is known, else to
 * Kinshasa's when Kinshasa is among them (see the header), else as they are.
 */
function preferCity(communes, city) {
  if (city) return communes.filter((c) => cities.cityOfCommune(c) === city);
  const kinshasa = communes.filter(isKinshasa);
  return kinshasa.length ? kinshasa : communes;
}

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
function bestMatch(input, candidates, label = (candidate) => candidate) {
  const needle = normaliseText(input);
  if (!needle) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const name = normaliseText(label(candidate));
    // A typo almost never hits the first letter; requiring it is what stops
    // "tonde" reading as "Konde".
    if (name[0] !== needle[0]) continue;
    const distance = levenshtein(needle, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  const tolerance = Math.max(1, Math.floor(needle.length * 0.3));
  return bestDistance <= tolerance ? best : null;
}

/**
 * Canonical commune key for a free-text guess ("gombé", "Bandal", "Djili";
 * "Kalamu" with city Boma → "Kalamu (Boma)"), or null if nothing in the master
 * list is a confident match. A key is accepted as itself.
 *
 * With no city, a typo is matched against Kinshasa's communes first and only
 * then the others, so a Kinshasa misspelling never lands in another city.
 *
 * @param {string} input
 * @param {{city?: string|null}} [options]
 */
function resolveCommune(input, { city = null } = {}) {
  if (!input) return null;
  if (LOCATIONS[input] && (!city || cities.cityOfCommune(input) === city)) return input;
  const key = normaliseText(input);
  if (COMMUNE_ALIASES[key] && (!city || city === cities.DEFAULT_CITY)) return COMMUNE_ALIASES[key];

  const exact = preferCity(COMMUNES.filter((c) => placeKey(cities.communeLabel(c)) === placeKey(input)), city);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const label = (c) => cities.communeLabel(c);
  if (city) return bestMatch(input, cities.communesOfCity(city), label);
  return bestMatch(input, KINSHASA_COMMUNES, label)
    || bestMatch(input, COMMUNES.filter((c) => !isKinshasa(c)), label);
}

/**
 * Canonical quartier name for a free-text guess. Searches within `commune`'s own
 * list when the commune is already known — tighter, and avoids a quartier name
 * that happens to also exist under a different commune matching the wrong one.
 * Falls back to every quartier in the city when the commune isn't known.
 */
function resolveQuartier(input, commune, { city = null } = {}) {
  if (!input) return null;
  const key = normaliseText(input);
  if (QUARTIER_ALIASES[key] && (!city || city === cities.DEFAULT_CITY)) return QUARTIER_ALIASES[key];

  const canonicalCommune = commune ? resolveCommune(commune, { city }) : null;
  if (canonicalCommune) {
    // Exact first, numerals folded: as raw text "Yolo Sud 2" is one edit from
    // "Yolo Sud I" and two from "Yolo Sud II", and the typo match stored the I.
    const exact = LOCATIONS[canonicalCommune].find((q) => placeKey(q) === placeKey(input));
    return exact || bestMatch(input, LOCATIONS[canonicalCommune]);
  }

  // No commune: never a citywide edit-distance guess. That turned "Wangata"
  // into Mangana (Kimbanseke) and "tonde" into Konde (Selembao), and the wrong
  // name was then stored. Only a name that reads as exactly one official
  // spelling is canonicalised ("salongo" → "Salongo" in every commune it is in).
  const found = inferCommune(input, { city });
  if (found.status === 'unknown' || found.how === 'contained' || found.how === 'stated') return null;
  // Only the communes left after the city preference count: Kampemba's
  // "Industriel" must not stop Limete's being canonicalised.
  const candidates = found.status === 'unique' ? [found.commune] : found.communes;
  const byCommune = PLACE_INDEX.get(found.matched);
  const official = new Set(candidates.map((c) => byCommune.get(c)).filter(Boolean));
  return official.size === 1 ? [...official][0] : null;
}

/**
 * The exact quartier list for one commune — the data a cascading "commune"
 * dropdown uses to populate its "quartier" sibling. Accepts a raw guess
 * ("gombé") as well as the canonical spelling; returns [] for an unknown
 * commune rather than throwing, so a not-yet-selected commune is a normal,
 * quiet state for a form to be in.
 */
function quartiersForCommune(commune, { city = null } = {}) {
  if (!commune) return [];
  const canonical = resolveCommune(commune, { city }) || commune;
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

// ---------------------------------------------------------------------------
// Commune inference from a quartier — "GB" → Ngaliema, "Funa" → ask.
// ---------------------------------------------------------------------------
//
// Agents often name only the quartier, or a lieu-dit ("GB", "Mimosas",
// "Righini") that is not an official quartier at all. Two sources feed one
// index: the official quartiers (kinshasa_locations.json) and the sourced
// aliases (kinshasa_quartier_aliases.json). A name that belongs to ONE commune
// lets intake deduce it — shown on the card as deduced, confirmed by the
// agent's "OK"; a name that belongs to several is never guessed: the card asks.
//
// Measured on every quartier agents had typed on live listings (2026-10-07):
// the old citywide fuzzy match resolved 12 of 32, and some of those wrongly
// ("Wangata" → Mangana, Kimbanseke; "tonde" → Konde, Selembao). Fuzzy matching
// here is therefore strict, and a deduction is never written over the agent's
// own quartier text unless it is a real official quartier.

const ALIAS_DATA = require(path.join(__dirname, '..', 'kinshasa_quartier_aliases.json'));
// Other cities' aliases count only once a local agent has confirmed them
// (drc_quartier_aliases.json, status "confirmed"); "pending" ones are kept for
// that check and read by nothing.
const DRC_ALIAS_DATA = require(path.join(__dirname, '..', 'drc_quartier_aliases.json'));

/** Accent/case-folded, punctuation as spaces: "Saïo-UPAC" → "saio upac". */
const ROMAN = { 1: 'i', 2: 'ii', 3: 'iii', 4: 'iv' };

function placeKey(text) {
  return normaliseText(text)
    .replace(/[-'’/.,;:()_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // "Yolo Sud 2" and "Yolo Sud II" are one quartier.
    .replace(/\b([1-4])\b/g, (digit) => ROMAN[digit]);
}

/** "matonge i" / "matonge 1" → "matonge"; null when there is no numeral. */
function withoutNumeral(key) {
  const stripped = key.replace(/\s+(?:i{1,3}|iv|v|[1-9])$/, '');
  return stripped !== key && stripped.length >= 3 ? stripped : null;
}

/**
 * Official names that are also ordinary words, provinces or people. Found
 * INSIDE a longer text they say nothing about where a listing is ("École petits
 * lutins" is a landmark in Kintambo, not Lemba's quartier École; "avenue
 * Kasaï" runs through half the city), so they only count when they ARE the
 * whole text.
 */
const GENERIC_KEYS = new Set([
  'ecole', 'foire', 'commerce', 'commercial', 'gare', 'golf', 'fleuve', 'cliniques', 'revolution', 'paix',
  'mission', 'domaine', 'abattoir', 'television', 'industriel', 'residentiel', 'agricole', 'congo', 'kasai',
  'katanga', 'kivu', 'boma', 'matadi', 'lumumba', 'kabila', 'salongo', 'liberation', 'plateau', 'pecheurs',
  'inga', 'goma', 'bandundu', 'equateur', 'oriental', 'kwango', 'mongala', 'ubangi', 'mbandaka', 'kisantu',
  'lubumbashi', 'kalunga', 'lubudi', 'regideso', 'echangeur', 'oasis', 'sans fil', 'kasa vubu', 'wenze',
]);

/** Words that put a NAME on a street, not on a place: "avenue Kalamu" is not Kalamu. */
const STREET_WORDS = new Set(['av', 'ave', 'avenue', 'rue', 'bd', 'boulevard', 'blvd', 'route', 'croisement', 'arret']);

/** key → Map(commune → canonical official quartier, or null for "a place in that commune") */
const PLACE_INDEX = new Map();
/** keys that came from the alias file (short curated names like "GB" are allowed inside text). */
const ALIAS_KEYS = new Set();

function indexPlace(key, commune, quartier) {
  if (!key) return;
  if (!PLACE_INDEX.has(key)) PLACE_INDEX.set(key, new Map());
  const byCommune = PLACE_INDEX.get(key);
  // Two official quartiers of one commune under one key (Kauka I/II/III → "kauka")
  // still name that commune; they just no longer name one quartier.
  if (byCommune.has(commune) && byCommune.get(commune) !== quartier) byCommune.set(commune, null);
  else if (!byCommune.has(commune)) byCommune.set(commune, quartier);
}

for (const [commune, quartiers] of Object.entries(LOCATIONS)) {
  for (const quartier of quartiers) {
    const key = placeKey(quartier);
    indexPlace(key, commune, quartier);
    const base = withoutNumeral(key);
    if (base) indexPlace(base, commune, null);
  }
}
for (const alias of DRC_ALIAS_DATA.aliases || []) {
  for (const commune of alias.communes || []) {
    if (cities.cityOfCommune(commune) !== alias.city) {
      throw new Error(`drc_quartier_aliases.json: "${alias.name}" — commune "${commune}" is not in ${alias.city}`);
    }
  }
}
const CONFIRMED_ALIASES = [
  ...(ALIAS_DATA.aliases || []),
  ...(DRC_ALIAS_DATA.aliases || []).filter((alias) => alias.status === 'confirmed'),
];
for (const alias of CONFIRMED_ALIASES) {
  const key = placeKey(alias.name);
  ALIAS_KEYS.add(key);
  for (const raw of alias.communes || []) {
    const commune = COMMUNE_KEY_ALIASES[raw] || raw;
    if (!LOCATIONS[commune]) throw new Error(`quartier aliases: unknown commune "${raw}" for "${alias.name}"`);
    // An alias only carries a quartier when it is that commune's official one.
    const quartier = alias.quartier && LOCATIONS[commune].includes(alias.quartier) ? alias.quartier : null;
    indexPlace(key, commune, quartier);
  }
}
// The communes themselves, by name (a suffixed key by its label, so "kalamu"
// names both Kalamus). A commune named like its own city — Kinshasa,
// Lubumbashi, Likasi, Goma, Kisangani, Kananga, Matadi — is left out: every
// address there ends with that name, so it names the city far more often than
// the commune.
for (const commune of COMMUNES) {
  const label = cities.communeLabel(commune);
  if (label !== cities.cityOfCommune(commune)) indexPlace(placeKey(label), commune, null);
}
for (const [alias, commune] of Object.entries(COMMUNE_ALIASES)) {
  if (commune !== 'Kinshasa') indexPlace(placeKey(alias), commune, null);
}

function placeResult(byCommune, how, matched, city = null) {
  const communes = preferCity([...byCommune.keys()], city).sort();
  if (!communes.length) return { status: 'unknown' };
  if (communes.length === 1) {
    return { status: 'unique', commune: communes[0], quartier: byCommune.get(communes[0]) || null, how, matched };
  }
  return { status: 'ambiguous', communes, how, matched };
}

/**
 * Which commune a free-text place names.
 *
 * @param {string} text  What the agent wrote: a quartier, a lieu-dit, "Saïo-UPAC",
 *   "Matonge/Kauka", "Commune de Ngiri Ngiri Avenue Monkoto".
 * @param {{allowFuzzy?: boolean, city?: string|null}} [options]  `city` restricts
 *   the answer to that city's communes (a name found only elsewhere is unknown).
 * @returns {{status: 'unique', commune: string, quartier: string|null, how: string, matched: string}
 *          | {status: 'ambiguous', communes: string[], how: string, matched: string}
 *          | {status: 'unknown'}}
 *   `quartier` is set only when the text named exactly one OFFICIAL quartier.
 */
function inferCommune(text, { allowFuzzy = true, city = null } = {}) {
  const key = placeKey(text);
  if (!key) return { status: 'unknown' };

  // 1. Said outright: "commune de Ngiri Ngiri …", "C/ Lemba".
  const stated = key.match(/\b(?:commune(?: de| d)?|c)\s+(.+)$/);
  if (stated) {
    const words = stated[1].split(' ');
    for (let n = Math.min(3, words.length); n >= 1; n -= 1) {
      const candidate = words.slice(0, n).join(' ');
      const named = COMMUNE_ALIASES[candidate] && (!city || city === cities.DEFAULT_CITY)
        ? [COMMUNE_ALIASES[candidate]]
        : preferCity(COMMUNES.filter((c) => placeKey(cities.communeLabel(c)) === candidate), city);
      if (named.length === 1) return { status: 'unique', commune: named[0], quartier: null, how: 'stated', matched: candidate };
      if (named.length > 1) return { status: 'ambiguous', communes: named.sort(), how: 'stated', matched: candidate };
    }
  }

  // 2. The whole text is a known name.
  if (PLACE_INDEX.has(key)) {
    const result = placeResult(PLACE_INDEX.get(key), 'exact', key, city);
    if (result.status !== 'unknown') return result;
  }

  // 3. Known names inside a longer text, longest first.
  const tokens = key.split(' ');
  const covered = new Array(tokens.length).fill(false);
  const hits = [];
  for (let size = Math.min(5, tokens.length); size >= 1; size -= 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      if (covered.slice(start, start + size).some(Boolean)) continue;
      const phrase = tokens.slice(start, start + size).join(' ');
      if (!PLACE_INDEX.has(phrase)) continue;
      if (start > 0 && STREET_WORDS.has(tokens[start - 1])) continue;
      const curated = ALIAS_KEYS.has(phrase);
      if (!curated && (GENERIC_KEYS.has(phrase) || phrase.length < 4)) continue;
      hits.push(phrase);
      for (let i = start; i < start + size; i += 1) covered[i] = true;
    }
  }
  if (hits.length) {
    const merged = new Map();
    for (const hit of hits) {
      for (const [commune, quartier] of PLACE_INDEX.get(hit)) {
        if (!merged.has(commune)) merged.set(commune, hits.length === 1 ? quartier : null);
      }
    }
    const result = placeResult(merged, 'contained', hits.join(', '), city);
    if (result.status !== 'unknown') return result;
  }

  // 4. A typo of a known name — strict: same first letter, one edit for a short
  // name, two for a long one, and a single best candidate.
  if (allowFuzzy && key.length >= 5) {
    const tolerance = key.length >= 9 ? 2 : 1;
    let best = [];
    let bestDistance = Infinity;
    for (const candidate of PLACE_INDEX.keys()) {
      if (candidate[0] !== key[0] || Math.abs(candidate.length - key.length) > tolerance) continue;
      if (GENERIC_KEYS.has(candidate)) continue;
      if (!preferCity([...PLACE_INDEX.get(candidate).keys()], city).length) continue;
      const distance = levenshtein(key, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [candidate];
      } else if (distance === bestDistance) {
        best.push(candidate);
      }
    }
    if (bestDistance <= tolerance && best.length === 1) return placeResult(PLACE_INDEX.get(best[0]), 'fuzzy', best[0], city);
  }

  return { status: 'unknown' };
}

/**
 * The commune a short reply names and nothing else — "Limete", "c'est à
 * Barumbu", "commune de Kinshasa" — or null. Exact names and the curated short
 * forms only, never a fuzzy guess: this is how an agent answers the card's
 * "dans quelle commune ?", and a misread answer would publish the wrong one.
 */
function communeNamedIn(reply, { city = null } = {}) {
  const key = placeKey(reply)
    .replace(/^(?:c est|cest|c|a|au|dans|la commune|commune)(?: de| d| a)?\s+/, '')
    .replace(/^(?:la commune|commune)(?: de| d)?\s+/, '')
    .trim();
  if (!key || key.split(' ').length > 4) return null;
  if (COMMUNE_ALIASES[key] && (!city || city === cities.DEFAULT_CITY)) return COMMUNE_ALIASES[key];
  // "Kalamu (Boma)", typed back the way the card printed it.
  const asKey = COMMUNES.find((c) => placeKey(c) === key);
  if (asKey && (!city || cities.cityOfCommune(asKey) === city)) return asKey;
  const named = preferCity(COMMUNES.filter((c) => placeKey(cities.communeLabel(c)) === key), city);
  return named.length === 1 ? named[0] : null;
}

/**
 * "Quartier, Commune" — the one way a listing's place is written in every
 * WhatsApp message the engine sends (product rule, 2026-10-07: quartier first,
 * then commune when known). Either half alone when the other is missing; the
 * commune alone when the quartier is just its name again. web/lib/placeLabel.js
 * is the storefront's copy — change one, change the other.
 */
function placeLabel({ quartier = null, commune = null, city = null } = {}) {
  const rawCommune = String(commune || '').replace(/\s+/g, ' ').trim();
  const q = String(quartier || '').replace(/\s+/g, ' ').trim();
  const c = cities.communeLabel(rawCommune);
  // Outside Kinshasa the city closes the label ("Bel-Air I, Kampemba,
  // Lubumbashi"), once — never after a commune that already carries its name.
  // Kinshasa's labels are unchanged.
  const town = cities.cityOfCommune(rawCommune) || cities.resolveCity(city);
  const tail = town && town !== cities.DEFAULT_CITY ? town : '';
  const parts = [];
  for (const part of [q, c, tail]) {
    if (part && !parts.some((p) => placeKey(p) === placeKey(part))) parts.push(part);
  }
  return parts.join(', ');
}

/**
 * What intake does with an extraction's location, before it is stored.
 *
 * - A stated commune is canonicalised; the quartier is matched within it.
 * - No commune: the quartier (then the reference) is read with inferCommune().
 *   One commune → `commune` is filled and `communeInferredFrom` says from what;
 *   several → `ambiguous` lists them and the commune stays empty for the card
 *   to ask about. The quartier is only rewritten when it IS an official one.
 *
 * - `city` (the model's reading of the message, or the agent's own city)
 *   restricts all of it to that city's communes; with none, see the header.
 *   The returned `city` is the commune's city when one was found, else the
 *   stated city, else null (= Kinshasa, as every older row is).
 *
 * @param {{commune?: string|null, quartier?: string|null, reference?: string|null, city?: string|null}} location
 * @returns {{commune: string|null, quartier: string|null, city: string|null, communeInferredFrom: string|null,
 *            ambiguous: {name: string, communes: string[]}|null}}
 */
function inferListingLocation({ commune = null, quartier = null, reference = null, city = null } = {}) {
  const statedCity = cities.resolveCity(city);
  const done = (result) => ({ ...result, city: cities.cityOfCommune(result.commune) || statedCity || null });
  if (commune) {
    const resolved = resolveCommune(commune, { city: statedCity })
      // A commune the stated city does not have: the commune is the more
      // specific of the two, so it wins ("Gombe" when the model read "Goma").
      || resolveCommune(commune)
      || commune;
    const q = quartier ? resolveQuartier(quartier, resolved) || quartier : quartier;
    return done({ commune: resolved, quartier: q, communeInferredFrom: null, ambiguous: null });
  }
  for (const [field, text, allowFuzzy] of [['quartier', quartier, true], ['reference', reference, false]]) {
    if (!text) continue;
    const found = inferCommune(text, { allowFuzzy, city: statedCity });
    if (found.status === 'unique') {
      return done({
        commune: found.commune,
        quartier: field === 'quartier' && found.quartier ? found.quartier : quartier,
        communeInferredFrom: String(text).trim(),
        ambiguous: null,
      });
    }
    if (found.status === 'ambiguous') {
      return done({ commune: null, quartier, communeInferredFrom: null, ambiguous: { name: String(text).trim(), communes: found.communes } });
    }
  }
  return done({ commune: null, quartier, communeInferredFrom: null, ambiguous: null });
}

module.exports = {
  LOCATIONS,
  COMMUNES,
  KINSHASA_COMMUNES,
  ALL_QUARTIERS,
  resolveCommune,
  resolveQuartier,
  inferCommune,
  inferListingLocation,
  communeNamedIn,
  placeLabel,
  placeKey,
  quartiersForCommune,
  isValidQuartier,
  cascadeCommuneChange,
  normaliseText,
  COMMUNE_KEY_ALIASES,
};
