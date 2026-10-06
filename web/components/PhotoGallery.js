'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff, LayoutGrid } from 'lucide-react';
import SafeImage from './SafeImage';
import CardImageCarousel from './CardImageCarousel';
import { Badge } from './ListingBadges';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { listingEventPayload, trackEvent } from '@/lib/analyticsClient';
import { initialGalleryState, noteGalleryStep } from '@/lib/galleryEngagement';

/**
 * Detail-page gallery: web/Design's 2fr/1fr three-tile grid (one tall lead
 * photo spanning two rows, two stacked beside it) that opens a full-screen
 * lightbox.
 *
 * Real listings carry 0 to 16 photos, so every count has to work: 0 renders
 * an honest empty frame rather than a broken image, 1-2 fill the width, and
 * anything above 3 surfaces the design's "Toutes les photos" affordance on
 * the last tile so the rest are
 * reachable.
 *
 * The lightbox is a Radix Dialog (shadcn) — it already owns focus trapping,
 * Escape and scroll locking; only arrow-key paging is added on top. Note it
 * is not wrapped in a motion.div: Radix unmounts the content the moment
 * `open` flips, so a framer-motion exit animation there would never run
 * (Radix animates it through data-state and tw-animate-css instead).
 *
 * Below `sm`, the mosaic's side tiles were already hidden (no room for
 * them), which left mobile with a single static lead photo you had to tap
 * into the lightbox just to see photo 2 — no on-page swiping. That slot now
 * renders CardImageCarousel instead: the exact same real snap-scroll
 * carousel every listing card already uses (finger-swipeable, sliding-window
 * pagination dots, and lazy-loads only the current photo plus its immediate
 * neighbours rather than the whole gallery — see that component's own doc
 * comment). Reused rather than reimplemented so mobile's swipe feel is
 * identical everywhere it appears, and so this doesn't grow a second lazy-
 * loading strategy to keep in sync with the first. Desktop's mosaic grid is
 * untouched — this only replaces the collapsed single-tile mobile case.
 * Tapping the carousel (a real tap, not a drag — see CardImageCarousel's own
 * note on why a swipe gesture never fires a synthetic click) opens the same
 * lightbox, at whichever photo is actually on screen rather than always
 * photo 1.
 */
/**
 * `verifiedAt` is `properties.verified_at`. The "Annonce vérifiée" badge on the
 * photo renders only when it is set — the rule ListingBadges' VerifiedBadge
 * states: moderation (approve_status) says a listing was fit to publish, not
 * that anyone checked the property. It used to render on every listing, so
 * 46 of 46 live listings claimed a verification none of them had.
 *
 * `eventListing` ({ id, price, commune }) turns on the two gallery steps of
 * the listing funnel — `gallery_open` and `gallery_complete`, once each per
 * page view (rules in lib/galleryEngagement.js). This is what lets a landlord
 * report say how many people went through the photos, not just opened the
 * page. Without it the gallery records nothing.
 */
