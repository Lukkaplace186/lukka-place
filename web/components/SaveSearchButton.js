'use client';

import { useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import { isSearchSaved, removeSavedSearch, saveSearch, subscribeSavedSearches } from '@/lib/favorites';
import { PARCELLE_SUBTYPES, ICON_STROKE_WIDTH } from '@/lib/constants';

const PARCELLE_LABELS = Object.fromEntries(PARCELLE_SUBTYPES.map(({ value, label }) => [value, label]));

function buildSearchLabel(searchParams) {
  const parts = [];
  const propertyType = searchParams.get('property_type');
  const parcelleSubtype = searchParams.get('parcelle_subtype');
  if (parcelleSubtype && PARCELLE_LABELS[parcelleSubtype]) parts.push(PARCELLE_LABELS[parcelleSubtype]);
  else if (propertyType === 'appartement') parts.push('Appartements');
  else if (propertyType === 'parcelle') parts.push('Parcelles');
  else parts.push('Biens');

  parts.push(searchParams.get('transaction_type') === 'location' ? 'à louer' : 'à vendre');

  const quartier = searchParams.get('quartier');
  const commune = searchParams.get('commune');
  if (quartier) parts.push(`à ${quartier}`);
  else if (commune) parts.push(`à ${commune}`);

  const q = searchParams.get('q');
  if (q) parts.push(`"${q}"`);

  return parts.join(' ');
}

/**
 * Real, local-only "Save search" (see lib/favorites.js's doc comment for
 * why — no accounts backend exists). Saves the current /listings query
 * string to localStorage; viewable and removable from /favoris. Must be
 * type="button": this renders inside the same <form> as the filter fields
 * (see FilterBar.js) and must never trigger its submit.
 */
export default function SaveSearchButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => isSearchSaved(queryString),
    () => false,
  );

  function handleClick() {
    if (saved) {
      removeSavedSearch(queryString);
    } else {
      saveSearch({ query: queryString, label: buildSearchLabel(searchParams), href: `${pathname}?${queryString}` });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={saved}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[0.8125rem] font-semibold transition-colors ${
        saved
          ? 'border border-blue bg-blue-tint text-blue-deep'
          : 'border border-line bg-surface text-ink-70 hover:border-blue hover:text-blue-deep'
      }`}
    >
      <Bookmark
        fill={saved ? 'currentColor' : 'none'}
        strokeWidth={ICON_STROKE_WIDTH}
        className="h-4 w-4"
      />
      {saved ? 'Enregistrée' : 'Sauvegarder'}
    </button>
  );
}
