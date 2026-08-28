'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Map, ArrowUpDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Plus récents' },
  { value: 'price_asc', label: 'Prix croissant' },
  { value: 'price_desc', label: 'Prix décroissant' },
];

/**
 * Floating Map/Sort pill, centred near the viewport bottom (mobile only,
 * /listings). "Trier" is a real shadcn DropdownMenu (same sort values as
 * SortDropdown.js). "Carte" toggles the real map view (lib/geocoding.js +
 * components/PropertyMap.js) via the `?view=` query param — same
 * URL-driven-state convention already used for filters/sort/pagination on
 * this page, so the map/list choice is bookmarkable and shareable like
 * everything else here.
 *
 * Used to sit at `bottom-[4.75rem]`, clearing the fixed BottomNav.js tab
 * bar underneath it. That bar is gone entirely (see app/(site)/layout.js),
 * so this now floats directly over the results near the true viewport
 * edge — `bottom-6`, centred with `left-1/2 -translate-x-1/2` rather than
 * the previous `inset-x-0 flex justify-center` (equivalent centring, but
 * matching the literal Rightmove-style floating-pill pattern this follows
 * now that nothing else anchors the bottom of the screen). `bg-surface/95
 * backdrop-blur-sm` + `shadow-lg` (real `--surface`/`--border-subtle`
 * tokens, not the raw `bg-white`/`border-slate-200` Tailwind defaults —
 * this app's whole palette is token-driven, see web/CLAUDE.md, and
 * `--surface` already resolves to the exact same #fff) is what lets it read
 * sharply over both a light card and a photo as the results scroll behind
 * it. listings/page.js's `pb-24` on the results container is calibrated
 * to this new position — see the comment there.
 */
export default function FloatingControlBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSort = searchParams.get('sort') || 'newest';
  const isMapView = searchParams.get('view') === 'map';

  function selectSort(value) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
    params.delete('page');
    router.push(`/listings?${params.toString()}`);
  }

  function toggleView() {
    const params = new URLSearchParams(searchParams.toString());
    if (isMapView) {
      params.delete('view');
    } else {
      params.set('view', 'map');
    }
    router.push(`/listings?${params.toString()}`);
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 lg:hidden">
      <div className="flex items-center overflow-hidden rounded-full border border-line bg-surface/95 shadow-lg backdrop-blur-sm">
        <button type="button" onClick={toggleView} className="u-press flex items-center gap-1.5 px-5 py-2.5 text-[0.8125rem] font-semibold text-ink">
          <Map strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> {isMapView ? 'Liste' : 'Carte'}
        </button>
        <span className="h-5 w-px bg-line" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="u-press flex items-center gap-1.5 px-5 py-2.5 text-[0.8125rem] font-semibold text-ink">
              <ArrowUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> Trier
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            <DropdownMenuRadioGroup value={currentSort} onValueChange={selectSort}>
              {SORT_OPTIONS.map(({ value, label }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
