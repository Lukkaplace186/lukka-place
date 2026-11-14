'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { pageForCursor } from '@/lib/listingsFeedCursor';

/**
 * The endless /listings feed (lib/listingsFeed.js has the rules): the
 * server-rendered first batch, then the next ones from GET /api/listings/feed
 * as the visitor nears the bottom. The exact results come first; nearby ones
 * follow under their own heading and never mix into them.
 *
 * - The bottom of the list is watched 1,200px early, so on a phone the next
 *   cards are usually there before the thumb gets to them. Nothing loads in
 *   phone map view: the list is hidden, so its bottom never comes into view.
 * - "Voir plus" under the list is a real link to the next ?page= for a
 *   crawler or a browser without JavaScript; with JavaScript it loads in place.
 * - Back from a listing: the batches loaded so far and the scroll position are
 *   kept for this search in sessionStorage and put back, so the visitor lands
 *   where they left instead of on card 1 (RESTORE_WINDOW_MS below).
 *
 * Parents key this component on the search, so a new search starts over.
 */
const STORE_KEY = 'lukka-listings-feed';
const MORE_BUTTON =
  'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-[0.8125rem] font-semibold text-ink hover:border-blue hover:text-blue-deep';

/** How far below the screen the next batch is asked for (about 2 cards on a phone). */
const LOAD_AHEAD_PX = 1200;

/** The most cards a restored feed brings back — about 10 batches. */
const RESTORE_MAX = 120;

/**
 * A stored feed is put back only when the visitor left it by tapping one of
 * its cards (`leftAt`), for the same search, within this window. Back is the
 * usual way home; the router's own popstate handling is not observable from
 * here, so the tap is the signal. The mark is cleared once used.
 */
const RESTORE_WINDOW_MS = 30 * 60 * 1000;

