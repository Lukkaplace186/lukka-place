'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import SortSheet from '@/components/SortSheet';
import { SORT_OPTIONS } from '@/components/SortDropdown';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The app's sort control, beside the result count (the owner's reference
 * results screen): it names the order in force and opens the shared sort
 * sheet. Rendered inside <Suspense> by ResultsHeader (useSearchParams).
 */
export default function AppSortButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = useSearchParams().get('sort') || 'complete';
  const labelKey = SORT_OPTIONS.find((o) => o.value === current)?.labelKey;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${t('listings.sort.label')} : ${labelKey ? t(labelKey) : ''}`}
        className="u-press -mr-1 inline-flex min-h-11 max-w-[14rem] shrink-0 items-center gap-1 rounded-lg px-1 text-[0.8125rem] font-semibold text-ink"
      >
        <span className="truncate">{labelKey ? t(labelKey) : t('listings.sort.short')}</span>
        <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 flex-none text-ink-45" />
      </button>
      <SortSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
