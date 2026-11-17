/**
 * Pure half of components/MapQuickFilters.js (the phone map's Louer/Acheter ·
 * Prix · Chambres chips), so the unit tier can pin it.
 *
 * 2026-11-17 (owner): price and bedrooms are RANGES now — "de 350 $ à 650 $",
 * "2 à 3 chambres" — and the Type chip gave its place to Louer / Acheter
 * (type stays in the full filter sheet). Prices use the hero's own steps
 * (lib/budgetSteps.js), so a sale is chosen on a sale scale.
 */
import { OVER } from './budgetSteps';

export const MAP_BED_STEPS = [1, 2, 3, 4, 5];

/** Several params at once; '' / null removes one. `page` always goes. */
export function mapFilterHrefMany(search, updates) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value === '' || value == null) params.delete(key);
    else params.set(key, String(value));
    if (key === 'property_type') params.delete('parcelle_subtype');
  }
  params.delete('page');
  return `/listings?${params.toString()}`;
}

export function mapFilterHref(search, key, value) {
  return mapFilterHrefMany(search, { [key]: value });
}

function wholeNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Bedrooms from–to as URL params; a "to" below the "from" is dropped, never swapped. */
export function bedsRangeParams(min, max) {
  const lo = wholeNumber(min);
  const hi = wholeNumber(max);
  return {
    beds_min: lo == null ? '' : String(lo),
    beds_max: hi == null || (lo != null && hi < lo) ? '' : String(hi),
  };
}

/**
 * Louer / Acheter. Tapping the one already chosen clears it (both again).
 * The price range is dropped on a change: rent and sale prices are on
 * different scales, and a $650 ceiling means nothing for a house for sale.
 */
export function transactionHref(search, current, chosen) {
  const value = current === chosen ? '' : chosen;
  return mapFilterHrefMany(search, { transaction_type: value, price_min: '', price_max: '' });
}

/** The price chip's text: '' when no range is set (the chip then says "Prix"). */
export function priceRangeLabel(min, max, money) {
  const lo = wholeNumber(min);
  const hi = max === OVER ? null : wholeNumber(max);
  if (lo != null && hi != null) return lo === hi ? `${money(lo)} $` : `${money(lo)} – ${money(hi)} $`;
  if (lo != null) return `≥ ${money(lo)} $`;
  if (hi != null) return `≤ ${money(hi)} $`;
  return '';
}

/**
 * The bedrooms chip's text: '' when no range is set (the chip then says
 * "Chambres"). `unit` is the reader's short word (listings.specs.beds:
 * "ch" / "bed").
 */
export function bedsRangeLabel(min, max, unit = 'ch.') {
  const lo = wholeNumber(min);
  const hi = wholeNumber(max);
  if (lo != null && hi != null) return lo === hi ? `${lo} ${unit}` : `${lo} – ${hi} ${unit}`;
  if (lo != null) return `${lo}+ ${unit}`;
  if (hi != null) return `≤ ${hi} ${unit}`;
  return '';
}