function readStore() {
  try {
    return JSON.parse(window.sessionStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeStore(value) {
  try {
    window.sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or a full store: the feed works, only the restore is lost.
  }
}

/** `list` plus the rows of `rows` it does not hold yet (pure: safe in a state updater). */
function uniqueAppend(list, rows) {
  const seen = new Set(list.map((row) => row.id));
  const out = [...list];
  for (const row of rows || []) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export default function ListingsFeed({
  feedKey,
  queryString,
  initialListings,
  initialSimilar = null,
  initialNext = null,
  place = null,
  renderCard,
}) {
  const t = useT();
  const [more, setMore] = useState([]);
  const [similar, setSimilar] = useState(initialSimilar?.listings || []);
  const [places, setPlaces] = useState(initialSimilar?.places || []);
  const [next, setNext] = useState(initialNext);
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const sentinelRef = useRef(null);
  const inFlightRef = useRef(false);
  const saveRef = useRef(null);

  // Back from a listing: put the loaded batches and the scroll position back.
  // The cards are put back in a timer after hydration, and the scroll waits a
  // little longer for them to be laid out.
  useEffect(() => {
    const stored = readStore();
    if (!stored || stored.key !== feedKey || !(Date.now() - (stored.leftAt || 0) < RESTORE_WINDOW_MS)) return undefined;
    let scrollTimer = 0;
    const timer = window.setTimeout(() => {
      // Used once: the next visit to this search starts at the top.
      writeStore({ ...stored, leftAt: null });
      setMore((list) => uniqueAppend(list, stored.more));
      setSimilar((list) => uniqueAppend(list, stored.similar));
      if (stored.places?.length) setPlaces(stored.places);
      setNext(stored.next ?? null);
      if (Number.isFinite(stored.scrollY)) {
        scrollTimer = window.setTimeout(() => window.scrollTo(0, stored.scrollY), 60);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (scrollTimer) window.clearTimeout(scrollTimer);
    };
  }, [feedKey]);

  // Keep the store in step with what is on screen, and where the visitor is.
  useEffect(() => {
    if (more.length === 0 && similar.length === (initialSimilar?.listings?.length || 0)) return undefined;
    const save = (leftAt = null) =>
      writeStore({
        key: feedKey,
        more: more.slice(0, RESTORE_MAX),
        similar: similar.slice(0, RESTORE_MAX),
        places,
        next: more.length + similar.length > RESTORE_MAX ? null : next,
        scrollY: window.scrollY,
        leftAt,
      });
    save();
    // A tap in the feed (a card, its photo, its buttons) saves at once with
    // the "left from here" mark: the scroll timer may not have run yet.
    saveRef.current = () => save(Date.now());
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.setTimeout(() => {
        frame = 0;
        save();
      }, 400);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.clearTimeout(frame);
    };
  }, [feedKey, more, similar, places, next, initialSimilar]);

  const loadMore = useCallback(async () => {
    if (!next || inFlightRef.current) return;
    inFlightRef.current = true;
    setStatus('loading');
    try {
      const res = await fetch(`/api/listings/feed?${queryString}${queryString ? '&' : ''}cursor=${encodeURIComponent(next)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = await res.json();
      if (batch.listings?.length) setMore((list) => uniqueAppend(list, batch.listings));
      if (batch.similar?.listings?.length) {
        setSimilar((list) => uniqueAppend(list, batch.similar.listings));
        if (batch.similar.places?.length) setPlaces((current) => (current.length ? current : batch.similar.places));
      }
      setNext(batch.next || null);
      setStatus('idle');
    } catch {
      setStatus('error');
    } finally {
      inFlightRef.current = false;
    }
  }, [next, queryString]);

  // Watch the bottom of the list. Re-observed after every batch, so a batch
  // too short to fill the screen still leads to the next one.
  // A scroll-position check runs beside the observer: older Android browsers
  // have no IntersectionObserver, and the check costs one rect read per
  // 200 ms of scrolling.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !next || status !== 'idle') return undefined;
    const near = () => el.offsetParent !== null && el.getBoundingClientRect().top < window.innerHeight + LOAD_AHEAD_PX;
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMore();
        },
        { rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
      );
      observer.observe(el);
    }
    let timer = 0;
    const onScroll = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (near()) loadMore();
      }, 200);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (timer) window.clearTimeout(timer);
    };
  }, [next, status, loadMore]);

  // One card per listing, whichever batch brought it: a listing edited
  // between two loads can move across an OFFSET boundary.
  const exact = uniqueAppend(initialListings || [], more);
  const exactIds = new Set(exact.map((l) => l.id));
  const nearby = similar.filter((l) => !exactIds.has(l.id));
  const nextPage = pageForCursor(next);
  const nextHref = nextPage ? `/listings?${queryString}${queryString ? '&' : ''}page=${nextPage}` : null;

  return (
    <div onClickCapture={() => saveRef.current?.()}>
      <div className="u-stagger-in-view flex flex-col gap-5">
        {exact.map((listing, i) => renderCard(listing, i))}
      </div>

      {nearby.length ? (
        <section className="mt-8" aria-labelledby="feed-nearby-title">
          <p id="feed-nearby-title" className="u-eyebrow mb-1">
            {t('listings.results.nearbyExtrasTitle', { place: place || '' })}
          </p>
          {places.length ? (
            <p className="mb-3 text-[0.8125rem] text-ink-45">
              {places.map(({ commune, km }) => `${commune} (${km} km)`).join(', ')}
            </p>
          ) : null}
          <div className="flex flex-col gap-5">
            {nearby.map((listing, i) => renderCard(listing, exact.length + i))}
          </div>
        </section>
      ) : null}

      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      {next ? (
        <div className="mt-8 flex justify-center" aria-live="polite">
          {status === 'loading' ? (
            <span className="inline-flex items-center gap-2 text-[0.8125rem] text-ink-45">
              <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('common.actions.seeMore')}…
            </span>
          ) : status === 'error' ? (
            <button type="button" onClick={loadMore} className={MORE_BUTTON}>
              {t('common.actions.retry')}
            </button>
          ) : nextHref ? (
            <a
              href={nextHref}
              onClick={(e) => {
                e.preventDefault();
                loadMore();
              }}
              className={MORE_BUTTON}
            >
              {t('common.actions.seeMore')}
            </a>
          ) : (
            <button type="button" onClick={loadMore} className={MORE_BUTTON}>
              {t('common.actions.seeMore')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
