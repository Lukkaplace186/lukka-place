/**
 * services/cities.js
 *
 * The cities Lukka Place covers, and which communes belong to each. Kinshasa
 * comes from kinshasa_locations.json (unchanged); every other city from
 * drc_locations.json. services/locations.js builds its commune/quartier index
 * on top of this, so the two never disagree about which communes exist.
 *
 * A commune is identified by its KEY, unique in the whole country: its name,
 * except where another city already has a commune of that name — then the key
 * carries the city in brackets ("Kalamu (Boma)", never touching Kinshasa's
 * "Kalamu"). Communes are stored as plain text in a dozen tables (leads,
 * agents.primary_communes, developments, viewing_requests…); a bare "Kalamu"
 * shared by two cities would route a Boma request to Kinshasa agencies.
 * `communeLabel` is how a key is shown to a person.
 */

const path = require('path');

const KINSHASA_RAW = require(path.join(__dirname, '..', 'kinshasa_locations.json'));
const DRC = require(path.join(__dirname, '..', 'drc_locations.json'));

/** Same canonicalisation services/locations.js applies to Kinshasa's file. */
const KINSHASA_KEY_ALIASES = { "N'Djili": 'Ndjili', "N'Sele": 'Nsele' };

const DEFAULT_CITY = 'Kinshasa';

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-'’/.,;:()_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return fold(text).replace(/\s+/g, '-');
}

/** city name -> { name, slug, province, utcOffset, communes: { key -> quartier[] } } */
const CITIES = {
  [DEFAULT_CITY]: {
    name: DEFAULT_CITY,
    slug: 'kinshasa',
    province: 'Kinshasa',
    utcOffset: 1,
    communes: Object.fromEntries(
      Object.entries(KINSHASA_RAW).map(([commune, quartiers]) => [KINSHASA_KEY_ALIASES[commune] || commune, quartiers]),
    ),
  },
};
for (const [name, city] of Object.entries(DRC.cities)) {
  CITIES[name] = {
    name,
    slug: slugify(name),
    province: city.province,
    utcOffset: city.utc_offset,
    communes: city.communes,
  };
}

const CITY_NAMES = Object.keys(CITIES);

/** commune key -> city name */
const COMMUNE_CITY = new Map();
for (const city of Object.values(CITIES)) {
  for (const key of Object.keys(city.communes)) {
    if (COMMUNE_CITY.has(key)) {
      throw new Error(`drc_locations.json: commune key "${key}" is in ${COMMUNE_CITY.get(key)} and ${city.name} — suffix the newer one with its city`);
    }
    COMMUNE_CITY.set(key, city.name);
  }
}

/** "Kalamu (Boma)" -> "Kalamu". A key without brackets is already its label. */
function communeLabel(key) {
  return String(key || '').replace(/\s*\([^)]*\)\s*$/, '');
}

/** The city a commune key belongs to, or null for a key no city lists. */
function cityOfCommune(key) {
  return key ? COMMUNE_CITY.get(key) || null : null;
}

/** Commune keys of one city ([] for an unknown city). */
function communesOfCity(city) {
  return CITIES[city] ? Object.keys(CITIES[city].communes) : [];
}

// How agents write the cities. Only spellings in real use and with no other
// meaning: "Lshi" is Lubumbashi everywhere in the country, "Kin" is Kinshasa.
const CITY_ALIASES = {
  kin: 'Kinshasa',
  kinshasa: 'Kinshasa',
  lshi: 'Lubumbashi',
  'l shi': 'Lubumbashi',
  lubum: 'Lubumbashi',
  mbujimayi: 'Mbuji-Mayi',
  mbuji: 'Mbuji-Mayi',
  moanda: 'Muanda',
};

/**
 * Canonical city for a free-text name ("lubumbashi", "Lshi", "Mbuji Mayi"),
 * or null. Exact only: a city decides which communes a listing can be in, and
 * a guessed one would move a listing across the country.
 */
function resolveCity(text) {
  const key = fold(text);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(CITY_ALIASES, key)) return CITY_ALIASES[key];
  return CITY_NAMES.find((name) => fold(name) === key) || null;
}

/**
 * Hours ahead of UTC for a city. Kinshasa, Kongo Central: +1. Katanga, the
 * Kasaïs, Tshopo and the Kivus: +2. The DRC observes no daylight saving, so a
 * fixed offset is exact. Unknown or null → Kinshasa's, which is what every
 * row predating this module was written in.
 */
function utcOffsetForCity(city) {
  return (CITIES[city] || CITIES[DEFAULT_CITY]).utcOffset;
}

/** Hours ahead of UTC where this commune is; Kinshasa's for an unknown one. */
function utcOffsetForCommune(commune) {
  return utcOffsetForCity(cityOfCommune(commune));
}

/** Public, JSON-safe description of every city (GET /locations, web). */
function citySummaries() {
  return CITY_NAMES.map((name) => {
    const city = CITIES[name];
    return {
      name,
      slug: city.slug,
      province: city.province,
      utcOffset: city.utcOffset,
      communes: Object.keys(city.communes).map((key) => ({ key, label: communeLabel(key) })),
    };
  });
}

module.exports = {
  CITIES,
  CITY_NAMES,
  DEFAULT_CITY,
  cityOfCommune,
  communesOfCity,
  communeLabel,
  resolveCity,
  utcOffsetForCity,
  utcOffsetForCommune,
  citySummaries,
};
