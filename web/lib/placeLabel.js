/**
 * "Quartier, Commune" — how a listing's place is written everywhere it is
 * shown or shared (product rule, 2026-10-07: quartier first, then the commune
 * when known). Either half alone when the other is missing; the commune alone
 * when the quartier only repeats it. The engine's services/locations.js
 * placeLabel is the same rule for the messages it sends — change one, change
 * the other.
 *
 * Pure and dependency-free: used by client components and server code alike.
 */
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
  const q = String(quartier || '').replace(/\s+/g, ' ').trim();
  const c = String(commune || '').replace(/\s+/g, ' ').trim();
  if (q && c && foldKey(q) === foldKey(c)) return c;
  return [q, c].filter(Boolean).join(', ');
}
