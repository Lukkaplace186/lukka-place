import { PARCELLE_SUBTYPES } from './constants';

const PARCELLE_LABELS = Object.fromEntries(PARCELLE_SUBTYPES.map(({ value, label }) => [value, label]));

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
