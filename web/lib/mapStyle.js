/**
 * Google Maps style array for the listings map.
 *
 * Deliberate change of direction from the previous version, which pushed the
 * basemap all the way into the site's monochrome WhiteBlue palette (one
 * off-white for every surface, parks and land the same grey, water a pale
 * lilac). That read as brand-consistent but flat: with no green, no real
 * water and no road hierarchy, Kinshasa's actual geography — the Congo
 * river, the parks, the arterial grid — disappeared, and the map became a
 * blank sheet that pins floated on rather than a place a visitor can orient
 * themselves in.
 *
 * This version restores real geographic colour the way the reference
 * property portals do: green parks and vegetation, genuinely blue water, a
 * warm paper canvas, and a road hierarchy where motorways/arterials read
 * warmer and heavier than local streets. Everything is still muted a stop
 * below a stock Google basemap, and that restraint matters MORE now that the
 * markers are white price tags (lib/mapIcons.js) rather than saturated
 * colour-coded pins: a white tag needs a calm, mid-value ground to read
 * against, and a stock-saturation basemap would swallow it. The tags are the
 * content, the map is the context.
 *
 * POI *icons* and transit stay off for that same reason: a field of Google's
 * own category pins competes directly with the price tags. Park and water
 * labels are kept, because those are the landmarks people actually navigate
 * Kinshasa by.
 *
 * Values are hardcoded hexes rather than CSS custom properties because this
 * array is handed to the Maps JS API, which resolves nothing from the
 * document's stylesheet.
 *
 * Uses the classic JSON `styles` array (not a Cloud-console Map ID). That is
 * deliberate: a Map ID would also force AdvancedMarkerElement, and the price
 * tags here are classic google.maps.Marker instances. It is
 * also why this is not a Mapbox style — the app renders with the Google Maps
 * JS API and a referrer-restricted Google key, so a Mapbox style URL would
 * need a second vendor, a second key and a rewrite of PropertyMap.js.
 */

// Paper, not white: a hair of warmth so the white price tags read as raised
// objects sitting on the map rather than holes punched through it.
const CANVAS = '#F7F5F0';
const CANVAS_ALT = '#F1EEE7';
const INK = '#2A3040';
const INK_SOFT = '#6B7284';
const HALO = '#FFFFFF';

// Real geography, muted one stop below Google's own defaults.
const WATER = '#A9D3EE';
const WATER_LABEL = '#3E7CA6';
const PARK = '#CFE6C2';
const PARK_LABEL = '#4E7A3C';
const VEGETATION = '#E2EBD8';

// Road hierarchy, warm side — the classic cartographic convention, and the
// only cue that tells a motorway from a residential street at a glance.
const ROAD_LOCAL = '#FFFFFF';
const ROAD_ARTERIAL = '#FDF3DC';
const ROAD_HIGHWAY = '#FBE3AE';
const ROAD_HIGHWAY_EDGE = '#EFC978';
const ROAD_EDGE = '#E6E1D6';

const ADMIN_LINE = '#D9D3C6';

export const MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: CANVAS }] },
  { elementType: 'labels.text.fill', stylers: [{ color: INK_SOFT }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: HALO }] },

  // Google's own category icons compete with the price tags; the labels
  // for parks and water below are kept because they are real landmarks.
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },

  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: ADMIN_LINE }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: INK }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: INK_SOFT }] },

  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: CANVAS_ALT }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: VEGETATION }] },
  { featureType: 'landscape.natural.terrain', elementType: 'geometry', stylers: [{ color: VEGETATION }] },

  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: PARK }] },
  { featureType: 'poi.park', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: PARK_LABEL }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: ROAD_LOCAL }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: ROAD_EDGE }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: INK_SOFT }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: ROAD_ARTERIAL }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: ROAD_HIGHWAY }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: ROAD_HIGHWAY_EDGE }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: INK }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: WATER }] },
  { featureType: 'water', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: WATER_LABEL }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: HALO }] },
];
