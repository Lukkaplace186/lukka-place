import { resolveMarkerPosition } from './mapViewport';

/**
 * The detail page's map (components/ListingPinMap.js), Airbnb-style since
 * 2026-10-23: no pin claiming a spot, a soft zone with a white badge in its
 * middle carrying a symbol for what the property is. It replaced the
 * Rightmove-style navy point, pulse, commune pill and disc (2026-09-28).
 *
 * A comparison map (this listing big, similar listings nearby small) was
 * tried on 2026-09-28 and reverted the same day on product direction: the
 * detail page shows this one property, cleanly.
 */

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Where this listing's pin goes, from its STORED coordinates only, or null.
 * A listing with none keeps the geocoding map (PropertyMap), which can still
 * find its street from the address.
 */
export function storedPosition(listing) {
  const lat = numberOrNull(listing?.latitude);
  const lng = numberOrNull(listing?.longitude);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  const position = resolveMarkerPosition({ lat, lng });
  return position && !position.approximate ? position : null;
}

/**
 * Which symbol the pin carries: 'apartment' for a unit in a building,
 * or for a whole Immeuble, 'land' for a bare plot (Terrain Nu), 'house' for
 * everything else — a parcelle, a Maison, a Villa or a Concession.
 */
export function pinKind(listing) {
  if (listing?.parcelle_subtype === 'terrain_nu') return 'land';
  if (listing?.parcelle_subtype) return 'house';
  const category = String(listing?.category_name || '').toLowerCase();
  if (category.includes('appartement') || category.includes('studio') || category.includes('immeuble')) return 'apartment';
  if (category.includes('terrain') || category.includes('ferme')) return 'land';
  return 'house';
}

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

/** Lucide's Building2, House and LandPlot outlines, as static markup for the map point. */
export const PIN_ICONS = {
  apartment: `${SVG_OPEN}<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
  house: `${SVG_OPEN}<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  land: `${SVG_OPEN}<path d="m12 8 6-3-6-3v10"/><path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/><path d="m6.49 12.85 11.02 6.3"/><path d="M17.51 12.85 6.5 19.15"/></svg>`,
};

/**
 * Nominal radius of the approximate zone, in metres. The privacy jitter
 * (lib/geocoding.js) moves the point at most 400 m, and the zone's outline
 * never comes closer than ZONE_MIN_FACTOR × this to its centre, so the
 * listing's real spot is always inside the zone drawn around its jittered
 * point.
 */
export const PRIVACY_RADIUS_M = 500;

const ZONE_POINTS = 64;
const ZONE_BASE = 0.94;
const ZONE_WAVES = [
  { frequency: 2, amplitude: 0.05 },
  { frequency: 3, amplitude: 0.03 },
];
/** The outline's closest approach to its centre, as a share of PRIVACY_RADIUS_M. */
export const ZONE_MIN_FACTOR = ZONE_BASE - ZONE_WAVES.reduce((sum, w) => sum + w.amplitude, 0);

const METRES_PER_DEGREE_LAT = 111320;

/** A number in [0, 1) from the listing id, so a listing's zone has the same shape on every visit. */
function seededUnit(seed, salt) {
  const x = Math.sin((Number(seed) || 0) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The approximate zone (Airbnb-style): a soft, slightly irregular outline
 * around `center` — a perfect circle reads as a target, a blob reads as an
 * area. Two low-frequency waves with phases seeded by the listing id, so
 * every listing has its own shape and keeps it. Returns a closed ring of
 * { lat, lng } for google.maps.Polygon.
 */
export function zoneOutline(center, seed) {
  const phases = ZONE_WAVES.map((_, i) => seededUnit(seed, i + 1) * Math.PI * 2);
  const metresPerDegreeLng = METRES_PER_DEGREE_LAT * Math.cos((center.lat * Math.PI) / 180);
  const ring = [];
  for (let i = 0; i < ZONE_POINTS; i += 1) {
    const angle = (i / ZONE_POINTS) * Math.PI * 2;
    const factor = ZONE_WAVES.reduce(
      (sum, wave, w) => sum + wave.amplitude * Math.sin(wave.frequency * angle + phases[w]),
      ZONE_BASE,
    );
    const metres = PRIVACY_RADIUS_M * factor;
    ring.push({
      lat: center.lat + (metres * Math.cos(angle)) / METRES_PER_DEGREE_LAT,
      lng: center.lng + (metres * Math.sin(angle)) / metresPerDegreeLng,
    });
  }
  return ring;
}
