/**
 * Bedroom range in a search URL (`beds_min` / `beds_max`), with STUDIO as 0
 * (2026-11-25, owner request: Rightmove-style "Studio → 2 chambres").
 *
 * Why 0 needs its own rule: a studio is the Studio property type, and 22 of
 * the 24 live studio rentals carry NO bedroom count (NULL), so a plain
 * `p.beds <= 2` would silently drop every studio from "Studio → 2". A bound
 * of 0 therefore means "the Studio type", never `p.beds = 0`:
 *
 *   min 0, max 0 (or max 0 alone) → studios only
 *   min 0, max N                  → studios, or 1..N bedrooms
 *   min 0, no max                 → studios, or any stated bedroom count
 *   min N ≥ 1                     → p.beds >= N (as before), max as before
 *
 * Pure: lib/listings.js turns it into SQL, labels read it too.
 */

/** Studio, as a bedroom bound. */
export const STUDIO_BEDS = 0;

/** A bound: a whole number 0..50, else null (unset / garbage). */
export function bedBound(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : null;
}

/**
 * @returns {{min: number|null, max: number|null, studio: 'only'|'include'|null}}
 *   `min`/`max` apply to p.beds; `studio` says how the Studio type joins in.
 *   A max below the min is dropped, never swapped (as on /listings).
 */
export function bedroomBounds(minValue, maxValue) {
  const lo = bedBound(minValue);
  let hi = bedBound(maxValue);
  if (lo !== null && hi !== null && hi < lo) hi = null;
  if (hi === STUDIO_BEDS) return { min: null, max: null, studio: 'only' };
  if (lo === STUDIO_BEDS) return { min: 1, max: hi, studio: 'include' };
  return { min: lo, max: hi, studio: null };
}

/**
 * A range as reader text: "Studio", "Studio – 2 ch", "2 ch", "1 – 3 ch",
 * "2+ ch", "≤ 3 ch"; '' when nothing is set.
 */
export function bedroomRangeLabel(minValue, maxValue, unit = 'ch', studio = 'Studio') {
  const { min, max, studio: mode } = bedroomBounds(minValue, maxValue);
  if (mode === 'only') return studio;
  if (mode === 'include') return max === null ? `${studio}+` : `${studio} – ${max} ${unit}`;
  if (min !== null && max !== null) return min === max ? `${min} ${unit}` : `${min} – ${max} ${unit}`;
  if (min !== null) return `${min}+ ${unit}`;
  if (max !== null) return `≤ ${max} ${unit}`;
  return '';
}
