/**
 * lib/smartPaste.js
 *
 * Pure mapping helpers for "Auto-Fill from WhatsApp Text" (CreateListingDialog
 * and AgentListingEditor). The engine's `parseListingTextForForm` (Structured
 * Outputs, root CLAUDE.md's Smart Paste section) returns extracted fields in
 * its own vocabulary (property_type/parcelle_subtype enums, free commune
 * text); this module maps that onto the REAL option lists the form already
 * has — a real category id, a real commune from the allow-list, a real
 * amenity id — and never invents one that doesn't exist. No network calls and
 * no `server-only` import here on purpose: both agent components render
 * client-side and call this directly after the server action returns the raw
 * extraction, and it is exercised directly by tests/unit/smart-paste.test.js.
 */

import { AMENITY_KEYWORDS } from './constants';

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .trim();
}

/**
 * Real commune from `communes` (the same DB/engine-backed allow-list every
 * create/edit form already validates against) or null — never a value the
 * <select> doesn't actually offer. The engine's extractor normalises commune
 * spelling against the same kinshasa_locations.json data this list ultimately
 * derives from, so an exact match is the common case; the normalised
 * fallback only exists for accent/case drift, not to guess at an unlisted
 * name.
 * @param {string[]} communes
 * @param {string|null} rawCommune
 * @returns {string|null}
 */
export function matchCommune(communes, rawCommune) {
  if (!rawCommune) return null;
  if (communes.includes(rawCommune)) return rawCommune;
  const target = normalize(rawCommune);
  return communes.find((c) => normalize(c) === target) || null;
}

/**
 * property_type/parcelle_subtype (engine vocabulary) -> a normalised
 * substring expected inside the REAL category name from the database
 * (web/CLAUDE.md: "Category names are capitalised in the database", so this
 * always compares normalised/lowercased text, never an exact string).
 * parcelle_subtype takes precedence over property_type when both are
 * present, since it is the more specific signal (see services/openai.js's
 * classification rules, engine repo).
 */
const CATEGORY_HINTS_BY_SUBTYPE = {
  villa: 'villa',
  maison_type_locataire: 'maison',
  terrain_nu: 'terrain',
};

const CATEGORY_HINTS_BY_TYPE = {
  appartement: 'appartement',
  studio: 'appartement',
  duplex: 'appartement',
  chambre_salon: 'appartement',
  villa: 'villa',
  maison: 'maison',
  parcelle: 'maison',
  terrain: 'terrain',
  bureau: 'bureau',
  boutique: 'boutique',
  entrepot: 'entrepot',
  immeuble: 'immeuble',
};

/**
 * @param {Array<{id: number, name: string}>} categories
 * @param {string|null} propertyType
 * @param {string|null} parcelleSubtype
 * @returns {number|null} a real category id, or null if nothing matched —
 *   left for the agent to pick by hand rather than guessed.
 */
export function matchCategoryId(categories, propertyType, parcelleSubtype) {
  const hint = CATEGORY_HINTS_BY_SUBTYPE[parcelleSubtype] || CATEGORY_HINTS_BY_TYPE[propertyType];
  if (!hint) return null;
  const match = categories.find((c) => normalize(c.name).includes(hint));
  return match ? match.id : null;
}

/**
 * Real feature-amenity ids (property_amenities, ids 45+ — see
 * lib/agentListings.js's getFeatureAmenities) whose name plausibly matches
 * something actually written in the pasted text. Reuses AMENITY_KEYWORDS
 * (lib/constants.js) — the same French keyword lists the public search
 * filters already match against listing text — as the source of truth for
 * "does the text really say this", rather than asking the model to invent
 * its own amenity taxonomy. A keyword category with no corresponding row in
 * `amenities` (the agency's real, database-backed feature list) simply
 * contributes nothing — never a fabricated id.
 * @param {Array<{id: number, name: string}>} amenities
 * @param {string} rawText
 * @returns {number[]}
 */
export function matchAmenityIds(amenities, rawText) {
  const normalizedText = normalize(rawText);
  const matchedKeys = Object.keys(AMENITY_KEYWORDS).filter((key) =>
    AMENITY_KEYWORDS[key].some((keyword) => normalizedText.includes(normalize(keyword))),
  );
  if (matchedKeys.length === 0) return [];

  const normalizedAmenities = amenities.map((a) => ({ id: a.id, normalizedName: normalize(a.name) }));
  const matched = new Set();
  for (const key of matchedKeys) {
    for (const keyword of AMENITY_KEYWORDS[key]) {
      const needle = normalize(keyword);
      const hit = normalizedAmenities.find((a) => a.normalizedName.includes(needle) || needle.includes(a.normalizedName));
      if (hit) matched.add(hit.id);
    }
  }
  return [...matched];
}

/**
 * Defensive cleanup only — the model is already instructed to produce a
 * headline + a "• " bulleted feature list, sentence case, no emoji/asterisks
 * (services/openai.js's LISTING_FORM_SYSTEM_PROMPT). Bullet characters (•)
 * are intentional formatting and are left alone; this only strips WhatsApp
 * artifacts (asterisks, emoji) that slip through, so raw markup never lands
 * in the description textarea unedited. `whitespace-pre-line` on the public
 * listing page (app/(site)/listings/[id]/page.js) is what renders the
 * headline/blank-line/bullets structure as actual line breaks.
 * @param {string} description
 * @returns {string}
 */
export function cleanDescription(description) {
  return String(description || '')
    .replace(/\*+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Composes one extraction result into the exact set of values each form
 * actually has a field for — the single place that mapping happens, so
 * CreateListingDialog and AgentListingEditor can't drift on how a parsed
 * field lands. Every value is either real (present in the option lists
 * passed in) or null; nothing here fabricates a fallback.
 *
 * @param {Object} extracted `extracted_data` from parseAgentListingText.
 * @param {Object} options
 * @param {string[]} options.communes
 * @param {Array<{id: number, name: string}>} [options.categories] omit for the editor, which has no category field.
 * @param {Array<{id: number, name: string}>} [options.amenities] omit for the create dialog, which has no amenity checkboxes.
 * @param {string} options.rawText the pasted text, for amenity keyword matching.
 */
export function buildFormValuesFromParsed(extracted, { communes, categories = [], amenities = [], rawText }) {
  const commune = matchCommune(communes, extracted.commune);
  const categoryId = categories.length
    ? matchCategoryId(categories, extracted.property_type, extracted.parcelle_subtype)
    : null;
  const amenityIds = amenities.length ? matchAmenityIds(amenities, rawText) : [];

  return {
    title: extracted.title_suggestion || '',
    purpose: extracted.transaction_type === 'location' ? 'rent' : extracted.transaction_type === 'vente' ? 'sale' : null,
    categoryId,
    commune,
    quartier: extracted.quartier || '',
    price: extracted.price != null ? String(extracted.price) : '',
    // null (not a defaulted 'USD') when no price was extracted, so a caller
    // never flips an existing listing's currency toggle off the back of a
    // paste that didn't actually mention a price.
    currency: extracted.price != null ? (extracted.currency === 'CDF' ? 'CDF' : 'USD') : null,
    beds: extracted.bedrooms != null ? String(extracted.bedrooms) : '',
    bath: extracted.bathrooms != null ? String(extracted.bathrooms) : '',
    area: extracted.surface_area_sqm != null ? String(Math.round(extracted.surface_area_sqm)) : '',
    unitsCount: extracted.units_count != null ? String(extracted.units_count) : '',
    depositMonths: extracted.deposit_months != null ? String(extracted.deposit_months) : '',
    amenityIds,
    description: cleanDescription(extracted.description_fr),
  };
}
