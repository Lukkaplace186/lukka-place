import { resolveMarkerPosition } from './mapViewport';

/**
 * The detail page's single listing pin (components/ListingPinMap.js): a big
 * royal-blue pill with a symbol for what the property is, and its price.
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
 * 'land' for a bare plot (Terrain Nu), 'house' for everything else — a
 * parcelle (Villa, Maison Type Locataire) or a Maison.
 */
export function pinKind(listing) {
  if (listing?.parcelle_subtype === 'terrain_nu') return 'land';
  if (listing?.parcelle_subtype) return 'house';
  const category = String(listing?.category_name || '').toLowerCase();
  if (category.includes('appartement') || category.includes('studio')) return 'apartment';
  if (category.includes('terrain')) return 'land';
  return 'house';
}

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

/** Lucide's Building2, House and LandPlot outlines, as static markup for the pin layer. */
export const PIN_ICONS = {
  apartment: `${SVG_OPEN}<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></svg>`,
  house: `${SVG_OPEN}<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  land: `${SVG_OPEN}<path d="m12 8 6-3-6-3v10"/><path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/><path d="m6.49 12.85 11.02 6.3"/><path d="M17.51 12.85 6.5 19.15"/></svg>`,
};
