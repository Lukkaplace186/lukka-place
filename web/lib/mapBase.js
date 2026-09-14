import { KINSHASA_CENTER } from './geocoding';
import { MAP_STYLES } from './mapStyle';

/**
 * The `google.maps.Map` options every map on the site starts from — the
 * /listings viewport map (components/ListingsMap.js) and the detail page's
 * single-listing map (components/PropertyMap.js). Call only in the browser.
 *
 * Touch gestures. Left unset, `gestureHandling` defaults to 'auto', which
 * resolves to 'cooperative' on a touch device: a one-finger drag scrolls the
 * PAGE rather than the map, and the map overlays "Use two fingers to move the
 * map". 'greedy' hands every gesture to the map, so one finger pans and two
 * fingers pinch-zoom.
 *
 * Applied only where the primary pointer is actually coarse, NOT
 * unconditionally, and that distinction is load-bearing. On desktop 'greedy'
 * also captures the mouse wheel, and on BOTH surfaces that mount a map it sits
 * inside something scrollable — the /listings results pane beside it, the
 * listing detail page around it — so a visitor scrolling the page with the
 * cursor over the map would zoom the map instead. 'cooperative' is the correct
 * desktop behaviour and is exactly what 'auto' already resolves to there, so
 * the desktop branch is left to the API's own default.
 *
 * Same reasoning for the zoom buttons: pinch replaces them on a touch screen,
 * but on desktop under 'cooperative' the wheel needs a ctrl modifier, which
 * leaves the buttons as the only discoverable way to zoom. Hiding them
 * everywhere would take that away.
 */
export function baseMapOptions() {
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  return {
    center: KINSHASA_CENTER,
    zoom: 12,
    ...(coarsePointer ? { gestureHandling: 'greedy' } : null),
    zoomControl: !coarsePointer,
    streetViewControl: false,
    fullscreenControl: false,
    mapTypeControl: false,
    clickableIcons: false,
    styles: MAP_STYLES,
  };
}
