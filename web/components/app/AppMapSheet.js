'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronUp, List } from 'lucide-react';
import AppSavedRow from './AppSavedRow';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/** How many homes the sheet lists itself; the rest are one tap away in the list. */
export const MAP_SHEET_ROWS = 12;

/**
 * The app's result sheet on the phone map (the owner's app design,
 * 2026-11-13), in place of the website's "Voir N biens / Liste" pills.
 *
 * Closed, it is one line over the bottom of the map: how many homes are on
 * screen ("dans votre zone" when a zone is drawn) and "Liste". Opened (a tap
 * or a swipe up on that line), it lists the first homes as compact rows; each
 * row opens its listing. It floats above Google's logo and attribution line,
 * which must stay visible.
 *
 * `ids` are the map's own (the pins on screen, already narrowed to the zone),
 * so the sheet can never show a home the map does not. Their rows are read
 * through /api/listings?ids=, the same public read the saved screen uses, and
 * only once the sheet is opened: a closed sheet costs no data.
 */
export default function AppMapSheet({ ids = [], zone = false }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState({ key: null, data: [], failed: false });
  const swipeRef = useRef(null);
  const shown = ids.slice(0, MAP_SHEET_ROWS);
  const key = shown.join(',');
  const count = ids.length;

  // Nothing on screen: nothing to open.
  useEffect(() => {
    if (!count) setOpen(false);
  }, [count]);

  useEffect(() => {
    if (!open || !key || rows.key === key) return undefined;
    let live = true;
    fetch(`/api/listings?ids=${encodeURIComponent(key)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        if (!live) return;
        const byId = new Map((body.data || []).map((listing) => [String(listing.id), listing]));
        // The map's own order, and only homes the read still returns.
        setRows({ key, data: key.split(',').map((id) => byId.get(id)).filter(Boolean), failed: false });
      })
      .catch(() => live && setRows({ key, data: [], failed: true }));
    return () => {
      live = false;
    };
  }, [open, key, rows.key]);

  function toList() {
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete('view');
    const s = qs.toString();
    router.push(s ? `/listings?${s}` : '/listings');
  }

  const loading = open && Boolean(key) && rows.key !== key;
  const title = t(zone ? 'appShell.map.inZone' : 'appShell.map.onMap', { count });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-7 z-30 px-2.5 lg:hidden">
      <section
        aria-label={title}
        className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-md)] transition-[max-height] duration-300 ease-out ${
          open ? 'max-h-[62dvh]' : 'max-h-[3.75rem]'
        }`}
      >
        <div
          className="flex h-[3.75rem] flex-none items-center gap-1 pl-2 pr-1.5"
          onPointerDown={(event) => {
            swipeRef.current = event.clientY;
          }}
          onPointerUp={(event) => {
            const start = swipeRef.current;
            swipeRef.current = null;
            if (start == null) return;
            if (start - event.clientY > 24 && count) setOpen(true);
            else if (event.clientY - start > 24) setOpen(false);
          }}
        >
          <button
            type="button"
            onClick={() => count && setOpen((value) => !value)}
            disabled={!count}
            aria-expanded={open}
            className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue-tint text-blue-deep" aria-hidden="true">
              <ChevronUp strokeWidth={ICON_STROKE_WIDTH} className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
            </span>
            <span aria-live="polite" className="u-tabular truncate text-[1rem] font-bold text-ink">
              {title}
            </span>
          </button>
          <button
            type="button"
            onClick={toList}
            className="u-press flex h-11 flex-none items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold text-blue-deep"
          >
            <List strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('appShell.map.list')}
          </button>
        </div>

        {open ? (
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain bg-canvas-alt px-2.5 pb-3 pt-2.5">
            {loading ? (
              <>
                <Skeleton className="h-24 w-full rounded-card bg-surface" />
                <Skeleton className="h-24 w-full rounded-card bg-surface" />
              </>
            ) : null}
            {!loading && rows.failed ? <p className="px-2 py-3 text-[0.875rem] text-ink-70">{t('appShell.map.failed')}</p> : null}
            {!loading ? rows.data.map((listing) => <AppSavedRow key={listing.id} listing={listing} />) : null}
            {!loading && count > rows.data.length ? (
              <button type="button" onClick={toList} className="u-press flex h-11 w-full items-center justify-center rounded-xl text-[0.875rem] font-semibold text-blue-deep">
                {t('appShell.map.seeAll', { count })}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
