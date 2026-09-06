import { PARCELLE_SUBTYPES, AMENITY_GROUPS } from './constants';

const PARCELLE_LABEL_KEYS = Object.fromEntries(PARCELLE_SUBTYPES.map(({ value, labelKey }) => [value, labelKey]));

const AMENITY_LABEL_KEYS = Object.fromEntries(
  AMENITY_GROUPS.flatMap(({ options }) => options.map(({ key, labelKey }) => [key, labelKey])),
);

/**
 * Human-readable summary of a /listings query — "Appartements à louer à
 * Gombe" — shared between SaveSearchButton.js (a saved search's label) and
 * FilterBar.js (a recent search's label, lib/searchHistory.js). Extracted
 * out of SaveSearchButton.js, its original home, rather than duplicated.
 *
 * Both callers are client components and pass their own `useT()`. The label
 * is built in whichever language was active when the search was saved and is
 * then STORED as that text — re-deriving it later would mean re-parsing every
 * saved query on every render, and would silently rewrite labels a customer
 * has already seen in their alerts list. A saved search is a snapshot; its
 * label is part of the snapshot.
 *
 * @param {URLSearchParams} searchParams
 * @param {(key: string, vars?: object) => string} t
 */
export function buildSearchLabel(searchParams, t) {
  const parts = [];
  const propertyType = searchParams.get('property_type');
  const parcelleSubtype = searchParams.get('parcelle_subtype');
  if (parcelleSubtype && PARCELLE_LABEL_KEYS[parcelleSubtype]) parts.push(t(PARCELLE_LABEL_KEYS[parcelleSubtype]));
  else if (propertyType === 'appartement') parts.push(t('search.label.apartments'));
  else if (propertyType === 'parcelle') parts.push(t('search.label.plots'));
  else parts.push(t('search.label.properties'));

  // Falls back to "disponibles" when transaction_type is absent, matching
  // ResultsHeader.js's own three-way heading logic — the previous version
  // here only distinguished 'location', so an untyped search (no
  // transaction_type at all) was mislabeled "à vendre" rather than left
  // neutral.
  const transactionType = searchParams.get('transaction_type');
  parts.push(
    transactionType === 'location'
      ? t('search.label.toRent')
      : transactionType === 'vente'
        ? t('search.label.toBuy')
        : t('search.label.available'),
  );

  const quartier = searchParams.get('quartier');
  const commune = searchParams.get('commune');
  // Place names are real data, never translated — only the preposition is.
  if (quartier) parts.push(t('search.label.in', { place: quartier }));
  else if (commune) parts.push(t('search.label.in', { place: commune }));

  const radius = searchParams.get('radius');
  if (commune && radius) {
    if (['1', '3', '5'].includes(radius)) parts.push(t('search.label.radiusKm', { km: radius }));
    else if (radius === 'citywide') parts.push(t('search.label.citywide'));
  }

  const q = searchParams.get('q');
  if (q) parts.push(t('search.label.quoted', { query: q }));

  return parts.join(' ');
}

/**
 * A saved search's real criteria, as discrete chips — the design's Tag row
 * on each alert card ("Location", "2 chambres", "Gombe", "Meublé").
 *
 * Every chip is read straight out of the search's own stored query string;
 * there is no inference and no default. A saved search that only carries
 * `transaction_type=location` produces exactly one chip, not a padded row.
 * Shares the exact same param names as parseListingsSearchParams (which is
 * what actually re-runs the search) so the chips can never describe
 * criteria the query doesn't really apply.
 *
 * Unlike buildSearchLabel above, these chips are derived at RENDER time from
 * the stored query string rather than stored themselves, so they do follow
 * the language toggle — the same saved search shows French chips to a French
 * visitor and English ones to an English visitor.
 *
 * @param {URLSearchParams} searchParams
 * @param {(key: string, vars?: object) => string} t
 * @returns {string[]}
 */
export function searchCriteriaTags(searchParams, t) {
  const tags = [];
  const get = (key) => searchParams.get(key);

  const transactionType = get('transaction_type');
  if (transactionType === 'location') tags.push(t('search.tags.rental'));
  else if (transactionType === 'vente') tags.push(t('search.tags.purchase'));

  const parcelleSubtype = get('parcelle_subtype');
  const propertyType = get('property_type');
  if (parcelleSubtype && PARCELLE_LABEL_KEYS[parcelleSubtype]) tags.push(t(PARCELLE_LABEL_KEYS[parcelleSubtype]));
  else if (propertyType === 'appartement') tags.push(t('search.tags.apartment'));
  else if (propertyType === 'parcelle') tags.push(t('search.tags.plot'));

  // Commune and quartier are real place names — pushed through untouched.
  const commune = get('commune');
  if (commune) tags.push(commune);
  const quartier = get('quartier');
  if (quartier) tags.push(quartier);
  if (commune && get('radius') === 'citywide') tags.push(t('search.tags.citywide'));

  const bedsMin = get('beds_min');
  if (bedsMin) tags.push(t('search.tags.bedsMin', { count: Number(bedsMin) }));
  const bathMin = get('bath_min');
  if (bathMin) tags.push(t('search.tags.bathMin', { count: bathMin }));

  const priceMin = get('price_min');
  const priceMax = get('price_max');
  const money = (value) => `$${Number(value).toLocaleString('en-US')}`;
  if (priceMin && priceMax) tags.push(t('search.tags.priceRange', { min: money(priceMin), max: money(priceMax) }));
  else if (priceMin) tags.push(t('search.tags.priceFrom', { min: money(priceMin) }));
  else if (priceMax) tags.push(t('search.tags.priceUpTo', { max: money(priceMax) }));

  const depositMax = get('deposit_max');
  if (depositMax) tags.push(t('search.tags.depositMax', { count: depositMax }));

  const amenities = (get('amenities') || '').split(',').filter(Boolean);
  for (const key of amenities) {
    if (AMENITY_LABEL_KEYS[key]) tags.push(t(AMENITY_LABEL_KEYS[key]));
  }

  const reference = get('reference');
  if (reference) tags.push(t('search.tags.reference', { reference }));
  const q = get('q');
  if (q) tags.push(t('search.tags.query', { query: q }));

  return tags;
}
