/**
 * Shared /listings query-string builders — extracted out of
 * ListingsEmptyState.js (its original home) so ActiveFilterChips.js can
 * reuse the exact same "current query, minus/plus one real change" logic
 * instead of a second, possibly-drifting copy. Works on the page's raw
 * `searchParams` object (string | string[] | undefined per key), not a
 * URLSearchParams instance — same shape `parseListingsSearchParams` and
 * every Server Component on this page already receive.
 */

/** Current query minus one or more keys — every other active filter is
 *  preserved. Accepts a single key or an array, since removing some filters
 *  (commune -> quartier + radius; property_type -> parcelle_subtype) means
 *  clearing more than one param at once to avoid leaving an orphaned,
 *  now-meaningless value behind. */
export function hrefWithoutKeys(params, keys) {
  const removeSet = new Set(Array.isArray(keys) ? keys : [keys]);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (removeSet.has(k) || v == null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  const s = qs.toString();
  return s ? `/listings?${s}` : '/listings';
}

/** Current query with one param set/overwritten — every other active
 *  filter preserved. Used for the "Élargir à ..." radius relaxation links. */
export function hrefWithParam(params, key, value) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  qs.set(key, value);
  return `/listings?${qs.toString()}`;
}

/** Current query with exactly one amenity key removed from the `amenities`
 *  comma-list — the other checked amenities (and everything else) survive.
 *  Dropping the whole `amenities` param would clear every other checked
 *  box too, not just the one the visitor clicked "x" on. */
export function hrefWithoutAmenity(params, amenityKey) {
  const current = params?.amenities ? params.amenities.split(',').filter(Boolean) : [];
  const next = current.filter((k) => k !== amenityKey);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'amenities' || v == null || v === '') continue;
    qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  if (next.length) qs.set('amenities', next.join(','));
  const s = qs.toString();
  return s ? `/listings?${s}` : '/listings';
}
