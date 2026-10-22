/**
 * Commercial spaces — offices, shops, warehouses (2026-10-19).
 *
 * "Commercial" is not a new property_type: it is the property_categories row's
 * own `type = 'commercial'` (Bureau, Boutique, Entrepôt, Bâtiment). On the
 * intake side that is COMMERCIAL_PROPERTY_TYPES below — the engine's own
 * property_type values whose category is commercial (services/postgres.js's
 * CATEGORY_FALLBACK_FR).
 *
 * Four specs describe a commercial space where bedrooms describe a home. All
 * are NULL when the agent did not state them — NULL is "not stated", never
 * "no": a shop whose message says nothing about the road has road_frontage
 * NULL, not false.
 *
 *   office_count   "5 bureaux" — rooms used as offices (never bedrooms)
 *   floor_level    0 = rez-de-chaussée, 1 = 1er étage, -1 = sous-sol
 *   road_frontage  façade / vitrine on the road ("au bord de la route")
 *   truck_access   a truck can reach and unload ("accès camion")
 *
 * Postgres: `properties` columns (migrations/20261019_commercial_spaces.sql).
 * SQLite: `listings` columns, booleans as 0/1.
 *
 * DUPLICATED in web/lib/commercialSpaces.js (this engine is CommonJS, outside
 * the app's module graph) — change one, change the other; the web test
 * compares the two.
 */

const COMMERCIAL_PROPERTY_TYPES = Object.freeze(['bureau', 'boutique', 'entrepot', 'immeuble', 'salle_de_fete']);

const COMMERCIAL_SPEC_FIELDS = Object.freeze(['office_count', 'floor_level', 'road_frontage', 'truck_access']);

const OFFICE_COUNT_MAX = 500;
const FLOOR_MIN = -3;
const FLOOR_MAX = 60;

function isCommercialType(propertyType) {
  return COMMERCIAL_PROPERTY_TYPES.includes(String(propertyType || '').trim().toLowerCase());
}

function wholeInRange(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function tristate(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/**
 * The four specs, each valid or null. For a property type that is not
 * commercial every spec is null: a house's "bureau" is a room, and an
 * apartment's floor is not what these columns record.
 *
 * @param {Object} source anything carrying the four keys
 * @param {string|null} [propertyType] omit to skip the type gate
 */
function normaliseCommercialSpecs(source = {}, propertyType) {
  const empty = { office_count: null, floor_level: null, road_frontage: null, truck_access: null };
  if (propertyType !== undefined && !isCommercialType(propertyType)) return empty;
  const s = source || {};
  return {
    office_count: wholeInRange(s.office_count, 0, OFFICE_COUNT_MAX),
    floor_level: wholeInRange(s.floor_level, FLOOR_MIN, FLOOR_MAX),
    road_frontage: tristate(s.road_frontage),
    truck_access: tristate(s.truck_access),
  };
}

/** "Rez-de-chaussée", "1er étage", "3e étage", "Sous-sol" — or null. */
function floorLabelFr(level) {
  if (level === null || level === undefined) return null;
  const n = Number(level);
  if (!Number.isInteger(n)) return null;
  if (n === 0) return 'Rez-de-chaussée';
  if (n < 0) return n === -1 ? 'Sous-sol' : `Sous-sol ${-n}`;
  return n === 1 ? '1er étage' : `${n}e étage`;
}

module.exports = {
  COMMERCIAL_PROPERTY_TYPES,
  COMMERCIAL_SPEC_FIELDS,
  OFFICE_COUNT_MAX,
  FLOOR_MIN,
  FLOOR_MAX,
  isCommercialType,
  normaliseCommercialSpecs,
  floorLabelFr,
};
