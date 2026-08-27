'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff } from 'lucide-react';
import SafeImage from './SafeImage';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Detail-page gallery: a mosaic (one large frame plus a 2x2 grid of the next
 * four) that opens a full-screen lightbox.
 *
 * Real listings carry 0 to 16 photos, so every count has to work: 0 renders
 * an honest empty frame rather than a broken image, 1-2 fill the width, and
 * anything above 5 surfaces a "voir les N photos" affordance so the rest are
 * reachable.
 *
 * The lightbox is a Radix Dialog (shadcn) — it already owns focus trapping,
 * Escape and scroll locking; only arrow-key paging is added on top. Note it
 * is not wrapped in a motion.div: Radix unmounts the content the moment
 * `open` flips, so a framer-motion exit animation there would never run
 * (see the scope note in lib/motion.js).
 */
export default function PhotoGallery({ images, alt }) {
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

  const mosaic = shots.slice(0, 5);
  const hasGrid = mosaic.length > 1;

  return (
    <>
      <div className="relative">
        <div
          className={`grid h-[22rem] gap-2 overflow-hidden rounded-card sm:h-[26rem] lg:h-[30rem] ${
            hasGrid ? 'grid-cols-1 sm:grid-cols-[1.6fr_1fr]' : 'grid-cols-1'
          }`}
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            aria-label="Agrandir la photo 1"
            className="group relative h-full w-full overflow-hidden bg-canvas-alt"
          >
            <SafeImage
              src={mosaic[0]}
              alt={alt}
              fill
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          </button>

          {hasGrid ? (
            <div className="hidden grid-cols-2 grid-rows-2 gap-2 sm:grid">
              {mosaic.slice(1, 5).map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  onClick={() => setLightboxIndex(i + 1)}
                  aria-label={`Agrandir la photo ${i + 2}`}
                  className="group relative h-full w-full overflow-hidden bg-canvas-alt"
                >
                  <SafeImage
                    src={src}
                    alt=""
                    fill
                    sizes="20vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          className="u-glass-royal absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.8125rem] font-semibold transition-colors hover:bg-[rgba(12,29,80,0.58)]"
        >
          <Expand strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          <span className="u-tabular">{total}</span> photo{total !== 1 ? 's' : ''}
        </button>
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
