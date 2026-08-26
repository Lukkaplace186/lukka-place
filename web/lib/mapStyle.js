/**
 * Google Maps style array in the site's WhiteBlue Royal palette.
 *
 * The default Google basemap is its own blue-green and was the loudest
 * palette violation on the site — it sits beside the results grid at 42% of
 * the viewport, so it reads as a large block of someone else's brand.
 *
 * Values are hardcoded hexes rather than CSS custom properties for the same
 * reason lib/mapIcons.js is: this array is handed to the Maps JS API, which
 * resolves nothing from the document's stylesheet. Keep it in step with
 * app/globals.css by hand if the palette moves.
 *
 * Uses the classic JSON `styles` array (not a Cloud-console Map ID). That is
 * deliberate: a Map ID would also force AdvancedMarkerElement, and the
 * clustering here runs against classic google.maps.Marker instances.
 */
const INK = '#0B1120';
const INK_45 = '#5C6679';
const CANVAS = '#FFFFFF';
const CANVAS_ALT = '#F7F7F5';
const CANVAS_DEEP = '#EFF1F6';
const LINE = '#E2E6EF';
// Real water, tinted toward royal blue rather than a neutral grey — the one
// place on the map where a hint of the accent colour is honest (it *is* the
// Congo river / Kinshasa's real waterways, not decoration).
const WATER = '#DCE3FF';

export const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: CANVAS }] },
  { elementType: 'labels.text.fill', stylers: [{ color: INK_45 }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: CANVAS }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

  // Points of interest are noise next to price pins — the pins are the
  // content here, and every extra icon competes with them.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: LINE }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: INK }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: INK_45 }] },

  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: CANVAS_ALT }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: CANVAS_ALT }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: LINE }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: INK_45 }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: CANVAS_DEEP }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: LINE }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: WATER }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: INK_45 }] },
];
