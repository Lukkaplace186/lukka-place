/**
 * Commercial spaces — offices, shops, warehouses (2026-10-19). Pure and
 * client-safe; shared by the listing queries, the cards, the listing page and
 * the agent's create / edit forms.
 *
 * "Commercial" is the category's own `property_categories.type`
 * ('commercial' for Bureau, Boutique, Entrepôt, Bâtiment) — not a list of
 * names kept here, so a category the back-office adds later is commercial
 * the moment it is typed so.
 *
 * The four specs (`properties` columns, migrations/20261019_commercial_spaces.sql):
 *   office_count   rooms used as offices — never bedrooms
 *   floor_level    0 = rez-de-chaussée, 1 = 1er étage, -1 = sous-sol
 *   road_frontage  the space faces the road (a shop's whole value)
 *   truck_access   a truck can reach it and unload (a warehouse's)
 * NULL = the agent did not say, which is not "no": only a stated "yes" is
 * ever shown as a fact.
 *
 * COMMERCIAL_SPEC_FIELDS and the bounds are DUPLICATED in the engine's
 * services/commercial.js and in the migration's CHECKs — change all three
 * together (tests/unit/commercial-spaces.test.js compares them).
 */

export const COMMERCIAL_SPEC_FIELDS = Object.freeze(['office_count', 'floor_level', 'road_frontage', 'truck_access']);

export const OFFICE_COUNT_MAX = 500;
export const FLOOR_MIN = -3;
export const FLOOR_MAX = 60;

/** The `property_type` URL value for every commercial category at once. */
export const COMMERCIAL_FILTER_VALUE = 'commercial';

/** Floors an agent can pick in the form: sous-sol, RDC, 1er … 10e. */
export const FLOOR_OPTIONS = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** A category row ({type}) or a listing ({category_type}) that is commercial. */
export function isCommercial(source) {
  const type = source?.category_type ?? source?.type ?? null;
  return String(type || '').trim().toLowerCase() === 'commercial';
}

function wholeInRange(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function tristate(value) {
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'on') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

/** The four specs, each valid or null. Same rules as the engine's normaliseCommercialSpecs. */
export function normaliseCommercialSpecs(source = {}) {
  const s = source || {};
  return {
    office_count: wholeInRange(s.office_count, 0, OFFICE_COUNT_MAX),
    floor_level: wholeInRange(s.floor_level, FLOOR_MIN, FLOOR_MAX),
    road_frontage: tristate(s.road_frontage),
    truck_access: tristate(s.truck_access),
  };
}

/**
 * The specs a listing row carries. The listing queries return them as one
 * `commercial_specs` jsonb (read through to_jsonb so a database without the
 * columns yields nulls, not an error); a row built elsewhere may carry them
 * flat.
 */
export function commercialSpecsOf(listing) {
  if (!listing) return normaliseCommercialSpecs({});
  return normaliseCommercialSpecs(listing.commercial_specs || listing);
}

/**
 * The form's checkbox / select values → specs. A checkbox only says "yes"
 * when ticked; unticked is "not stated" (null), never a recorded "no".
 */
export function commercialSpecsFromForm(formData) {
  const get = (key) => (typeof formData?.get === 'function' ? formData.get(key) : formData?.[key]);
  return normaliseCommercialSpecs({
    office_count: String(get('office_count') ?? '').trim(),
    floor_level: String(get('floor_level') ?? '').trim(),
    road_frontage: get('road_frontage') ? true : null,
    truck_access: get('truck_access') ? true : null,
  });
}

/** Dictionary key + params for a floor: "Rez-de-chaussée", "1er étage", "Sous-sol". */
export function floorLabel(level, t) {
  if (level === null || level === undefined) return null;
  const n = Number(level);
  if (!Number.isInteger(n)) return null;
  const fallback = n === 0 ? 'Rez-de-chaussée' : n < 0 ? 'Sous-sol' : n === 1 ? '1er étage' : `${n}e étage`;
  if (!t) return fallback;
  if (n === 0) return t('listings.commercial.floor.ground');
  if (n < 0) return t('listings.commercial.floor.basement');
  return n === 1 ? t('listings.commercial.floor.first') : t('listings.commercial.floor.nth', { n });
}

/**
 * The commercial facts worth a line on the listing page, in reading order.
 * Only stated values: a NULL spec produces nothing.
 * @returns {Array<{key: string, label: string, value: string}>}
 */
export function commercialFacts(listing, t) {
  const specs = commercialSpecsOf(listing);
  const label = (key, fallback) => (t ? t(`listings.commercial.facts.${key}`) : fallback);
  const yes = t ? t('listings.commercial.yes') : 'Oui';
  const facts = [];
  if (specs.office_count !== null) facts.push({ key: 'offices', label: label('offices', 'Bureaux'), value: String(specs.office_count) });
  const floor = floorLabel(specs.floor_level, t);
  if (floor) facts.push({ key: 'floor', label: label('floor', 'Étage'), value: floor });
  if (specs.road_frontage === true) facts.push({ key: 'frontage', label: label('frontage', 'Façade sur route'), value: yes });
  if (specs.truck_access === true) facts.push({ key: 'truck', label: label('truck', 'Accès camion'), value: yes });
  return facts;
}

/** A type facet's display label: the dictionary's when it has a key (the umbrella), else the DB name. */
export function facetLabel(facet, t) {
  if (facet?.labelKey && t) return t(facet.labelKey);
  return facet?.label ?? '';
}

/**
 * Type facets split for display: homes first, then commercial space with the
 * "Locaux commerciaux" umbrella leading its group. Order inside each group is
 * the database's (most listings first).
 * @returns {{residential: Object[], commercial: Object[]}}
 */
export function groupTypeFacets(facets = []) {
  const residential = [];
  const commercial = [];
  for (const facet of facets) (facet?.group === 'commercial' ? commercial : residential).push(facet);
  commercial.sort((a, b) => Number(Boolean(b.umbrella)) - Number(Boolean(a.umbrella)));
  return { residential, commercial };
}
