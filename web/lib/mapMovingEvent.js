/**
 * The /listings map tells the page when the visitor starts and stops moving
 * it (2026-11-17, owner): the phone's liquid-glass search panel
 * (ListingsSplitView) slides away while they drag or pinch and comes back
 * when the map settles. A window event, so the page does not import the map
 * module (it is loaded on demand, components/ResponsiveMapPane.js).
 */
export const MAP_MOVING_EVENT = 'lkp:map-moving';

/** Called by components/ListingsMap.js. */
export function announceMapMoving(moving) {
  window.dispatchEvent(new CustomEvent(MAP_MOVING_EVENT, { detail: { moving: Boolean(moving) } }));
}
