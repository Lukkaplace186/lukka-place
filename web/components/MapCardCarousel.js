'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, Wallet, X } from 'lucide-react';
import CardImageCarousel from './CardImageCarousel';
import Price from './Price';
import FavoriteButton from './FavoriteButton';
import { listingImages, specItems, typeLabel, feedLocationLine, entryChipLabel } from '@/lib/listingView';
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
 * settles in the middle lights up its pin and glides the map to it
 * (`onSettle` → ListingsMap's reveal). Tapping another pin scrolls the row to
 * its card. × or a tap on the bare map closes it.
 *
 * Two swipe zones, on purpose: the PHOTO swipes through that listing's
 * pictures (MapCard below), the price and details swipe between listings.
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
  // True once the visitor has touched the row since the last pin tap.
  const userRef = useRef(false);
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

  // A pin tap: bring its card to the middle. Only a swipe the visitor makes
  // may pick a card: a scroll this component starts, or one caused by the
  // row being rebuilt for a new set of pins, is never read as a choice. (Both
  // happened in the first versions: a tap on "$1k" stopped on the "$800" it
  // glided past, and a rebuilt row settled on whatever card sat in the
  // middle.)
  useEffect(() => {
    userRef.current = false;
    const card = cardRefs.current.get(String(selectedId));
    const scroller = scrollerRef.current;
    if (!card || !scroller) return;
    const left = card.offsetLeft - (scroller.clientWidth - card.clientWidth) / 2;
    if (Math.abs(scroller.scrollLeft - left) < 4) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  }, [selectedId, listings]);

  // A swipe: once the row the visitor touched has been still for a moment,
  // the card nearest the middle is the chosen one.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let timer;
    const touched = () => {
      userRef.current = true;
    };
    const settle = () => {
      if (!userRef.current) return;
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
    scroller.addEventListener('pointerdown', touched, { passive: true });
    scroller.addEventListener('touchstart', touched, { passive: true });
    scroller.addEventListener('wheel', touched, { passive: true });
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener('pointerdown', touched);
      scroller.removeEventListener('touchstart', touched);
      scroller.removeEventListener('wheel', touched);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [onSettle]);

  const byId = useMemo(() => new Map(listings.map((row) => [String(row.id), row])), [listings]);
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);

  return (
    // Clear of Google's logo and attribution line at the map's bottom edge.
    <div className="u-rise pointer-events-none absolute inset-x-0 bottom-8 z-30" role="region" aria-label={t('listings.map.cardsLabel')}>
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
          return (
            <MapCard
              key={id}
              listing={listing}
              active={id === String(selectedId)}
              near={near}
              cardRef={(node) => {
                if (node) cardRefs.current.set(id, node);
                else cardRefs.current.delete(id);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One card: the listing's photos on top, swipeable (CardImageCarousel — the
 * same snap strip as the list cards, with `overscroll-behavior-x: contain`,
 * so a swipe on the photo turns the photo and never throws the row to the
 * next listing; the price and details below are where a swipe changes
 * listing). The strip mounts photos lazily, so a card costs one photo until
 * someone swipes it.
 */
function MapCard({ listing, active, near, cardRef }) {
  const t = useT();
  const [photoIndex, setPhotoIndex] = useState(0);
  const id = String(listing.id);
  const href = `/listings/${encodeURIComponent(id)}`;
  const images = listingImages(listing);
  const specs = specItems(listing, t).slice(0, 2);
  const km = near?.point ? listingDistanceKm(listing, near.point) : null;
  const entry = entryChipLabel(listing, t);

  return (
    <article
      data-id={id}
      ref={cardRef}
      className={`u-lift relative flex w-[84vw] max-w-sm shrink-0 snap-center flex-col overflow-hidden rounded-2xl bg-surface transition-shadow ${
        active ? 'ring-2 ring-blue' : ''
      }`}
    >
      <div className="relative h-36 w-full shrink-0 overflow-hidden bg-canvas-deep">
        <Link href={href} className="absolute inset-0 block" aria-label={listing.title || t('listings.map.viewDetails')}>
          {images.length > 0 ? (
            <CardImageCarousel images={images} alt={listing.title || ''} sizes="(min-width: 640px) 24rem, 84vw" onIndexChange={setPhotoIndex} />
          ) : null}
        </Link>
        {images.length > 1 ? (
          <span className="u-glass-royal u-tabular pointer-events-none absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold">
            <Camera strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />
            {photoIndex + 1}/{images.length}
          </span>
        ) : null}
        <div className="absolute right-2 top-2 z-10">
          <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} />
        </div>
      </div>
      <Link href={href} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
        <span className="u-tabular truncate text-[1.0625rem] font-semibold leading-tight text-ink">
          <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} currency={listing.currency} priceOriginal={listing.price_original} />
        </span>
        <span className="truncate text-[0.8125rem] text-ink-70">
          {[typeLabel(listing, t), ...specs.map((spec) => `${spec.value} ${spec.label}`), feedLocationLine(listing)].filter(Boolean).join(' · ')}
        </span>
        {/* What is due on entry, as on the feed card (2026-10-06). */}
        {entry ? (
          <span className="mt-0.5 inline-flex max-w-full items-center gap-1 self-start truncate rounded-full bg-warning-tint px-2 py-0.5 text-[0.6875rem] font-bold text-warning-ink">
            <Wallet strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3 shrink-0" aria-hidden="true" />
            {entry}
          </span>
        ) : null}
        {Number.isFinite(km) ? (
          <span className="truncate text-[0.75rem] font-semibold text-blue-deep">
            {t('listings.results.distanceFrom', { distance: formatDistance(km), place: near.label })}
          </span>
        ) : null}
      </Link>
    </article>
  );
}
