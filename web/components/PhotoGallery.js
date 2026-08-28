'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff } from 'lucide-react';
import SafeImage from './SafeImage';
import { Badge } from './ListingBadges';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { isNewListing } from '@/lib/listingView';
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
 */
export default function PhotoGallery({ images, alt, createdAt }) {
  const shots = images || [];
  const total = shots.length;

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

  // web/Design's detail gallery: a 2fr/1fr split with two 210px rows — one
  // tall lead photo spanning both rows, and two stacked photos beside it.
  // Three tiles, not the five-tile 1-large-plus-2x2 mosaic this previously
  // rendered. Each tile carries the design's own 12px --radius-image rather
  // than the whole grid being clipped to one rounded rectangle.
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
      <div className="relative">
        <div
          className={`grid gap-3 ${
            hasGrid
              ? 'grid-cols-1 grid-rows-[13rem_13rem] sm:grid-cols-[2fr_1fr]'
              : 'h-[22rem] grid-cols-1 sm:h-[26rem]'
          }`}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            aria-label="Agrandir la photo 1"
            className={`group relative w-full overflow-hidden rounded-xl bg-canvas-deep ${
              hasGrid ? 'row-span-2 h-full' : 'h-full'
            }`}
          >
            <SafeImage
              src={mosaic[0]}
              alt={alt}
              fill
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />

            {/* Badges the design stamps on the lead photo. Both are real:
                every listing reaching this page has already passed the
                approve_status=1 moderation gate (lib/listings.js), and
                "Nouveau" is the same 14-day created_at window the cards
                use. */}
            <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
              <Badge tone="white">Annonce vérifiée</Badge>
              {isNewListing(createdAt) ? <Badge tone="royal">Nouveau</Badge> : null}
            </span>

            <span className="u-glass-royal u-tabular pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-semibold">
              1/{total} photo{total !== 1 ? 's' : ''}
            </span>
          </button>

          {hasGrid ? (
            <div className={`hidden gap-3 sm:grid ${sideShots.length > 1 ? 'grid-rows-2' : 'grid-rows-1'}`}>
              {sideShots.map((src, i) => {
                const isLastTile = i === sideShots.length - 1;
                return (
                  <button
                    key={`${src}-${i}`}
                    type="button"
                    onClick={() => setLightboxIndex(i + 1)}
                    aria-label={`Agrandir la photo ${i + 2}`}
                    className="group relative h-full w-full overflow-hidden rounded-xl bg-canvas-deep"
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
