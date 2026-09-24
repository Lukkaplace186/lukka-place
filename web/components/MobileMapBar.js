'use client';

import { useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronUp, List } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useCountUp } from '@/lib/useCountUp';
import { useT } from '@/lib/i18n/client';

/**
 * The phone map's bottom bar (2026-09-24). Replaces the list sheet: the map
 * is never split with a list on a phone — it is the map, full screen, or the
 * list, full screen.
 *
 *   - **"Voir N biens"** — tap it, or swipe up on the bar, and the swipeable
 *     cards of the listings in view slide up over the map (MapCardCarousel).
 *     The count rolls to its new value as the map moves (useCountUp).
 *   - **"Liste"** — the full list of exactly those listings: the map area the
 *     map wrote into the URL travels with it, read at tap time.
 *
 * A solid strip rather than a button floating on the map, so Google's logo
 * and attribution — which must stay visible — sit on the map just above it.
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
      className="absolute inset-x-0 bottom-0 z-20 flex h-14 items-center justify-between gap-3 border-t border-line bg-surface px-3 lg:hidden"
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
        className="u-press flex min-w-0 items-center gap-2 rounded-full py-2 pl-1 pr-3 text-left disabled:opacity-60"
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
        className="u-press flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-[0.8125rem] font-semibold text-ink"
      >
        <List strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('listings.map.sheetShow')}
      </button>
    </div>
  );
}
