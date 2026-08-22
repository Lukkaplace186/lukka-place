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
    if (row.norm.length < 4) continue;
    const matchIndex = norm.indexOf(row.norm);
    if (matchIndex === -1) continue;
    const isWordStart = matchIndex === 0 || norm[matchIndex - 1] === ' ' || norm[matchIndex - 1] === '-';
    if (!isWordStart) continue;
    if (!best || row.norm.length > best.norm.length) best = row;
  }

  return best ? { type: best.type, label: best.label, commune: best.commune } : null;
}

/** @returns {string[]} every real commune name, in gazetteer order */
export function allCommuneNames() {
  return gazetteer.map((c) => c.commune);
}

export function defaultCommuneOrder() {
  return DEFAULT_COMMUNE_ORDER;
}
