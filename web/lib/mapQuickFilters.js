/**
 * Pure half of components/MapQuickFilters.js (the phone map's Prix ·
 * Chambres · Type chips), so the unit tier can pin it.
 */
export const MAP_PRICE_STEPS = [300, 500, 800, 1000, 1500, 2000, 3000, 5000];
export const MAP_BED_STEPS = [1, 2, 3, 4];

export function mapFilterHref(search, key, value) {
  const params = new URLSearchParams(search);
  if (value === '' || value == null) params.delete(key);
  else params.set(key, String(value));
  if (key === 'property_type') params.delete('parcelle_subtype');
  params.delete('page');
  return `/listings?${params.toString()}`;
}
