'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
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
 * Real sort options only — no fabricated "Homes for You" recommendation
 * ranking (we have no such engine). `newest` (default) and price ASC/DESC
 * are genuine `ORDER BY` clauses in lib/listings.js.
 */
export default function SortDropdown() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get('sort') || 'newest';
  const currentLabel = SORT_OPTIONS.find((o) => o.value === current)?.label;

  function handleChange(value) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
    params.delete('page');
    router.push(`/listings?${params.toString()}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Trier par"
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-2 text-[0.8125rem] font-medium text-ink-70 transition-colors hover:border-ink-25 hover:text-ink focus:outline-none"
        >
          Trier : {currentLabel}
          <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={current} onValueChange={handleChange}>
          {SORT_OPTIONS.map(({ value, label }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
