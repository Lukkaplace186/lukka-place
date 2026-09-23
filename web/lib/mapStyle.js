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
 * below a stock Google basemap, and that restraint is what keeps the royal
 * blue price tags (lib/mapIcons.js) legible: they are now the only strongly
 * saturated thing on the map, which is the whole point of filling them in
 * the brand colour. Note the one real collision — a blue tag over --water
 * below — which is why every tag carries a white ring of its own. The tags
 * are the content, the map is the context.
 *
 * POI *icons* and transit stay off for that same reason: a field of Google's
 * own category pins competes directly with the price tags. Park and water
 * labels are kept, because those are the landmarks people actually navigate
 * Kinshasa by.
 *
 * 2026-09-23, vibrant pass (product direction, replacing the "one stop
 * quieter" pass of the same morning): the geography POPS — rich green parks,
 * a vivid blue Congo, a clean off-white canvas, white streets and soft yellow
 * highways. That works now because the price pills are white cards with a
 * shadow (lib/mapPinLayer.js), not blue fills: they read against saturated
 * colour instead of drowning in it. Parks carry the strongest green; the wide
 * natural landcover around the city is a lighter one, or the outskirts would
 * turn into one solid green slab. Clutter stays cut: POI icons and business
 * labels off, transit off, local street names and land parcels off. Commune
 * and neighbourhood names stay — in Kinshasa they are the address.
 *
 * Feature names are the classic `styles` vocabulary (`poi.park`,
 * `landscape.natural`); `landuse.park` / `natural.landcover` are Cloud-styling
 * names and would be ignored by this API.
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

// Clean off-white canvas; built-up land one hair darker.
const CANVAS = '#F8F9FA';
const CANVAS_ALT = '#F1F3F5';
const INK = '#263238';
const INK_SOFT = '#5F6B7A';
const HALO = '#FFFFFF';

// Vivid geography.
const WATER = '#4FC3F7';
const WATER_LABEL = '#01579B';
const PARK = '#81C784';
const PARK_LABEL = '#1B5E20';
const VEGETATION = '#C5E8C8';

// Roads: white streets and arterials, soft yellow highways.
const ROAD_LOCAL = '#FFFFFF';
const ROAD_ARTERIAL = '#FFFFFF';
const ROAD_HIGHWAY = '#FFE7A0';
const ROAD_HIGHWAY_EDGE = '#F2C94C';
const ROAD_EDGE = '#E3E6EA';

const ADMIN_LINE = '#C9CED6';

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
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: INK_SOFT }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: WATER }] },
  { featureType: 'water', elementType: 'labels.text', stylers: [{ visibility: 'on' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: WATER_LABEL }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: HALO }] },
];
