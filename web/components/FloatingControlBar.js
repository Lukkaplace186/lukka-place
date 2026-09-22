'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Map, ArrowUpDown, Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { SORT_OPTIONS } from './SortDropdown';
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
 * List-mode only (`!isMapView` — see app/(site)/listings/page.js): the
 * mobile fullscreen map already has its own bottom-center floating control
 * at this exact position (MobileMapOverlay.js's "← Liste" button).
 *
 * "Carte" always sets `view=map` (never toggles it back off) — correct
 * specifically because this pill only ever renders in list mode.
 *
 * "Trier" opens a bottom sheet over SortDropdown.js's exact SORT_OPTIONS
 * rather than a second sort implementation.
 */
export default function FloatingControlBar({ hasResults = true }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortOpen, setSortOpen] = useState(false);
  const t = useT();
  const currentSort = searchParams.get('sort') || 'newest';

  function openMapView() {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', 'map');
    router.push(`/listings?${params.toString()}`);
  }

  function applySort(value) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
    params.delete('page');
    router.push(`/listings?${params.toString()}`);
    setSortOpen(false);
  }

  return (
    <>
      <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 lg:hidden">
        {/* "Prestige white" — bg-surface (the real --surface, #fff) at 95%
            with backdrop-blur, not a flat opaque white: real elevation
            (shadow-xl) plus a hairline border-line/80 (this app's real
            hairline token, not a generic slate-200) is what separates it
            from a busy photo now instead of a dark fill. Text/icons flip to
            ink and hover/press go darker-on-light (bg-canvas-alt) since the
            surface itself is light now. */}
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
      </div>

      <Sheet open={sortOpen} onOpenChange={setSortOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl border-line bg-surface p-0">
          <SheetHeader className="border-b border-line px-5 py-4">
            <SheetTitle>{t('listings.sort.label')}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {SORT_OPTIONS.map(({ value, labelKey }) => (
              <button
                key={value}
                type="button"
                onClick={() => applySort(value)}
                className="flex items-center justify-between rounded-md px-3.5 py-3.5 text-left text-[0.9375rem] font-medium text-ink transition-colors hover:bg-canvas-alt"
              >
                {t(labelKey)}
                {currentSort === value ? (
                  <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue" />
                ) : null}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
