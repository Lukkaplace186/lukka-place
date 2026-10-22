/**
 * Practical details renters and buyers ask about first (2026-10-22).
 *
 *   furnished              meublé / non meublé (already extracted; now synced)
 *   households_count       "3 ménages dans la parcelle" — households sharing it
 *   landlord_on_site       the landlord lives in the parcelle
 *   toilet_location        'interieur' | 'exterieur'
 *   shower_location        'interieur' | 'exterieur'
 *   electricity_meter      'prepaye' (individual Cash Power) | 'individuel' | 'partage'
 *   plot_dimensions        the land as the agent wrote it: "15/20", "5 ares", "1 ha"
 *   plot_area_m2           derived from plot_dimensions by parsePlotArea — never
 *                          the model's arithmetic
 *   installments_available "paiement échelonné" on a sale
 *   installment_terms      the agent's own words for those terms
 *
 * Every field is NULL when the message does not state it: NULL is "not
 * stated", never "no". Each is gated on the kind of property it can describe
 * (a bare plot has no toilet; a flat has no plot; a rent is not paid in
 * instalments), so a field the model filled on the wrong kind is dropped.
 *
 * Postgres: `properties` columns (migrations/20261022_listing_details.sql).
 * SQLite: `listings` columns, booleans as 0/1.
 *
 * parsePlotArea is DUPLICATED in web/lib/listingDetails.js (this engine is
 * CommonJS, outside the app's module graph). Both test suites run the same
 * fixture table (PLOT_AREA_FIXTURES below, copied there) — change one,
 * change the other.
 */

const { isCommercialType } = require('./commercial');

const LOCATIONS = Object.freeze(['interieur', 'exterieur']);
const METERS = Object.freeze(['prepaye', 'individuel', 'partage']);

const DETAIL_FIELDS = Object.freeze([
  'furnished', 'households_count', 'landlord_on_site', 'toilet_location', 'shower_location',
  'electricity_meter', 'plot_dimensions', 'plot_area_m2', 'installments_available', 'installment_terms',
]);
const BOOLEAN_DETAIL_FIELDS = Object.freeze(['furnished', 'landlord_on_site', 'installments_available']);

const HOUSEHOLDS_MAX = 200;
const PLOT_DIMENSIONS_MAX = 60;
const INSTALLMENT_TERMS_MAX = 300;
const PLOT_M2_MIN = 1;
const PLOT_M2_MAX = 100000000; // 10 000 ha

/** Bare land: no rooms, no meter, no household. */
const LAND_ONLY_TYPES = Object.freeze(['terrain', 'ferme']);
/** A unit with no land of its own to measure. */
const NO_PLOT_TYPES = Object.freeze(['appartement', 'studio', 'chambre', 'chambre_salon', 'bureau', 'boutique']);

function isLandOnly(propertyType, parcelleSubtype) {
  const type = String(propertyType || '').trim().toLowerCase();
  return LAND_ONLY_TYPES.includes(type) || (type === 'parcelle' && parcelleSubtype === 'terrain_nu');
}

