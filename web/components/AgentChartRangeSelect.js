'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * The range selector on the design's "Vues de vos annonces" card. Navigates
 * on change (no separate "Filtrer" button — the design's control is a bare
 * Select), pushing the choice into the URL so the range is bookmarkable and
 * survives a reload, same URL-driven-state convention the listings filters
 * already follow.
 *
 * useSearchParams is read here, in the smallest component that needs it,
 * rather than in the page — see web/CLAUDE.md: calling it at page level
 * puts the whole page inside a Suspense boundary.
 */
export default function AgentChartRangeSelect({ options, value }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(event) {
    const params = new URLSearchParams(searchParams);
    params.set('range', event.target.value);
    startTransition(() => router.push(`?${params.toString()}`, { scroll: false }));
  }

  return (
    <select
      value={value}
      onChange={onChange}
      aria-label="Période du graphique"
      data-pending={pending ? '' : undefined}
      className="u-focus-ring h-10 w-[9.5rem] rounded-lg border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink data-pending:opacity-60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
