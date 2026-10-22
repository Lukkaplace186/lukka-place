/**
 * Practical listing details (2026-10-22) — the facts renters and buyers ask
 * about first in Kinshasa. Pure and client-safe: shared by the listing
 * queries, the listing page, the filters and the agent / admin forms.
 *
 * Model and engine half: root CLAUDE.md, "Practical listing details". The
 * columns are `properties` columns (engine migrations/20261022_listing_details.sql),
 * read here through to_jsonb so nothing 42703s before it runs. NULL is "not
 * stated", never "no".
 *
 * parsePlotArea is DUPLICATED from the engine's services/listingDetails.js
 * (CommonJS, outside this module graph); both test suites run the same
 * PLOT_AREA_FIXTURES table — change one, change the other.
 */

/** Equipment the agent can only say yes to (toilet / shower were dropped 2026-10-22). */
export const EQUIPMENT_FIELDS = ['has_generator', 'has_pool', 'has_gym', 'has_solar'];
export const METERS = ['prepaye', 'individuel', 'partage'];
export const HOUSEHOLDS_MAX = 200;
export const PLOT_DIMENSIONS_MAX = 60;
export const INSTALLMENT_TERMS_MAX = 300;
const PLOT_M2_MIN = 1;
const PLOT_M2_MAX = 100000000;

/** Category names (lowercased) that are bare land: no rooms, meter or household. */
const LAND_ONLY_CATEGORIES = ['terrain', 'ferme / terrain agricole'];
/** Category names with no land of their own to measure. */
const NO_PLOT_CATEGORIES = ['appartement', 'studio', 'chambre / annexe', 'penthouse', 'bureau', 'boutique'];
/** Categories whose land size IS the listing (filter falls back to `area` for them). */
export const LAND_CATEGORY_NAMES = ['terrain', 'concession', 'ferme / terrain agricole'];

function readNumber(raw) {
  let s = String(raw).replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function roundArea(m2) {
  if (!Number.isFinite(m2) || m2 < PLOT_M2_MIN || m2 > PLOT_M2_MAX) return null;
  return Math.round(m2 * 100) / 100;
}

const NUM = '(\\d[\\d\\s.]*(?:,\\d+)?|\\d+(?:[.,]\\d+)?)';

/** "15/20" → 300, "5 ares" → 500, "1 ha" → 10 000, "600 m²" → 600, else null. */
export function parsePlotArea(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/²/g, '2');
  let m = t.match(new RegExp(`${NUM}\\s*(?:ha|hectares?)\\b`));
  if (m) return roundArea(readNumber(m[1]) * 10000);
  m = t.match(new RegExp(`${NUM}\\s*ares?\\b`));
  if (m) return roundArea(readNumber(m[1]) * 100);
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:m|metres?|mètres?)?\s*(?:x|\*|\/|sur|par)\s*(\d+(?:[.,]\d+)?)/);
  if (m) {
    const a = readNumber(m[1]);
    const b = readNumber(m[2]);
    if (a > 0 && b > 0 && a <= 5000 && b <= 5000) return roundArea(a * b);
  }
  m = t.match(new RegExp(`${NUM}\\s*(?:m2|metres?\\s+carres?)`));
  if (m) return roundArea(readNumber(m[1]));
  return null;
}

/** Same table as the engine's services/listingDetails.js — keep them identical. */
export const PLOT_AREA_FIXTURES = [
  ['15/20', 300],
  ['20 x 30 m', 600],
  ['20x30', 600],
  ['5,30m sur 18m', 95.4],
  ['15 par 20', 300],
  ['5 ares', 500],
  ['12 are', 1200],
  ['1 ha', 10000],
  ['1,5 hectare', 15000],
  ['2 hectares', 20000],
  ['600 m²', 600],
  ['600m2', 600],
  ['1.200 m2', 1200],
  ['terrain de 5 ares (25x20)', 500],
  ['bien situé', null],
  ['', null],
];

