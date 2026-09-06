/**
 * Fans co-located price tags apart so three listings in one building render
 * as three readable tags rather than one tag with two hidden underneath.
 *
 * IMPORTANT CONTEXT before tuning these numbers. Every pin on this map has
 * ALREADY been moved by lib/geocoding.js's `applyPrivacyJitter`, which
 * offsets each listing 200-400m in a deterministic direction seeded by its
 * id — including listings whose real coordinates are known. So two listings
 * at one genuine address do not arrive here sharing a coordinate; they
 * arrive 200-400m apart in different directions. This module therefore
 * fires rarely, and is a safety net for the case where that scatter happens
 * to drop two pins on top of each other, not the primary separator.
 *
 * It is also NOT a fix for tags overlapping at low zoom. That is a
 * screen-space problem: at zoom 12 one pixel is about 38m, so even the full
 * 400m privacy scatter is only ~10px while a tag is ~40px wide. Separating
 * pins further in degrees to solve that would move them away from their real
 * location, which is not something this codebase does. The honest fixes for
 * low-zoom crowding are clustering (deliberately removed) or a screen-space
 * de-overlap pass at the current zoom (not built).
 */

/**
 * Two pins are "the same place" within ~22m. Chosen to be a real building
 * footprint rather than a neighbourhood: anything looser would start pulling
 * genuinely distinct addresses onto a shared ring.
 */
export const COLOCATION_EPSILON_DEG = 0.0002;

/** ~17m at Kinshasa's latitude. */
export const PIN_SPREAD_RADIUS_DEG = 0.00015;

/**
 * @param {Array<{id: string|number, lat: number, lng: number}>} pins
 * @returns {Map<string|number, {lat: number, lng: number, spread: boolean}>}
 *   keyed by pin id, so the caller can look each listing's final position up
 *   without depending on the order groups happen to come out in.
 */
export function spreadColocatedPins(pins) {
  const groups = new Map();

  for (const pin of pins ?? []) {
    if (!Number.isFinite(pin?.lat) || !Number.isFinite(pin?.lng)) continue;
    const key = `${Math.round(pin.lat / COLOCATION_EPSILON_DEG)}:${Math.round(pin.lng / COLOCATION_EPSILON_DEG)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pin);
  }

  const placed = new Map();

  for (const group of groups.values()) {
    if (group.length === 1) {
      const [pin] = group;
      placed.set(pin.id, { lat: pin.lat, lng: pin.lng, spread: false });
      continue;
    }

    // Sorted by id, not by arrival order: the same building must produce the
    // same arrangement on every load, and `listings` order changes with the
    // sort dropdown. Numeric collation so #9 precedes #10.
    const ordered = [...group].sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true }),
    );

    ordered.forEach((pin, index) => {
      const angle = (2 * Math.PI * index) / ordered.length;
      // Longitude degrees shrink with latitude, so dividing by cos(lat)
      // keeps the ring visually circular instead of squashed. Floored so a
      // nonsense latitude can never divide by ~0 and fling a pin off-map.
      const lngScale = Math.max(Math.cos((pin.lat * Math.PI) / 180), 0.1);
      placed.set(pin.id, {
        lat: pin.lat + PIN_SPREAD_RADIUS_DEG * Math.sin(angle),
        lng: pin.lng + (PIN_SPREAD_RADIUS_DEG * Math.cos(angle)) / lngScale,
        spread: true,
      });
    });
  }

  return placed;
}
