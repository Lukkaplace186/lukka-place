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
 * Floating Map/Sort pill above the bottom nav (mobile only, /listings).
 * "Trier" is a real shadcn DropdownMenu (same sort values as SortDropdown.js).
 * "Carte" toggles the real map view (lib/geocoding.js + components/PropertyMap.js)
 * via the `?view=` query param — same URL-driven-state convention already
 * used for filters/sort/pagination on this page, so the map/list choice is
 * bookmarkable and shareable like everything else here.
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
    <div className="fixed inset-x-0 bottom-[4.75rem] z-30 flex justify-center lg:hidden">
      <div className="u-lift flex items-center overflow-hidden rounded-full border border-line bg-surface">
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
