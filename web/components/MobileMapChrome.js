'use client';

import { Menu, SlidersHorizontal } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import MapQuickFilters from './MapQuickFilters';
import { openFiltersDrawer } from '@/lib/mapFilterDrawer';
import { openSiteMenu } from '@/lib/siteMenu';
import { searchedPlaceLabel } from '@/lib/searchParser';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Sticky top bar for the mobile fullscreen map — the map-mode replacement
 * for FilterBar (hidden on mobile while isMapView, see
 * app/(site)/listings/(search)/(results)/page.js), real search + a real filter trigger. A
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
    // The phone map's whole header since 2026-11-17: ☰, search, filters and
    // the chips on one liquid-glass panel (ListingsSplitView); the site's logo
    // bar steps aside while the map is open. Fields are lighter glass panes.
    <div className="lg:hidden">
    <div className="flex items-center gap-2">
      {/* The site's logo bar steps aside while the phone map is open
          (app/globals.css, [data-site-header]); its menu lives here. */}
      <button
        type="button"
        data-site-menu-button
        onClick={() => openSiteMenu()}
        aria-label={t('nav.openMenu')}
        className="u-press u-liquid-glass-field pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink"
      >
        <Menu strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </button>
      <LocationAutocomplete
        preserveParams
        initialValue={params.q || params.near || searchedPlaceLabel(params)}
        placeholder="Commune, quartier…"
        ariaLabel="Rechercher sur la carte"
        showIcon
        showClear
        rowClassName="flex min-w-0 flex-1 items-center gap-2"
        inputClassName="min-w-0 flex-1 bg-transparent text-[0.875rem] text-ink placeholder:text-ink-25 focus:outline-none"
        className="u-liquid-glass-field pointer-events-auto min-w-0 flex-1 rounded-full px-4 py-2.5"
      />

      <button
        type="button"
        onClick={() => openFiltersDrawer()}
        aria-label={t('listings.filters.moreFilters')}
        className="u-press u-liquid-glass-field pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-70"
      >
        <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>
    </div>
    {/* Prix · Chambres · Type, applied without leaving the map. */}
    <MapQuickFilters params={params} propertyTypes={propertyTypes} />
    </div>
  );
}
