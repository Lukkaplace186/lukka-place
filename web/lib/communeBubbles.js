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

/** "89 biens · Limete". */
export function communeBubbleLabel(group) {
  const count = group.unitCount;
  return `${count} ${count > 1 ? 'biens' : 'bien'} · ${group.communeName}`;
}
