/**
 * Review mode's inline correction (app/admin/listings/review/ReviewMode.js):
 * which fields it edits, what it sends to adminUpdateListingAction, and how
 * the screen shows the corrected listing without reloading the queue.
 *
 * Pure, no React, so the rules below are unit-tested
 * (tests/unit/review-quick-edit.test.js).
 *
 * The action reads a field that is ABSENT as "leave it" and a blank one as
 * "clear it" — with three exceptions this module exists to respect:
 *   - price_period: missing is read as blank, so it is always sent;
 *   - sold_price / sold_at: written NULL unless listing_status is 'closed',
 *     so the listing's own status is always sent back with it;
 *   - the address line is rebuilt from quartier + commune of the SAME patch,
 *     so a change to either sends both.
 * Everything else is sent only when it changed, which keeps one corrected
 * field from rewriting the rest (and from asking the engine to re-price a
 * listing whose price nobody touched).
 */

export const QUICK_EDIT_FIELDS = [
  'title', 'description', 'category_id', 'parcelle_subtype', 'purpose',
  'price', 'currency', 'price_period', 'price_original',
  'commune', 'quartier', 'reference',
  'beds', 'bath', 'area',
  'deposit_months', 'advance_months', 'commission_months',
];

const NUMBER_FIELDS = new Set(['price', 'price_original', 'beds', 'bath', 'area', 'deposit_months', 'advance_months', 'commission_months']);

function str(value) {
  return value == null ? '' : String(value).trim();
}

/** '0' is `area`'s stored "not stated" (lib/listingView.js hasArea). */
function areaStr(value) {
  const text = str(value);
  return text === '0' || Number(text) === 0 ? '' : text;
}

/** The form's starting values, as strings, from a review item and its facts. */
export function quickEditValues(item) {
  const facts = item.facts || {};
  return {
    title: str(item.title),
    description: str(facts.description),
    category_id: str(facts.categoryId),
    parcelle_subtype: str(facts.parcelleSubtype),
    purpose: str(item.purpose) || 'rent',
    price: str(item.price),
    currency: str(facts.currency).toUpperCase() || 'USD',
    price_period: str(item.pricePeriod),
    price_original: str(facts.priceOriginal),
    commune: str(item.commune),
    quartier: str(item.quartier),
    reference: str(item.reference),
    beds: str(item.beds),
    bath: str(facts.bath),
    area: areaStr(facts.area),
    deposit_months: str(facts.depositMonths),
    advance_months: str(facts.advanceMonths),
    commission_months: str(facts.commissionMonths),
  };
}

function same(name, a, b) {
  if (NUMBER_FIELDS.has(name) && a !== '' && b !== '') return Number(a) === Number(b);
  return a === b;
}

/** Field names whose value differs between the two value sets. */
export function changedFields(before, after) {
  return QUICK_EDIT_FIELDS.filter((name) => after[name] !== undefined && !same(name, str(before[name]), str(after[name])));
}

/**
 * The [name, value] pairs to post, or [] when nothing changed.
 * `listingStatus` is the row's current listing_status (kept, see above).
 */
export function quickEditEntries(before, after, { listingStatus = '' } = {}) {
  const changed = new Set(changedFields(before, after));
  if (changed.size === 0) return [];
  if (changed.has('commune') || changed.has('quartier')) {
    changed.add('commune');
    changed.add('quartier');
  }
  const priceTouched = changed.has('price') || changed.has('currency') || changed.has('price_original');
  if (priceTouched) {
    changed.add('price');
    changed.add('currency');
    // A USD price IS the agent's figure: the engine sets price_original to it.
    // A CDF one keeps the franc amount beside the dollar conversion.
    if (str(after.currency) === 'CDF') changed.add('price_original');
    else changed.delete('price_original');
  }
  changed.add('price_period');

  const entries = QUICK_EDIT_FIELDS.filter((name) => changed.has(name)).map((name) => [name, str(after[name])]);
  entries.push(['listing_status', str(listingStatus)]);
  return entries;
}

/** What the agent wrote can be fixed here; a re-send of the same listing cannot. */
export function fixableBySkipReason(reason) {
  return /contenu manquant|prix est absent|message d'erreur d'extraction/i.test(String(reason || ''));
}

function num(value) {
  const text = str(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The review item as it reads after a successful save, so the screen shows
 * the correction at once. Flags the save has settled (no commune, no price,
 * no content) are dropped; every other check stays as the queue computed it.
 */
export function applyQuickEdit(item, values, categories = []) {
  const category = categories.find((c) => String(c.id) === str(values.category_id));
  const price = num(values.price);
  const commune = str(values.commune) || null;
  const title = str(values.title) || item.title;
  const description = str(values.description) || item.facts?.description || null;
  const settled = new Set();
  if (commune) settled.add('missing_commune');
  if (price && price > 0) settled.add('missing_price');
  if (title && description) settled.add('missing_content');
  const flags = (item.flags || []).filter((flag) => !settled.has(flag));
  return {
    ...item,
    title,
    price,
    pricePeriod: str(values.price_period) || null,
    purpose: str(values.purpose) || item.purpose,
    commune,
    quartier: str(values.quartier) || null,
    reference: str(values.reference) || null,
    beds: num(values.beds),
    flags,
    facts: {
      ...(item.facts || {}),
      description,
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
      parcelleSubtype: str(values.parcelle_subtype) || null,
      currency: str(values.currency) || 'USD',
      priceOriginal: num(values.price_original),
      bath: num(values.bath),
      area: str(values.area) || '0',
      depositMonths: num(values.deposit_months),
      advanceMonths: num(values.advance_months),
      commissionMonths: num(values.commission_months),
    },
  };
}
