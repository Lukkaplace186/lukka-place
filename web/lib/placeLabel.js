/**
 * "Quartier, Commune" — how a listing's place is written everywhere it is
 * shown or shared (product rule, 2026-10-07: quartier first, then the commune
 * when known). Either half alone when the other is missing; the commune alone
 * when the quartier only repeats it. The engine's services/locations.js
 * placeLabel is the same rule for the messages it sends — change one, change
 * the other.
 *
 * Pure: used by client components and server code alike. Outside Kinshasa
 * the city closes the label ("Bel-Air I, Kampemba, Lubumbashi"), once, and a
 * suffixed commune key shows as its plain name (lib/cities.js, 2026-10-20) —
 * the engine's placeLabel does the same.
 */
import { DEFAULT_CITY, cityOfCommune, communeLabel } from './cities';

function foldKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-'’/.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function placeLabel({ quartier = null, commune = null } = {}) {
  const rawCommune = String(commune || '').replace(/\s+/g, ' ').trim();
  const q = String(quartier || '').replace(/\s+/g, ' ').trim();
  const c = communeLabel(rawCommune);
  const city = cityOfCommune(rawCommune);
  const tail = city && city !== DEFAULT_CITY ? city : '';
  const parts = [];
  // A quartier that only repeats its commune is dropped, and the commune's
  // own spelling kept ("kintambo" + "Kintambo" → "Kintambo").
  for (const part of [q && c && foldKey(q) === foldKey(c) ? '' : q, c, tail]) {
    if (part && !parts.some((p) => foldKey(p) === foldKey(part))) parts.push(part);
  }
  return parts.join(', ');
}
