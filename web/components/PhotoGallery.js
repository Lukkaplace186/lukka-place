'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff } from 'lucide-react';
import SafeImage from './SafeImage';
import CardImageCarousel from './CardImageCarousel';
import { Badge } from './ListingBadges';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

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
 * (see the scope note in lib/motion.js).
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
export default function PhotoGallery({ images, alt }) {
  const shots = images || [];
  const total = shots.length;
  const [mobileIndex, setMobileIndex] = useState(0);

  const [lightboxIndex, setLightboxIndex] = useState(null);
  const isOpen = lightboxIndex !== null;

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
      <div className="flex aspect-16/9 w-full flex-col items-center justify-center gap-2 rounded-card border border-line bg-canvas-alt text-ink-25">
        <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" />
        <p className="text-[0.8125rem]">Aucune photo pour cette annonce</p>
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
          Hidden at sm+, where the desktop mosaic below takes over. */}
      <div className="relative sm:hidden">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setLightboxIndex(mobileIndex)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setLightboxIndex(mobileIndex);
          }}
          aria-label={`Agrandir la photo ${mobileIndex + 1}`}
          className="h-[22rem] w-full cursor-pointer overflow-hidden rounded-xl bg-canvas-deep"
        >
          <CardImageCarousel images={shots} alt={alt} sizes="100vw" priority onIndexChange={setMobileIndex} />
        </div>

        <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
          <Badge tone="white">Annonce vérifiée</Badge>
        </span>

        {/* Live count, not a static "1/N" — CardImageCarousel already
            reports the on-screen index via onIndexChange, so this can track
            an actual swipe instead of freezing at photo 1. The dot row
            beneath it is CardImageCarousel's own; this badge is additive,
            same composition PropertyCard.js already uses. */}
        <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-semibold">
          {mobileIndex + 1}/{total} photo{total !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="relative hidden sm:block">
        <div
          className={`grid h-[27.5rem] gap-2 lg:h-[30rem] ${
            hasGrid ? 'grid-cols-1 sm:grid-cols-[2fr_1fr]' : 'grid-cols-1'
          }`}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            aria-label="Agrandir la photo 1"
            className="group relative h-full w-full overflow-hidden rounded-md bg-canvas-deep"
          >
            <SafeImage
              src={mosaic[0]}
              alt={alt}
              fill
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />

            {/* Real: every listing reaching this page has already passed
                the approve_status=1 moderation gate (lib/listings.js). The
                "Nouveau" badge that used to sit beside this (from
                created_at, same 14-day window the cards used) is gone
                entirely on an explicit instruction — see ListingBadges.js's
                CardBadges, where the matching card-grid badge was removed
                the same way. */}
            <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
              <Badge tone="white">Annonce vérifiée</Badge>
            </span>

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
                    aria-label={`Agrandir la photo ${i + 2}`}
                    className="group relative h-full w-full overflow-hidden rounded-md bg-canvas-deep"
                  >
                    <SafeImage
                      src={src}
                      alt=""
                      fill
                      sizes="30vw"
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
                        Toutes les photos
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
                  aria-label="Photo précédente"
                  className="u-glass-white absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-white/95"
                >
                  <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label="Photo suivante"
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