function tristate(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function oneOf(value, allowed) {
  const folded = String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return allowed.includes(folded) ? folded : null;
}

function shortText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function wholeInRange(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * Every detail, valid or null, gated on the category (its lowercased French
 * name and back-office type) and the purpose ('rent' | 'sale').
 */
export function normaliseListingDetails(source = {}, { categoryName, categoryType, purpose } = {}) {
  const s = source || {};
  const dimensions = shortText(s.plot_dimensions, PLOT_DIMENSIONS_MAX);
  const out = {
    furnished: tristate(s.furnished),
    households_count: wholeInRange(s.households_count, 1, HOUSEHOLDS_MAX),
    landlord_on_site: tristate(s.landlord_on_site),
    electricity_meter: oneOf(s.electricity_meter, METERS),
    // A stated yes only: "no" and silence both stay NULL.
    ...Object.fromEntries(EQUIPMENT_FIELDS.map((field) => [field, tristate(s[field]) === true ? true : null])),
    plot_dimensions: dimensions,
    plot_area_m2: dimensions ? parsePlotArea(dimensions) : null,
    installments_available: tristate(s.installments_available),
    installment_terms: shortText(s.installment_terms, INSTALLMENT_TERMS_MAX),
  };
  if (out.installment_terms && out.installments_available === null) out.installments_available = true;
  const name = String(categoryName || '').trim().toLowerCase();
  const landOnly = LAND_ONLY_CATEGORIES.includes(name);
  const commercial = String(categoryType || '').toLowerCase() === 'commercial';
  if (landOnly) {
    out.furnished = null;
    out.electricity_meter = null;
    for (const field of EQUIPMENT_FIELDS) out[field] = null;
  }
  if (landOnly || commercial) {
    out.households_count = null;
    out.landlord_on_site = null;
  }
  if (NO_PLOT_CATEGORIES.includes(name)) {
    out.plot_dimensions = null;
    out.plot_area_m2 = null;
  }
  if (purpose === 'rent') {
    out.installments_available = null;
    out.installment_terms = null;
  }
  return out;
}

/** Which groups of fields a form shows for a category + purpose. */
export function detailSections({ categoryName, categoryType, purpose } = {}) {
  const name = String(categoryName || '').trim().toLowerCase();
  const landOnly = LAND_ONLY_CATEGORIES.includes(name);
  const commercial = String(categoryType || '').toLowerCase() === 'commercial';
  return {
    living: !landOnly && !commercial,
    furnished: !landOnly,
    meter: !landOnly,
    equipment: !landOnly,
    plot: !NO_PLOT_CATEGORIES.includes(name),
    installments: purpose !== 'rent',
  };
}

/** The form's fields → details. A select's '' is "not stated". */
export function listingDetailsFromForm(formData, kind) {
  const get = (key) => {
    const value = formData.get(key);
    return value === null || value === '' ? null : String(value);
  };
  return normaliseListingDetails({
    furnished: get('furnished'),
    households_count: get('households_count'),
    landlord_on_site: get('landlord_on_site'),
    electricity_meter: get('electricity_meter'),
    ...Object.fromEntries(EQUIPMENT_FIELDS.map((field) => [field, formData.get(field) === '1' ? true : null])),
    plot_dimensions: get('plot_dimensions'),
    installments_available: formData.get('installments_available') === '1' ? true : null,
    installment_terms: get('installment_terms'),
  }, kind);
}

export const DETAIL_COLUMNS = [
  'furnished', 'households_count', 'landlord_on_site', 'electricity_meter',
  ...EQUIPMENT_FIELDS, 'plot_dimensions', 'plot_area_m2', 'installments_available', 'installment_terms',
];

/** One jsonb of every detail, read through to_jsonb (nulls before the migration). */
export const DETAILS_SQL = `(SELECT jsonb_build_object(${DETAIL_COLUMNS.map((c) => `'${c}', j -> '${c}'`).join(', ')})
   FROM (SELECT to_jsonb(p) AS j) d)`;

/**
 * The land's size in m² for filtering: the stated plot, else — for a listing
 * whose category IS land — its plain-number `area`. Needs `p`, `catc`.
 */
export const PLOT_M2_SQL = `COALESCE(
  NULLIF(to_jsonb(p) ->> 'plot_area_m2', '')::numeric,
  CASE WHEN LOWER(catc.name) IN (${LAND_CATEGORY_NAMES.map((n) => `'${n}'`).join(', ')}) OR p.parcelle_subtype = 'terrain_nu'
    THEN (CASE WHEN p.area::text ~ '^[[:space:]]*[0-9]+([.,][0-9]+)?[[:space:]]*(m|m2|m²)?[[:space:]]*$'
      THEN NULLIF(replace(regexp_replace(p.area::text, '[^0-9.,]', '', 'g'), ',', '.'), '')::numeric END) END)`;

/** A listing row's details object (jsonb arrives parsed), never null. */
export function detailsOf(listing) {
  const d = listing?.listing_details;
  return d && typeof d === 'object' ? d : {};
}

/** The plot's m² for a listing row, or null. */
export function plotAreaOf(listing) {
  const stated = Number(detailsOf(listing).plot_area_m2);
  if (Number.isFinite(stated) && stated > 0) return stated;
  const name = String(listing?.category_name || '').toLowerCase();
  if (LAND_CATEGORY_NAMES.includes(name) || listing?.parcelle_subtype === 'terrain_nu') {
    const area = Number(String(listing?.area ?? '').replace(',', '.').replace(/[^0-9.]/g, ''));
    if (Number.isFinite(area) && area > 0) return area;
  }
  return null;
}

/** Sale price per m² of land, rounded, or null (rents, no size, no price). */
export function pricePerM2(listing) {
  if (listing?.purpose !== 'sale') return null;
  const m2 = plotAreaOf(listing);
  const price = Number(listing?.price);
  if (!m2 || !(price > 0)) return null;
  return Math.round(price / m2);
}

/** "300 m² · 3 ares" / "2 ha" / "95,4 m²", for the given locale. */
export function plotAreaLabel(m2, locale = 'fr') {
  if (!Number.isFinite(m2) || m2 <= 0) return null;
  const fmt = (n) => n.toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: 2 });
  const sqm = `${fmt(m2)} m²`;
  if (m2 >= 10000) return `${sqm} · ${fmt(Math.round((m2 / 10000) * 100) / 100)} ha`;
  if (m2 >= 100) return `${sqm} · ${fmt(Math.round(m2) / 100)} ${locale === 'en' ? 'ares' : 'ares'}`;
  return sqm;
}

/** Plot-size filter bounds from URL values (m²), each a positive number or null. */
export function plotBounds(min, max) {
  const read = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let lo = read(min);
  let hi = read(max);
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  return { plotMin: lo, plotMax: hi };
}