export default function PhotoGallery({ images, alt, mobileActions = null, verifiedAt = null, eventListing = null }) {
  const t = useT();
  const shots = images || [];
  const total = shots.length;
  const [mobileIndex, setMobileIndex] = useState(0);

  const [lightboxIndex, setLightboxIndex] = useState(null);
  const isOpen = lightboxIndex !== null;
  // Phone only: every photo as a scrollable grid (2026-10-06). A swipe
  // through 13 photos one at a time is how a visitor gives up at photo 4;
  // the grid shows the whole set and a tap opens the lightbox there.
  const [gridOpen, setGridOpen] = useState(false);

  // A ref, not state: counting what the visitor has seen must never re-render
  // the gallery, and each event must leave exactly once per mount.
  const engagement = useRef(initialGalleryState());
  const noteSeen = useCallback(
    (index, engaged) => {
      if (!eventListing?.id) return;
      const { state, events } = noteGalleryStep(engagement.current, { index, total, engaged });
      engagement.current = state;
      for (const event of events) trackEvent(event, listingEventPayload(eventListing));
    },
    [eventListing, total],
  );

  const onMobileIndexChange = useCallback(
    (index) => {
      setMobileIndex(index);
      noteSeen(index, false);
    },
    [noteSeen],
  );

  useEffect(() => {
    if (lightboxIndex !== null) noteSeen(lightboxIndex, true);
  }, [lightboxIndex, noteSeen]);

  const step = useCallback(
    (delta) => {
      setLightboxIndex((current) => {
        if (current === null || total === 0) return current;
        return (current + delta + total) % total;
      });
    },
    [total],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    function onKey(e) {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, step]);

  if (total === 0) {
    return (
      <div className="relative flex aspect-16/9 w-full flex-col items-center justify-center gap-2 rounded-card border border-line bg-canvas-alt text-ink-25 max-sm:mt-4">
        <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" />
        <p className="text-[0.8125rem]">{t('listings.gallery.noPhotos')}</p>
        {mobileActions ? (
          <span className="absolute right-3 top-3 z-10 flex gap-2 sm:hidden">{mobileActions}</span>
        ) : null}
      </div>
    );
  }

  // Rightmove-style desktop gallery, per an explicit instruction: a fixed
  // h-[27.5rem]/lg:h-[30rem] (440px/480px) band rather than the previous
  // grid-rows-[13rem_13rem] (which only summed to 416px and didn't scale up
  // at lg), tight gap-2 (8px, was gap-3/12px), and sleek rounded-md corners
  // (was rounded-xl) on every tile. A 2fr/1fr split — one tall lead photo,
  // two stacked beside it. Three tiles, not the five-tile 1-large-plus-2x2
  // mosaic this previously rendered.
  //
  // The outer frame (both this desktop grid and the mobile carousel above)
  // carries a real `.u-lift` drop shadow plus a `border-line` hairline, per
  // an explicit instruction matching a real Rightmove screenshot — a
  // deliberate, scoped departure from this app's usual `.u-card` convention
  // ("cards use hairlines instead of shadows," web/CLAUDE.md's design
  // system notes). The photo block is meant to read as a genuinely floating
  // hero element here, the same "real elevation" `.u-lift` already exists
  // for (app/globals.css) — not a card among other cards.
  const mosaic = shots.slice(0, 3);
  const hasGrid = mosaic.length > 1;
  // Exactly one side photo (total === 2) is a real, common case — most
  // listings here carry only a couple of WhatsApp-submitted photos. The
  // side column used to always be a `grid-rows-2` pair regardless of how
  // many side tiles it actually had: with only one, the second row track
  // still reserved its full height with nothing in it, showing as dead
  // white space next to the lead photo rather than the single side tile
  // filling the column. `sideShots.length` (1 or 2) now drives which
  // layout the column renders instead of hardcoding two rows.
  const sideShots = mosaic.slice(1, 3);

  return (
    <>
      {/* Mobile only — real swipeable carousel (see doc comment above).
          Hidden at sm+, where the desktop mosaic below takes over. Edge to
          edge (-mx-4 cancels the page gutter), the way every app shows a
          product photo on a phone; `mobileActions` (Partager/Enregistrer)
          sit on the photo instead of on a row of their own above it. */}
      <div className="relative -mx-4 sm:hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setLightboxIndex(mobileIndex)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setLightboxIndex(mobileIndex);
          }}
          aria-label={t('listings.gallery.enlargePhoto', { n: mobileIndex + 1 })}
          className="h-[22rem] w-full cursor-pointer overflow-hidden bg-canvas-deep"
        >
          <CardImageCarousel images={shots} alt={alt} sizes="100vw" priority onIndexChange={onMobileIndexChange} />
        </div>

        {verifiedAt ? (
          <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
            <Badge tone="white">{t('listings.gallery.verified')}</Badge>
          </span>
        ) : null}

        {/* Live count, not a static "1/N" — CardImageCarousel already
            reports the on-screen index via onIndexChange, so this can track
            an actual swipe instead of freezing at photo 1. The dot row
            beneath it is CardImageCarousel's own; this badge is additive,
            same composition PropertyCard.js already uses. */}
        <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-semibold">
          {mobileIndex + 1}/{total} photo{total !== 1 ? 's' : ''}
        </span>

        {mobileActions ? (
          <span className="absolute right-3.5 top-3.5 z-10 flex gap-2">{mobileActions}</span>
        ) : null}

        {total > 2 ? (
          <button
            type="button"
            onClick={() => setGridOpen(true)}
            className="u-press absolute bottom-3.5 left-3.5 z-10 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3.5 text-[0.8125rem] font-bold text-ink shadow-sm"
          >
            <LayoutGrid strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('listings.gallery.seeAllCount', { count: total })}
          </button>
        ) : null}
      </div>

      <Dialog open={gridOpen} onOpenChange={setGridOpen}>
        <DialogContent showCloseButton className="max-h-[78dvh] max-w-[min(96vw,40rem)] gap-0 overflow-y-auto p-3 sm:hidden">
          <DialogTitle className="px-1 pb-3 pt-1 text-[1.0625rem] font-bold text-ink">
            {t('listings.gallery.seeAllCount', { count: total })}
          </DialogTitle>
          <div className="grid grid-cols-2 gap-1.5">
            {shots.map((src, index) => (
              <button
                key={`${src}-${index}`}
                type="button"
                onClick={() => {
                  setGridOpen(false);
                  setLightboxIndex(index);
                }}
                aria-label={t('listings.gallery.enlargePhoto', { n: index + 1 })}
                className={`relative overflow-hidden rounded-lg bg-canvas-deep ${index === 0 ? 'col-span-2 h-52' : 'h-32'}`}
              >
                <SafeImage src={src} alt="" fill sizes={index === 0 ? '96vw' : '48vw'} className="object-cover" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative hidden sm:block">
        <div
          className={`u-lift grid h-[27.5rem] gap-2 rounded-xl border border-line lg:h-[30rem] ${
            hasGrid ? 'grid-cols-1 sm:grid-cols-[2fr_1fr]' : 'grid-cols-1'
          }`}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            aria-label={t('listings.gallery.enlargePhoto', { n: 1 })}
            className="group relative h-full w-full overflow-hidden rounded-md bg-canvas-deep"
          >
            <SafeImage
              src={mosaic[0]}
              alt={alt}
              fill
              priority
              sizes="(min-width: 1280px) 830px, (min-width: 1024px) 64vw, 100vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />

            {/* Only on a real verified_at — see the component's doc comment. */}
            {verifiedAt ? (
              <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
                <Badge tone="white">{t('listings.gallery.verified')}</Badge>
              </span>
            ) : null}

            <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-semibold">
              1/{total} photo{total !== 1 ? 's' : ''}
            </span>
          </button>

          {hasGrid ? (
            // h-full: the parent grid now carries a fixed height directly
            // (h-[27.5rem]/lg:h-[30rem]) rather than two 13rem row tracks,
            // so this column just needs to fill that single row — no
            // row-span needed anymore now that there's only one row to span.
            <div className={`hidden h-full gap-2 sm:grid ${sideShots.length > 1 ? 'grid-rows-2' : 'grid-rows-1'}`}>
              {sideShots.map((src, i) => {
                const isLastTile = i === sideShots.length - 1;
                return (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    onClick={() => setLightboxIndex(i + 1)}
                    aria-label={t('listings.gallery.enlargePhoto', { n: i + 2 })}
                    className="group relative h-full w-full overflow-hidden rounded-md bg-canvas-deep"
                  >
                    <SafeImage
                      src={src}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 410px, (min-width: 1024px) 32vw, 50vw"
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                    />
                    {/* "Toutes les photos" sits on the last rendered tile,
                        whenever the mosaic isn't showing every photo —
                        `total > mosaic.length`, not a hardcoded `> 3`
                        (which assumed the side column always has two
                        tiles). */}
                    {isLastTile && total > mosaic.length ? (
                      <span className="u-glass-royal absolute bottom-3.5 right-3.5 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[0.8125rem] font-semibold">
                        <Expand strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        {t('listings.gallery.allPhotos')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={(next) => !next && setLightboxIndex(null)}>
        <DialogContent
          showCloseButton
          className="max-w-[min(96vw,80rem)] gap-0 border-none bg-ink/95 p-0 sm:max-w-[min(96vw,80rem)]"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>

          <div className="relative flex h-[80vh] w-full items-center justify-center">
            {isOpen ? (
              <SafeImage
                src={shots[lightboxIndex]}
                alt={alt}
                fill
                sizes="96vw"
                className="object-contain"
              />
            ) : null}

            {total > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={t('listings.gallery.previousPhoto')}
                  className="u-glass-white absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-white/95"
                >
                  <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t('listings.gallery.nextPhoto')}
                  className="u-glass-white absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-white/95"
                >
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                </button>
                <span className="u-glass-royal u-tabular absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-[0.75rem] font-medium">
                  {lightboxIndex + 1} / {total}
                </span>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