function tristate(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function oneOf(value, allowed) {
  const folded = String(value ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return allowed.includes(folded) ? folded : null;
}

function shortText(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function wholeInRange(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

/** "1 200,50" / "1.200" / "12,5" → number. A lone dot or comma is a decimal. */
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

/**
 * The land's size in m² from the way agents write it, or null:
 *   "1 ha", "1,5 hectare"            → 10 000, 15 000
 *   "5 ares", "12 are"               → 500, 1 200
 *   "15/20", "20 x 30 m", "5,30m sur 18m", "15 par 20" → the product
 *   "600 m²", "600m2", "1.200 m2"    → as written
 * Hectares win over ares, ares over dimensions, dimensions over m², so
 * "terrain de 5 ares (25x20)" reads the unit the agent named.
 */
function parsePlotArea(text) {
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

/** Shared with web/tests/unit/listing-details.test.js — keep the two tables identical. */
const PLOT_AREA_FIXTURES = Object.freeze([
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
]);

/**
 * Every detail, valid or null, gated on what the property can have.
 *
 * @param {Object} source anything carrying the keys
 * @param {Object} [kind] { propertyType, parcelleSubtype, transactionType };
 *   omit to skip the gate (a correction that names no type — the draft's
 *   type decides at write time).
 */
function normaliseListingDetails(source = {}, kind) {
  const s = source || {};
  const dimensions = shortText(s.plot_dimensions, PLOT_DIMENSIONS_MAX);
  const out = {
    furnished: tristate(s.furnished),
    households_count: wholeInRange(s.households_count, 1, HOUSEHOLDS_MAX),
    landlord_on_site: tristate(s.landlord_on_site),
    toilet_location: oneOf(s.toilet_location, LOCATIONS),
    shower_location: oneOf(s.shower_location, LOCATIONS),
    electricity_meter: oneOf(s.electricity_meter, METERS),
    plot_dimensions: dimensions,
    plot_area_m2: dimensions ? parsePlotArea(dimensions) : null,
    installments_available: tristate(s.installments_available),
    installment_terms: shortText(s.installment_terms, INSTALLMENT_TERMS_MAX),
  };
  if (out.installment_terms && out.installments_available === null) out.installments_available = true;
  if (!kind) return out;

  const { propertyType, parcelleSubtype, transactionType } = kind;
  const type = String(propertyType || '').trim().toLowerCase();
  const commercial = isCommercialType(type);
  const landOnly = isLandOnly(type, parcelleSubtype);
  if (landOnly) out.furnished = null;
  if (landOnly || commercial) {
    out.households_count = null;
    out.landlord_on_site = null;
    out.toilet_location = null;
    out.shower_location = null;
  }
  if (landOnly) out.electricity_meter = null;
  if (NO_PLOT_TYPES.includes(type)) {
    out.plot_dimensions = null;
    out.plot_area_m2 = null;
  }
  if (transactionType === 'location') {
    out.installments_available = null;
    out.installment_terms = null;
  }
  return out;
}

const METER_LABELS_FR = { prepaye: 'Cash Power (prépayé, individuel)', individuel: 'Individuel', partage: 'Partagé' };

function areaLabelFr(m2) {
  if (!Number.isFinite(m2)) return null;
  const sqm = `${m2.toLocaleString('fr-FR')} m²`;
  if (m2 >= 10000) return `${sqm} · ${(Math.round((m2 / 10000) * 100) / 100).toLocaleString('fr-FR')} ha`;
  if (m2 >= 100) return `${sqm} · ${(Math.round(m2) / 100).toLocaleString('fr-FR')} ares`;
  return sqm;
}

/** WhatsApp intake-card lines for the details a row states (already gated). */
function detailCardLines(row) {
  const lines = [];
  const yesNo = (v) => (v ? 'Oui' : 'Non');
  if (row.furnished === true || row.furnished === false) lines.push(`*Meublé* : ${yesNo(row.furnished)}`);
  if (row.households_count) lines.push(`*Ménages dans la parcelle* : ${row.households_count}`);
  if (row.landlord_on_site === true || row.landlord_on_site === false) lines.push(`*Bailleur sur place* : ${yesNo(row.landlord_on_site)}`);
  if (row.toilet_location) lines.push(`*Toilettes* : ${row.toilet_location === 'interieur' ? 'intérieures' : 'extérieures'}`);
  if (row.shower_location) lines.push(`*Douche* : ${row.shower_location === 'interieur' ? 'intérieure' : 'extérieure'}`);
  if (row.electricity_meter) lines.push(`*Compteur électrique* : ${METER_LABELS_FR[row.electricity_meter]}`);
  if (row.plot_dimensions) {
    const area = areaLabelFr(Number(row.plot_area_m2));
    lines.push(`*Terrain* : ${row.plot_dimensions}${area && area !== row.plot_dimensions ? ` (${area})` : ''}`);
  }
  if (row.installments_available === true) {
    lines.push(`*Paiement échelonné* : Oui${row.installment_terms ? ` — ${row.installment_terms}` : ''}`);
  }
  return lines;
}

module.exports = {
  DETAIL_FIELDS,
  BOOLEAN_DETAIL_FIELDS,
  LOCATIONS,
  METERS,
  HOUSEHOLDS_MAX,
  PLOT_AREA_FIXTURES,
  parsePlotArea,
  normaliseListingDetails,
  detailCardLines,
  areaLabelFr,
  isLandOnly,
};
