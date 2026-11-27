/**
 * The hero search's "Chambres" Min / Max pair (2026-11-25, owner request,
 * Rightmove-style: "2 to 4 bedrooms"), beside the Budget pair and built the
 * same way. Pure, so the unit tier can pin it.
 *
 * - Steps: Studio, 1 … 5. Studio is bound 0, which the listings filter reads
 *   as the Studio TYPE (lib/bedroomRange.js says why), so "Studio → 2" finds
 *   the studios as well as the 1–2 bedroom homes. Min 5 is "5 or more".
 * - An option that would contradict the other side is disabled, as on the
 *   budget (no max below the min).
 * - Studio is offered only when the type list has studios, and the pair is
 *   hidden for land, commercial space, studios and single rooms, where a
 *   bedroom count means nothing; its values are then not sent.
 */
import { COMMERCIAL_FILTER_VALUE } from './commercialSpaces';
import { STUDIO_BEDS, bedBound } from './bedroomRange';

export const HERO_BED_STEPS = Object.freeze([0, 1, 2, 3, 4, 5]);

export const STUDIO_TYPE = 'studio';

const NO_BEDROOM_TYPES = new Set(['terrain', 'ferme / terrain agricole', 'ferme', STUDIO_TYPE, 'chambre / annexe', 'chambre', 'annexe']);

/** Whether a bedroom count means something for the chosen type ('' = every type). */
export function typeHasBedrooms(type, facets = []) {
  if (!type) return true;
  if (type === COMMERCIAL_FILTER_VALUE || NO_BEDROOM_TYPES.has(type)) return false;
  return facets.find((f) => f.value === type)?.group !== 'commercial';
}

/** Studio is offered only when the type list (real counts) carries it. */
export function studioOffered(facets = []) {
  return facets.some((f) => f.value === STUDIO_TYPE && Number(f.count) > 0);
}

/**
 * The URL params for the chosen pair. A max below the min is dropped; a max
 * of Studio alone means studios only, sent as 0 → 0 so /listings reads it
 * back as one choice.
 */
export function heroBedsParams(min, max) {
  const lo = bedBound(min);
  let hi = bedBound(max);
  if (lo !== null && hi !== null && hi < lo) hi = null;
  if (hi === STUDIO_BEDS) return { beds_min: '0', beds_max: '0' };
  return { beds_min: lo === null ? '' : String(lo), beds_max: hi === null ? '' : String(hi) };
}

/**
 * Options for the two selects. `labels`: { minAny, maxAny, studio, count(n) }.
 * @returns {{minOptions: Array<{value, label, disabled?}>, maxOptions: Array<{value, label, disabled?}>}}
 */
export function bedsOptions({ min = '', max = '' } = {}, labels, { studio = true } = {}) {
  const lo = bedBound(min);
  const hi = bedBound(max);
  const steps = HERO_BED_STEPS.filter((n) => studio || n !== STUDIO_BEDS);
  const label = (n) => (n === STUDIO_BEDS ? labels.studio : labels.count(n));
  return {
    minOptions: [
      { value: '', label: labels.minAny },
      ...steps.map((n) => ({ value: String(n), label: label(n), disabled: hi !== null && n > hi })),
    ],
    maxOptions: [
      { value: '', label: labels.maxAny },
      ...steps.map((n) => ({ value: String(n), label: label(n), disabled: lo !== null && n < lo })),
    ],
  };
}
