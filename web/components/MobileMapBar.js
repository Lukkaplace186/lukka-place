'use client';

import { useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronUp, List } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useCountUp } from '@/lib/useCountUp';
import { useT } from '@/lib/i18n/client';

/**
 * The phone map's floating controls (2026-09-24). The map runs edge to edge
 * under them — no white panel — and there is never a list split with it: it
 * is the map, full screen, or the list, full screen.
 *
 *   - **"Voir N biens"** (left pill) — the count of listings in the visible
 *     area, updated as the map is dragged or zoomed (ListingsMap reports it
 *     on every `idle`), rolling to its new value (useCountUp). Tap it, or
 *     swipe up on it, and the swipeable cards slide up over the map.
 *   - **"Liste"** (right pill) — the full list of exactly those listings: the
 *     map area the map wrote into the URL travels with it, read at tap time.
 *
 * The pills float just above Google's logo and "Map data · Terms" line at the
 * bottom edge, which must stay visible; the strip between them lets map
 * gestures through.
 */
export default function MobileMapBar({ inView = null, onOpenCards }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const count = useCountUp(inView);
  const swipeRef = useRef(null);

  function toList() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('view');
    const s = qs.toString();
    router.push(s ? `/listings?${s}` : '/listings');
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex items-center justify-between gap-3 px-3 lg:hidden"
      onPointerDown={(event) => {
        swipeRef.current = event.clientY;
      }}
      onPointerUp={(event) => {
        const start = swipeRef.current;
        swipeRef.current = null;
        if (start != null && start - event.clientY > 24 && inView) onOpenCards?.();
      }}
    >
      <button
        type="button"
        onClick={() => inView && onOpenCards?.()}
        disabled={!inView}
        className="u-press u-lift pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 text-left disabled:opacity-80"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-tint text-blue-deep" aria-hidden="true">
          <ChevronUp strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </span>
        <span aria-live="polite" className="u-tabular truncate text-[0.9375rem] font-semibold text-ink">
          {count === null ? t('listings.view.list') : t('listings.view.listCount', { count })}
        </span>
      </button>
      <button
        type="button"
        onClick={toList}
        className="u-press u-lift pointer-events-auto flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-[0.8125rem] font-semibold text-ink"
      >
        <List strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('listings.map.sheetShow')}
      </button>
    </div>
  );
}
