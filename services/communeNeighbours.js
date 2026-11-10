/**
 * services/communeNeighbours.js
 *
 * "Commune voisine" fallback for matching (2026-11-10, owner decision): when
 * no agency covers the requested commune, the request is offered to agencies
 * of the nearest communes of the same city, and the desk is told.
 *
 * There is no hand-made adjacency list, on purpose (never invent a location):
 * a neighbour is a commune whose verified centre point is within
 * NEIGHBOUR_MAX_KM of the requested commune's, nearest first. Kinshasa's
 * points are web/lib/geocoding.js KINSHASA_COMMUNE_CENTROIDS (copied here —
 * the engine and web are deployed apart; verify-pipeline compares the two);
 * other cities' come from drc_commune_centroids.json (a null point is a
 * commune Google gave no answer for, and has no neighbours).
 */

const DRC_CENTROIDS = require('../drc_commune_centroids.json');

/** Same values as web/lib/geocoding.js KINSHASA_COMMUNE_CENTROIDS — change both. */
const KINSHASA_COMMUNE_CENTROIDS = {
  Bandalungwa: { lat: -4.341671, lng: 15.28124 },
  Barumbu: { lat: -4.32256, lng: 15.32911 },
  Bumbu: { lat: -4.3728081, lng: 15.2941103 },
  Gombe: { lat: -4.3047981, lng: 15.3053546 },
  Kalamu: { lat: -4.34266, lng: 15.31943 },
  'Kasa-Vubu': { lat: -4.34245, lng: 15.30392 },
  Kimbanseke: { lat: -4.43135, lng: 15.38105 },
  Kinshasa: { lat: -4.3251555, lng: 15.3128644 },
  Kintambo: { lat: -4.3380529, lng: 15.2664192 },
  Kisenso: { lat: -4.41768, lng: 15.34127 },
  Lemba: { lat: -4.393511, lng: 15.3330474 },
  Limete: { lat: -4.3546851, lng: 15.3475693 },
  Lingwala: { lat: -4.3174464, lng: 15.2993463 },
  Makala: { lat: -4.37447, lng: 15.30867 },
  Maluku: { lat: -4.28651, lng: 15.99056 },
  Masina: { lat: -4.38639, lng: 15.39675 },
  Matete: { lat: -4.38736, lng: 15.35221 },
  'Mont-Ngafula': { lat: -4.44489, lng: 15.29343 },
  Ndjili: { lat: -4.40645, lng: 15.37463 },
  Nsele: { lat: -4.4257319, lng: 15.3848449 },
  Ngaba: { lat: -4.37608, lng: 15.32366 },
  Ngaliema: { lat: -4.3713817, lng: 15.2534377 },
  'Ngiri-Ngiri': { lat: -4.356336, lng: 15.2993696 },
  Selembao: { lat: -4.398257, lng: 15.2764818 },
};

/** Centre-to-centre distance under which two communes count as neighbours. */
const NEIGHBOUR_MAX_KM = 6;
/** At most this many neighbouring communes are tried. */
const MAX_NEIGHBOURS = 3;

/** city -> { commune -> {lat, lng} | null } */
const CITY_POINTS = (() => {
  const out = { Kinshasa: KINSHASA_COMMUNE_CENTROIDS };
  for (const [city, entry] of Object.entries(DRC_CENTROIDS || {})) {
    out[city] = entry?.communes || {};
  }
  return out;
})();

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The city table holding `commune` (case-insensitive), or null. */
function findCommune(commune) {
  const key = String(commune || '').trim().toLowerCase();
  if (!key) return null;
  for (const [city, points] of Object.entries(CITY_POINTS)) {
    for (const name of Object.keys(points)) {
      if (name.toLowerCase() === key) return { city, name, point: points[name] };
    }
  }
  return null;
}

/**
 * Nearest communes of the same city within NEIGHBOUR_MAX_KM, nearest first.
 * An unknown commune, or one with no verified point, has none.
 *
 * @param {string} commune
 * @returns {Array<{commune: string, km: number}>}
 */
function neighbouringCommunes(commune, { maxKm = NEIGHBOUR_MAX_KM, max = MAX_NEIGHBOURS } = {}) {
  const found = findCommune(commune);
  if (!found || !found.point) return [];
  return Object.entries(CITY_POINTS[found.city])
    .filter(([name, point]) => name !== found.name && point && Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map(([name, point]) => ({ commune: name, km: Math.round(haversineKm(found.point, point) * 10) / 10 }))
    .filter((n) => n.km <= maxKm)
    .sort((a, b) => a.km - b.km || a.commune.localeCompare(b.commune))
    .slice(0, max);
}

module.exports = {
  neighbouringCommunes,
  haversineKm,
  KINSHASA_COMMUNE_CENTROIDS,
  NEIGHBOUR_MAX_KM,
  MAX_NEIGHBOURS,
};
