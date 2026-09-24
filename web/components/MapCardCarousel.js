'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import SafeImage from './SafeImage';
import Price from './Price';
import FavoriteButton from './FavoriteButton';
import { listingImages, specItems, typeLabel, feedLocationLine } from '@/lib/listingView';
import { formatDistance, listingDistanceKm } from '@/lib/landmarks';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/** Listing details per tab, by id — a swipe back never refetches. */
const detailCache = new Map();
const FETCH_BATCH = 20;

async function loadListings(ids) {
  const missing = ids.filter((id) => !detailCache.has(id));
  for (let i = 0; i < missing.length; i += FETCH_BATCH) {
    const batch = missing.slice(i, i + FETCH_BATCH);
    const response = await fetch(`/api/listings?ids=${batch.map(encodeURIComponent).join(',')}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    const found = new Map((body.data || []).map((row) => [String(row.id), row]));
    // An id the API no longer returns was unpublished since the pins were
    // fetched: remembered as null, so it is skipped rather than re-asked.
    for (const id of batch) detailCache.set(id, found.get(id) || null);
  }
  return ids.map((id) => detailCache.get(id)).filter(Boolean);
}

/**
 * The phone map's swipeable cards (Airbnb / Zillow pattern). Tapping a pin
 * opens this row with that listing's card centred; swiping left and right
 * walks through every listing in view, west to east, and each card that
 * settles in the middle lights up its pin (`onSettle`). Tapping another pin
 * scrolls the row to its card. × or a tap on the bare map closes it.
 *
 * `ids` is a snapshot the caller takes when the row opens, so cards never
 * reorder under a thumb while the map pans to reveal a pin. Details come from
 * the same public-gated /api/listings?ids= the preview card used, 20 at a
 * time, cached for the tab; photos load lazily as cards approach the screen.
 *
 * `near` — `{ label, point }` of a searched landmark — adds "à 1,2 km de UPN"
 * from the listing's own stored point, never from a commune centroid.
 */
export default function MapCardCarousel({ ids, selectedId, onSettle, onClose, near = null }) {
  const t = useT();
  const scrollerRef = useRef(null);
  const cardRefs = useRef(new Map());
  const programmaticRef = useRef(false);
  const [listings, setListings] = useState(() => ids.map((id) => detailCache.get(id)).filter(Boolean));
  const [failed, setFailed] = useState(false);
  const idsKey = ids.join(',');

  useEffect(() => {
    let cancelled = false;
    loadListings(ids)
      .then((rows) => {
        if (!cancelled) setListings(rows);
      })
      .catch((err) => {
        console.error('[MapCardCarousel] could not load listings', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `ids` is represented by idsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // A pin tap: bring its card to the middle. Scrolls this component starts
  // itself are marked, so the cards it glides past are never read as swipes
  // (the first version did, and a tap on "$1k" stopped on the "$800" it
  // passed on the way).
  useEffect(() => {
    const card = cardRefs.current.get(String(selectedId));
    const scroller = scrollerRef.current;
    if (!card || !scroller) return undefined;
    const left = card.offsetLeft - (scroller.clientWidth - card.clientWidth) / 2;
    if (Math.abs(scroller.scrollLeft - left) < 4) return undefined;
    programmaticRef.current = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
    // Safety net for a scroll that never fires (already in place).
    const timer = setTimeout(() => {
      programmaticRef.current = false;
    }, 1500);
    return () => clearTimeout(timer);
  }, [selectedId, listings]);

  // A swipe: once the row has been still for a moment, the card nearest the
  // middle is the chosen one — never a card merely passed over.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let timer;
    const settle = () => {
      if (programmaticRef.current) {
        programmaticRef.current = false;
        return;
      }
      const centre = scroller.scrollLeft + scroller.clientWidth / 2;
      let best = null;
      let bestDistance = Infinity;
      for (const [id, card] of cardRefs.current) {
        const distance = Math.abs(card.offsetLeft + card.clientWidth / 2 - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = id;
        }
      }
      if (best) onSettle?.(best);
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 140);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [onSettle]);

  const byId = useMemo(() => new Map(listings.map((row) => [String(row.id), row])), [listings]);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  return (
    <div className="u-rise pointer-events-none absolute inset-x-0 bottom-3 z-30" role="region" aria-label={t('listings.map.cardsLabel')}>
      <div className="pointer-events-auto mb-2 flex justify-end px-3">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('listings.map.closePreview')}
          className="u-press u-lift flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink"
        >
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={scrollerRef}
        className="no-scrollbar pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-[8vw] px-[8vw] pb-1"
      >
        {ordered.length === 0 ? (
          <div className="u-lift w-[84vw] max-w-sm shrink-0 snap-center rounded-2xl bg-surface p-4 text-[0.8125rem] text-ink-45">
            {failed ? t('listings.map.fetchError') : t('listings.map.loading')}
          </div>
        ) : null}
        {ordered.map((listing) => {
          const id = String(listing.id);
          const href = `/listings/${encodeURIComponent(id)}`;
          const [photo] = listingImages(listing);
          const specs = specItems(listing, t).slice(0, 2);
          const km = near?.point ? listingDistanceKm(listing, near.point) : null;
          const active = id === String(selectedId);
          return (
            <article
              key={id}
              data-id={id}
              ref={(node) => {
                if (node) cardRefs.current.set(id, node);
                else cardRefs.current.delete(id);
              }}
              className={`u-lift relative flex w-[84vw] max-w-sm shrink-0 snap-center overflow-hidden rounded-2xl bg-surface transition-shadow ${
                active ? 'ring-2 ring-blue' : ''
              }`}
            >
              <Link href={href} className="relative block h-28 w-28 shrink-0 bg-canvas-deep">
                {photo ? (
                  <SafeImage src={photo} alt={listing.title || ''} fill sizes="112px" className="object-cover" loading="lazy" />
                ) : null}
              </Link>
              <Link href={href} className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2.5 pl-3 pr-11">
                <span className="u-tabular truncate text-[1.0625rem] font-semibold leading-tight text-ink">
                  <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} currency={listing.currency} priceOriginal={listing.price_original} />
                </span>
                <span className="truncate text-[0.8125rem] text-ink-70">
                  {[typeLabel(listing, t), ...specs.map((spec) => `${spec.value} ${spec.label}`)].filter(Boolean).join(' · ')}
                </span>
                <span className="truncate text-[0.8125rem] text-ink-45">{feedLocationLine(listing)}</span>
                {Number.isFinite(km) ? (
                  <span className="truncate text-[0.75rem] font-semibold text-blue-deep">
                    {t('listings.results.distanceFrom', { distance: formatDistance(km), place: near.label })}
                  </span>
                ) : null}
              </Link>
              <div className="absolute right-1.5 top-1.5">
                <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
