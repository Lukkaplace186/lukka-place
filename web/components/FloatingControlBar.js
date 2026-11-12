'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Map, ArrowUpDown } from 'lucide-react';
import SortSheet from './SortSheet';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import SaveSearchButton from './SaveSearchButton';

/**
 * The one set of list controls on a phone: a floating Carte | Trier | Alerte
 * pill at the bottom of mobile /listings. It used to be the second copy of
 * each — FilterBar carried its own Carte/alert row under the search box and
 * ResultsHeader its own sort dropdown — which cost two rows above the first
 * card and put every control on screen twice. Those in-page copies are now
 * desktop-only (`lg:`), so this pill is their only mobile home.
 *
 * `hasResults` false (an empty search) leaves only Alerte: there is nothing
 * to map or sort, and an alert is exactly what an empty search wants.
 *
 * List-mode only (`!isMapView` — see app/(site)/listings/(search)/(results)/page.js): the
 * mobile fullscreen map already has its own bottom-center floating control
 * at this exact position (MobileMapBar.js's "← Liste" button).
 *
 * "Carte" always sets `view=map` (never toggles it back off) — correct
 * specifically because this pill only ever renders in list mode.
 *
 * "Trier" opens a bottom sheet over SortDropdown.js's exact SORT_OPTIONS
 * rather than a second sort implementation (components/SortSheet.js).
 *
 * In the store app (`aboveTabBar`, 2026-11-12, the owner's reference results
 * screen) the bar is two solid ink buttons, Carte and Alerte: sorting moved
 * beside the result count (components/app/AppSortButton.js). Ink, not blue:
 * blue stays the one colour for a screen's main action.
 */
export default function FloatingControlBar({ hasResults = true, aboveTabBar = false }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortOpen, setSortOpen] = useState(false);
  const t = useT();

  function openMapView() {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', 'map');
    router.push(`/listings?${params.toString()}`);
  }

  return (
    <>
      {/* In the store app the tab bar holds the bottom edge: the pill sits just above it. */}
      <div
        className={`fixed left-1/2 z-40 -translate-x-1/2 lg:hidden ${
          aboveTabBar ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]' : 'bottom-6'
        }`}
      >
        {/* "Prestige white" — bg-surface (the real --surface, #fff) at 95%
            with backdrop-blur, not a flat opaque white: real elevation
            (shadow-xl) plus a hairline border-line/80 (this app's real
            hairline token, not a generic slate-200) is what separates it
            from a busy photo now instead of a dark fill. Text/icons flip to
            ink and hover/press go darker-on-light (bg-canvas-alt) since the
            surface itself is light now. */}
        {aboveTabBar ? (
          <div className="flex items-center gap-2">
            {hasResults ? (
              <button
                type="button"
                onClick={openMapView}
                className="u-press flex min-h-12 items-center gap-2 whitespace-nowrap rounded-full bg-ink px-5 text-[0.875rem] font-semibold text-white shadow-[var(--shadow-md)] ring-1 ring-white/15 active:bg-blue-900"
              >
                <Map strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('listings.view.map')}
              </button>
            ) : null}
            <SaveSearchButton variant="pill" tone="solid" />
          </div>
        ) : (
        <div className="flex items-center gap-0.5 rounded-full border border-line/80 bg-surface/95 p-1 text-ink shadow-xl lg:backdrop-blur-md">
          {hasResults ? (
            <>
              <button
                type="button"
                onClick={openMapView}
                className="u-press flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors hover:bg-canvas-alt active:scale-95"
              >
                <Map strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('listings.view.map')}
              </button>
              <span aria-hidden="true" className="h-5 w-px bg-line" />
              <button
                type="button"
                onClick={() => setSortOpen(true)}
                className="u-press flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors hover:bg-canvas-alt active:scale-95"
              >
                <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('listings.sort.short')}
              </button>
              <span aria-hidden="true" className="h-5 w-px bg-line" />
            </>
          ) : null}
          <SaveSearchButton variant="pill" />
        </div>
        )}
      </div>

      <SortSheet open={sortOpen} onOpenChange={setSortOpen} />
    </>
  );
}
