/**
 * One bubble per commune for listings that only know their commune
 * (2026-11-14, owner decision).
 *
 * A listing with no stored coordinates is drawn at its commune's centre
 * (lib/mapViewport.js resolveMarkerPosition, `approximate: true`). There were
 * 89 of them in Limete alone, and placeResolvedListings fanned them onto one
 * ring about a kilometre across: a bullseye of prices at made-up positions.
 * Now two or more such listings in one commune are ONE pin at the centre,
 * "89 biens · Limete", which opens the list (BuildingUnitsDrawer, the same
 * panel a multi-unit building opens). A single one keeps its price pin.
 *
 * The group has the building group's shape (lib/buildingGroups.js), so the
 * map's click path, drawer and label code take it as they are.
 */
import { inferListingCommune } from './geocoding';
import { communeLabel } from './cities';

const MIN_FOR_BUBBLE = 2;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split markers into commune bubbles (approximate markers, ≥2 per commune)
 * and the rest, unchanged and in their original order.
 *
 * @param {Object[]} markers  /api/listings/map markers.
 * @returns {{ bubbles: Object[], rest: Object[] }}
 */
export function splitCommuneBubbles(markers) {
  const byCommune = new Map();
  for (const marker of markers || []) {
    if (!marker?.approximate) continue;
    const commune = marker.commune || inferListingCommune(marker);
    if (!commune) continue;
    if (!byCommune.has(commune)) byCommune.set(commune, []);
    byCommune.get(commune).push(marker);
  }

  const grouped = new Set();
  const bubbles = [];
  for (const [commune, listings] of byCommune) {
    if (listings.length < MIN_FOR_BUBBLE) continue;
    for (const listing of listings) grouped.add(listing);
    const prices = listings.map((l) => toNumber(l.price)).filter((n) => n !== null);
    const beds = listings.map((l) => toNumber(l.beds ?? l.bedrooms)).filter((n) => n !== null);
    bubbles.push({
      key: `commune:${commune}`,
      buildingId: null,
      isBuilding: true,
      isCommune: true,
      communeName: communeLabel(commune),
      listings,
      unitCount: listings.length,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      bedsMin: beds.length ? Math.min(...beds) : null,
      bedsMax: beds.length ? Math.max(...beds) : null,
      buildingName: null,
      // Every member sits on the same centre; the first speaks for the point.
      representative: listings[0],
    });
  }

  return { bubbles, rest: (markers || []).filter((m) => !grouped.has(m)) };
}

/**
 * Below this zoom the map shows one bubble per commune instead of prices
 * (map preview 2026-11-16, `?apercu=carte`): at city zoom 300+ price tags
 * piled into an unreadable heap over Gombe and Lingwala. 14 is the zoom a
 * searched commune opens at, so a commune search still opens on prices.
 */
export const AREA_ZOOM_BELOW = 14;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every marker grouped by its commune: one bubble each, placed at the median
 * of its listings' positions (where they are, not the commune's centre).
 * A marker whose commune is unknown keeps its own price pin. Shaped like a
 * building group with `isArea`, which the map handles as "zoom in here".
 *
 * @returns {{ areas: Object[], rest: Object[] }}
 */
export function groupByArea(markers) {
  const byCommune = new Map();
  const rest = [];
  for (const marker of markers || []) {
    const commune = marker?.commune || inferListingCommune(marker);
    if (!commune || !Number.isFinite(marker.lat) || !Number.isFinite(marker.lng)) {
      if (marker) rest.push(marker);
      continue;
    }
    if (!byCommune.has(commune)) byCommune.set(commune, []);
    byCommune.get(commune).push(marker);
  }
  const areas = [];
  for (const [commune, listings] of byCommune) {
    const prices = listings.map((l) => toNumber(l.price)).filter((n) => n !== null);
    areas.push({
      key: `area:${commune}`,
      buildingId: null,
      isBuilding: true,
      isCommune: true,
      isArea: true,
      communeName: communeLabel(commune),
      listings,
      unitCount: listings.length,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      buildingName: null,
      representative: {
        ...listings[0],
        lat: median(listings.map((l) => l.lat)),
        lng: median(listings.map((l) => l.lng)),
      },
    });
  }
  return { areas, rest };
}

/** "89 biens · Limete". */
export function communeBubbleLabel(group) {
  const count = group.unitCount;
  return `${count} ${count > 1 ? 'biens' : 'bien'} · ${group.communeName}`;
}
