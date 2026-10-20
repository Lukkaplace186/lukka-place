/**
 * The cities Lukka Place covers (2026-10-20) — pure data and helpers, safe on
 * both server and client. Data: lib/data/cities.json, generated from the
 * engine's kinshasa_locations.json + drc_locations.json (root CLAUDE.md,
 * "Cities beyond Kinshasa"); tests/unit/cities-data.test.js keeps the two in
 * step.
 *
 * A commune is identified by its KEY, unique nationwide: its name, except
 * where another city has a commune of that name — "Kalamu (Boma)" beside
 * Kinshasa's "Kalamu". `communeLabel` is how a key is shown. Kinshasa's keys
 * are never suffixed, so every Kinshasa-only reader is unchanged.
 */
import data from './data/cities.json';

export const DEFAULT_CITY = 'Kinshasa';

/** A city becomes public (city picker, ?ville=) from this many live listings. */
export const MIN_PUBLIC_CITY_LISTINGS = 3;

/** Zoom a city opens at when no place inside it is named. */
export const CITY_DEFAULT_ZOOM = 13;

/** Half-width, in degrees, of the box a non-Kinshasa city's listings must sit in. */
const CITY_ENVELOPE_DEG = 0.3;

export const CITIES = data.cities;

const COMMUNE_CITY = new Map();
const COMMUNE_POINT = new Map();
for (const city of CITIES) {
  for (const commune of city.communes) {
    COMMUNE_CITY.set(commune.key, city.name);
    if (commune.point) COMMUNE_POINT.set(commune.key, commune.point);
  }
}

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "Kalamu (Boma)" → "Kalamu". */
export function communeLabel(key) {
  return String(key || '').replace(/\s*\([^)]*\)\s*$/, '');
}

/** The city a commune key belongs to, or null. */
export function cityOfCommune(key) {
  return key ? COMMUNE_CITY.get(key) || null : null;
}

/** The city record for a name or slug ("lubumbashi", "Mbuji-Mayi"), or null. */
export function findCity(nameOrSlug) {
  const key = fold(nameOrSlug);
  if (!key) return null;
  return CITIES.find((c) => fold(c.name) === key || fold(c.slug) === key) || null;
}

/** Commune keys of one city ([] for an unknown one). */
export function communesOfCity(name) {
  const city = findCity(name);
  return city ? city.communes.map((c) => c.key) : [];
}

/** A non-Kinshasa commune's own geocoded point, or null. Kinshasa's live in lib/geocoding.js. */
export function communePoint(key) {
  return COMMUNE_POINT.get(key) || null;
}

/** A city's geocoded centre (null for Kinshasa — lib/mapViewport.js owns its default view). */
export function cityCenter(name) {
  return findCity(name)?.center || null;
}

/** The box a city's coordinates must fall in to count as that city's. */
export function cityEnvelope(name) {
  const center = cityCenter(name);
  if (!center) return null;
  return {
    south: center.lat - CITY_ENVELOPE_DEG,
    north: center.lat + CITY_ENVELOPE_DEG,
    west: center.lng - CITY_ENVELOPE_DEG,
    east: center.lng + CITY_ENVELOPE_DEG,
  };
}

/** "Bel-Air I, Kampemba" in Kinshasa stays "…, Commune"; elsewhere the city closes the label. */
export function cityTail(commune) {
  const city = cityOfCommune(commune);
  return city && city !== DEFAULT_CITY ? city : null;
}

/**
 * The commune keys given, grouped by city for a <select>'s optgroups, in the
 * order given within each city, Kinshasa first. A key no city lists (a
 * database-derived fallback) goes in a group of its own at the end.
 *
 * @param {string[]} keys
 * @returns {Array<{city: string|null, options: Array<{value: string, label: string}>}>}
 */
export function groupCommunesByCity(keys = []) {
  const groups = new Map();
  for (const key of keys) {
    const city = cityOfCommune(key);
    if (!groups.has(city)) groups.set(city, []);
    groups.get(city).push({ value: key, label: communeLabel(key) });
  }
  const order = [...CITIES.map((c) => c.name), null];
  return order.filter((c) => groups.has(c)).map((city) => ({ city, options: groups.get(city) }));
}

/**
 * The city a listings search runs in: `ville` when it names a real city, else
 * the first searched commune's city, else Kinshasa (lib/listings.js
 * buildFilters). Whether that city is PUBLIC yet is the page's question
 * (lib/publicCities.js), not this one's.
 */
export function searchCityOf({ ville = null, commune = null, communes = null } = {}) {
  const asked = findCity(ville);
  if (asked) return asked.name;
  const first = [commune, ...(Array.isArray(communes) ? communes : [])].find(Boolean);
  return cityOfCommune(first) || DEFAULT_CITY;
}

/** How a commune reads in a flat list: "Gombe", "Kampemba · Lubumbashi", "Kalamu · Boma". */
export function communeOptionText(key) {
  const city = cityOfCommune(key);
  const label = communeLabel(key);
  return city && city !== DEFAULT_CITY && label !== city ? `${label} · ${city}` : label;
}

/** Hours ahead of UTC in a city: +1 Kinshasa / Kongo Central, +2 Katanga, Kasaïs, Tshopo, Kivus. */
export function utcOffsetForCity(name) {
  return findCity(name)?.utcOffset ?? 1;
}

/**
 * Hours ahead of UTC where a listing is: its commune's city, else its own
 * `city_name` (lib/listings.js SELECT_FIELDS), else Kinshasa's +1. The visit
 * picker builds its slots on this clock, and the booking actions check them
 * against it — a "14h" for a Lubumbashi house is 14h in Lubumbashi.
 */
export function utcOffsetForListing(listing) {
  return utcOffsetForCity(cityOfCommune(listing?.commune) || listing?.city_name || DEFAULT_CITY);
}
