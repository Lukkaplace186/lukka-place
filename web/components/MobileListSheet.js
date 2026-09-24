'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, List } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const PEEK_PX = 64;
const SNAPS = ['peek', 'half', 'full'];

/**
 * The phone map's list, as a sheet over the bottom of the map (Zillow /
 * Airbnb). Replaces MobileMapOverlay's lone "Voir N biens" button, and that
 * button's text is still the sheet's handle, so nothing is lost:
 *
 *   - **peek** (default): just the handle — the map on its own;
 *   - **half**: map above, listings below, both live — the "list and map in
 *     one view" option;
 *   - **full**: the listings, with "Liste complète" to the paginated list page.
 *
 * Drag the handle, or tap it to step up (peek → half → full); the chevron
 * steps back down. `onOpenChange(open)` tells ListingsSplitView the list is
 * now visible, so the list follows the map area (router.replace) instead of
 * the phone-only history.replaceState that spares data while nobody reads it.
 * `hidden` drops the whole sheet while the swipeable pin cards are open.
 */
export default function MobileListSheet({ inView = null, hidden = false, onOpenChange, children }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [snap, setSnap] = useState('peek');
  const [dragPx, setDragPx] = useState(null);
  const sheetRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    onOpenChange?.(snap !== 'peek');
  }, [snap, onOpenChange]);

  // The sheet's own height is the map area's; each snap is a translate.
  const offsetFor = useCallback((name) => {
    const height = sheetRef.current?.clientHeight || 600;
    if (name === 'full') return 0;
    if (name === 'half') return Math.round(height * 0.5);
    return height - PEEK_PX;
  }, []);

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    dragRef.current = { startY: event.clientY, startOffset: offsetFor(snap), moved: false, t: performance.now() };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    const max = offsetFor('peek');
    setDragPx(Math.min(max, Math.max(0, drag.startOffset + dy)));
  }

  function onPointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      // A tap steps up.
      setSnap((current) => SNAPS[Math.min(SNAPS.indexOf(current) + 1, SNAPS.length - 1)]);
      setDragPx(null);
      return;
    }
    const dy = event.clientY - drag.startY;
    const velocity = dy / Math.max(1, performance.now() - drag.t); // px per ms, + is down
    const position = drag.startOffset + dy;
    let next;
    if (velocity > 0.6) next = SNAPS[Math.max(SNAPS.indexOf(snap) - 1, 0)];
    else if (velocity < -0.6) next = SNAPS[Math.min(SNAPS.indexOf(snap) + 1, SNAPS.length - 1)];
    else next = SNAPS.reduce((best, name) => (Math.abs(offsetFor(name) - position) < Math.abs(offsetFor(best) - position) ? name : best), 'peek');
    setSnap(next);
    setDragPx(null);
  }

  function openFullList() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('view');
    const s = qs.toString();
    router.push(s ? `/listings?${s}` : '/listings');
  }

  const translate = hidden ? '100%' : dragPx != null ? `${dragPx}px` : snap === 'full' ? '0px' : snap === 'half' ? '50%' : `calc(100% - ${PEEK_PX}px)`;
  const label = inView === null ? t('listings.view.list') : t('listings.view.listCount', { count: inView });

  return (
    <div
      ref={sheetRef}
      className="pointer-events-none absolute inset-0 z-20 lg:hidden"
      aria-hidden={hidden || undefined}
    >
      <section
        aria-label={t('listings.map.sheetLabel')}
        style={{ translate: `0 ${translate}` }}
        className={`pointer-events-auto absolute inset-x-0 top-0 flex h-full flex-col rounded-t-2xl bg-canvas shadow-[0_-4px_20px_rgba(0,0,0,0.12)] ${
          dragPx != null ? '' : 'transition-[translate] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]'
        }`}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={snap !== 'peek'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setDragPx(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setSnap((current) => SNAPS[Math.min(SNAPS.indexOf(current) + 1, SNAPS.length - 1)]);
            }
          }}
          className="flex shrink-0 touch-none select-none flex-col items-center px-4 pb-3 pt-2"
          style={{ height: PEEK_PX }}
        >
          <span aria-hidden="true" className="mb-2 h-1 w-10 rounded-full bg-ink-25" />
          <div className="flex w-full items-center justify-between gap-3">
            <span className="u-tabular text-[0.9375rem] font-semibold text-ink">{label}</span>
            {snap === 'peek' ? (
              <span className="flex items-center gap-1 text-[0.8125rem] font-medium text-blue-deep">
                <List strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                {t('listings.map.sheetShow')}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                {snap === 'full' ? (
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={openFullList}
                    className="rounded-full px-2.5 py-1 text-[0.8125rem] font-semibold text-blue-deep hover:bg-blue-tint"
                  >
                    {t('listings.map.sheetFullList')}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t('listings.map.sheetLower')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setSnap((current) => SNAPS[Math.max(SNAPS.indexOf(current) - 1, 0)])}
                  className="u-hit relative flex h-8 w-8 items-center justify-center rounded-full text-ink-70 hover:bg-canvas-alt"
                >
                  <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                </button>
              </span>
            )}
          </div>
        </div>
        {/* Only rendered once opened: a peeking sheet costs no card photos. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
          {snap !== 'peek' || dragPx != null ? children : null}
        </div>
      </section>
    </div>
  );
}
