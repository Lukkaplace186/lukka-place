import { PARCELLE_SUBTYPES, AMENITY_GROUPS } from './constants';

const PARCELLE_LABELS = Object.fromEntries(PARCELLE_SUBTYPES.map(({ value, label }) => [value, label]));

const AMENITY_LABELS = Object.fromEntries(
  AMENITY_GROUPS.flatMap(({ options }) => options.map(({ key, label }) => [key, label])),
);

/**
 * Human-readable summary of a /listings query — "Appartements à louer à
 * Gombe" — shared between SaveSearchButton.js (a saved search's label) and
 * FilterBar.js (a recent search's label, lib/searchHistory.js). Extracted
 * out of SaveSearchButton.js, its original home, rather than duplicated.
 *
 * @param {URLSearchParams} searchParams
 */
export function buildSearchLabel(searchParams) {
  const parts = [];
  const propertyType = searchParams.get('property_type');
  const parcelleSubtype = searchParams.get('parcelle_subtype');
  if (parcelleSubtype && PARCELLE_LABELS[parcelleSubtype]) parts.push(PARCELLE_LABELS[parcelleSubtype]);
  else if (propertyType === 'appartement') parts.push('Appartements');
  else if (propertyType === 'parcelle') parts.push('Parcelles');
  else parts.push('Biens');

  // Falls back to "disponibles" when transaction_type is absent, matching
  // ResultsHeader.js's own three-way heading logic — the previous version
  // here only distinguished 'location', so an untyped search (no
  // transaction_type at all) was mislabeled "à vendre" rather than left
  // neutral.
  const transactionType = searchParams.get('transaction_type');
  parts.push(transactionType === 'location' ? 'à louer' : transactionType === 'vente' ? 'à vendre' : 'disponibles');

  const quartier = searchParams.get('quartier');
  const commune = searchParams.get('commune');
  if (quartier) parts.push(`à ${quartier}`);
  else if (commune) parts.push(`à ${commune}`);

  const radius = searchParams.get('radius');
  if (commune && radius) {
    if (['1', '3', '5'].includes(radius)) parts.push(`+${radius}km`);
    else if (radius === 'citywide') parts.push('(toute la ville)');
  }

  const q = searchParams.get('q');
  if (q) parts.push(`"${q}"`);

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
 * @param {URLSearchParams} searchParams
 * @returns {string[]}
 */
export function searchCriteriaTags(searchParams) {
  const tags = [];
  const get = (key) => searchParams.get(key);

  const transactionType = get('transaction_type');
  if (transactionType === 'location') tags.push('Location');
  else if (transactionType === 'vente') tags.push('Achat');

  const parcelleSubtype = get('parcelle_subtype');
  const propertyType = get('property_type');
  if (parcelleSubtype && PARCELLE_LABELS[parcelleSubtype]) tags.push(PARCELLE_LABELS[parcelleSubtype]);
  else if (propertyType === 'appartement') tags.push('Appartement');
  else if (propertyType === 'parcelle') tags.push('Parcelle');

  const commune = get('commune');
  if (commune) tags.push(commune);
  const quartier = get('quartier');
  if (quartier) tags.push(quartier);
  if (commune && get('radius') === 'citywide') tags.push('Toute la ville');

  const bedsMin = get('beds_min');
  if (bedsMin) tags.push(`${bedsMin} chambre${Number(bedsMin) > 1 ? 's' : ''} et plus`);
  const bathMin = get('bath_min');
  if (bathMin) tags.push(`${bathMin} sdb et plus`);

  const priceMin = get('price_min');
  const priceMax = get('price_max');
  const money = (value) => `$${Number(value).toLocaleString('en-US')}`;
  if (priceMin && priceMax) tags.push(`${money(priceMin)} – ${money(priceMax)}`);
  else if (priceMin) tags.push(`À partir de ${money(priceMin)}`);
  else if (priceMax) tags.push(`Max ${money(priceMax)}`);

  const depositMax = get('deposit_max');
  if (depositMax) tags.push(`Garantie max ${depositMax} mois`);

  const amenities = (get('amenities') || '').split(',').filter(Boolean);
  for (const key of amenities) {
    if (AMENITY_LABELS[key]) tags.push(AMENITY_LABELS[key]);
  }

  const reference = get('reference');
  if (reference) tags.push(`Réf. ${reference}`);
  const q = get('q');
  if (q) tags.push(`« ${q} »`);

  return tags;
}
