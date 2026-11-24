'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { SORT_OPTIONS } from './SortDropdown';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The phone's sort sheet over SortDropdown.js's exact SORT_OPTIONS, shared by
 * the website's floating bar (FloatingControlBar) and the app's "Trier"
 * button beside the result count (components/app/AppSortButton.js): one sort
 * implementation, two ways to open it.
 */
export default function SortSheet({ open, onOpenChange }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useT();
  const currentSort = searchParams.get('sort') || 'complete';

  function applySort(value) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
    params.delete('page');
    router.push(`/listings?${params.toString()}`);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
  );
}
