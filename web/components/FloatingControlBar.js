'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Map, ArrowUpDown, Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { SORT_OPTIONS } from './SortDropdown';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * A floating bottom-center Carte/Trier pill on mobile /listings — brought
 * back on an explicit instruction, over the same real actions that already
 * live in-page: FilterBar's own "Carte" toggle (its mobile utility row) and
 * ResultsHeader's SortDropdown ("Trier"). A component with this exact name
 * and role existed before and was deliberately deleted (see FilterBar.js's
 * and ResultsHeader.js's own doc comments) specifically to stop floating
 * chrome over the feed in favour of that in-page placement — this does not
 * remove that in-page placement, it adds a second, floating entry point to
 * the same two real actions back on top of it.
 *
 * List-mode only (`!isMapView` — see app/(site)/listings/page.js): the
 * mobile fullscreen map already has its own bottom-center floating control
 * at this exact position (MobileMapOverlay.js's "← Liste" button), so
 * rendering this pill there too would sit directly on top of it.
 *
 * "Carte" always sets `view=map` (never toggles it back off) — correct
 * specifically because this pill only ever renders in list mode.
 *
 * "Trier" opens a bottom sheet over SortDropdown.js's exact SORT_OPTIONS
 * (real `ORDER BY` values — no fabricated "verification status" option;
 * every listing reaching this page already passed moderation, so that
 * wouldn't distinguish anything) rather than a second sort implementation.
 */
export default function FloatingControlBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortOpen, setSortOpen] = useState(false);
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
        <div className="flex items-center gap-1 rounded-full border border-line/80 bg-surface/95 p-1.5 text-ink shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={openMapView}
            className="u-press flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[0.8125rem] font-semibold transition-colors hover:bg-canvas-alt active:scale-95"
          >
            <Map strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Carte
          </button>
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <button
            type="button"
            onClick={() => setSortOpen(true)}
            className="u-press flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[0.8125rem] font-semibold transition-colors hover:bg-canvas-alt active:scale-95"
          >
            <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Trier
          </button>
        </div>
      </div>

      <Sheet open={sortOpen} onOpenChange={setSortOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl border-line bg-surface p-0">
          <SheetHeader className="border-b border-line px-5 py-4">
            <SheetTitle>Trier par</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {SORT_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => applySort(value)}
                className="flex items-center justify-between rounded-md px-3.5 py-3.5 text-left text-[0.9375rem] font-medium text-ink transition-colors hover:bg-canvas-alt"
              >
                {label}
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
