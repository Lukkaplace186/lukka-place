/**
 * The place a /listings URL searches, as text for the search box — so the box
 * still says "Bandalungwa" after a search for "2 chambres bandal moins de
 * 800$" rather than coming back empty while the heading names the place.
 * Written so parseSearchQuery() reads it back to the same place on Enter.
 * '' when no place is set.
 *
 * Its own module (2026-11-26, phone speed): FilterBar and MobileMapChrome
 * render it on first paint, and importing it from lib/searchParser.js put
 * the whole parser and the place gazetteer into /listings' first download.
 * lib/searchParser.js re-exports it.
 */
export function searchedPlaceLabel(params) {
  if (!params) return '';
  const quartier = String(params.quartier || '').trim();
  if (quartier) return quartier;
  const communes = String(params.communes || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const label = (c) => (c === 'Kinshasa' ? 'commune de Kinshasa' : c);
  if (communes.length > 1) return communes.map(label).join(' ou ');
  const commune = String(params.commune || '').trim();
  // The parser reads a bare 'Kinshasa' as the city, not the commune.
  return commune ? label(commune) : '';
}

/** Escapes a string for use inside a RegExp (also re-exported by lib/searchParser.js). */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
