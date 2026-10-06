'use client';

import { SlidersHorizontal } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import MapQuickFilters from './MapQuickFilters';
import { openFiltersDrawer } from '@/lib/mapFilterDrawer';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Sticky top bar for the mobile fullscreen map — the map-mode replacement
 * for FilterBar (hidden on mobile while isMapView, see
 * app/(site)/listings/page.js), real search + a real filter trigger. A
 * normal in-flow element (`shrink-0` in ListingsSplitView's flex-column map
 * wrapper), not an absolutely-positioned overlay floating over the map —
 * that's what lets the map canvas below it fill the rest of the viewport
 * with plain `flex-1` instead of a guessed pixel offset (the earlier
 * `h-[calc(100vh-64px)]` request had the same problem this sidesteps: a
 * literal number can't know this bar's real rendered height).
 *
 * Search re-uses LocationAutocomplete exactly as FilterBar does
 * (`preserveParams`, so a search here keeps `view=map` and every other
 * active filter). The filter button opens FilterBar's own FilterModal (the
 * mobile-wide comprehensive filter sheet, not the desktop-only
 * FiltersDrawer) via lib/mapFilterDrawer.js rather than a second, duplicate
 * sheet.
 *
 * The "back to list" action lives in MobileMapBar now, as a single
 * floating button over the map itself — not here, per the explicit
 * "one clean Liste control" instruction.
 */
export default function MobileMapChrome({ params, propertyTypes = [] }) {
  const t = useT();
  return (
    // Floats over the phone map (ListingsSplitView gives it a pointer-events-
    // none layer, so the map stays draggable around the two controls).
    <div className="lg:hidden">
    <div className="flex items-center gap-2">
      <LocationAutocomplete
        preserveParams
        initialValue={params.q || params.near || ''}
        placeholder="Commune, quartier…"
        ariaLabel="Rechercher sur la carte"
        showIcon
        showClear
        rowClassName="flex min-w-0 flex-1 items-center gap-2"
        inputClassName="min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink placeholder:text-ink-25 focus:outline-none"
        className="u-lift pointer-events-auto min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2.5"
      />

      <button
        type="button"
        onClick={() => openFiltersDrawer()}
        aria-label={t('listings.filters.moreFilters')}
        className="u-press u-lift pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-70"
      >
        <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>
    </div>
    {/* Prix · Chambres · Type, applied without leaving the map. */}
    <MapQuickFilters params={params} propertyTypes={propertyTypes} />
    </div>
  );
}
