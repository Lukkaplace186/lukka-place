'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SafeImage from './SafeImage';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useSaveData } from '@/lib/useSaveData';
import { useT } from '@/lib/i18n/client';

const DOT_WINDOW = 5;

/**
 * Compact inline image carousel for a ListingCard's image area — a real
 * horizontal snap-scroll strip (finger-swipeable on touch, matching the
 * Zillow app's card behaviour) with arrow buttons (desktop, hover-revealed)
 * and always-visible pagination dots (the swipe affordance itself — a row
 * of dots is what tells a visitor a photo is draggable, the way a raw
 * "1/15" counter never does). No thumbnail strip here — that's
 * PhotoGallery's job, on the detail page.
 *
 * Past DOT_WINDOW photos, showing every dot individually stops being a
 * clean affordance and starts being visual noise (15 dots in a row on a
 * 260px card), so the dot row becomes a sliding window of DOT_WINDOW dots
 * centred on the current photo instead. The dot at whichever end still has
 * photos beyond it renders visibly smaller — the same "there's more this
 * way" cue iOS/Instagram-style paginators use — rather than pretending a
 * 15-photo gallery only has 5 photos.
 *
 * The exact photo count still exists elsewhere on the card
 * (ListingBadges.js's PhotoCountBadge, bottom-left) — the dot row's job is
 * only to signal "swipeable" and "roughly where you are", not to duplicate
 * that number.
 *
 * The whole card is a <Link>, so the arrow/dot *controls* stop
 * propagation/prevent default — tapping one must browse photos, never
 * navigate away. A swipe on the photo itself needs no such guard: a touch
 * gesture that scrolls the strip is not followed by a synthetic click in
 * any real browser, so it can never trigger the card's navigation. Tapping
 * the photo without dragging still opens the listing, same as every other
 * part of the card — deliberately not suppressed here.
 *
 * TOUCH: the arrows and dots are desktop controls. The arrows used to be
 * `opacity-0` on a phone but still tappable — two invisible 28px targets in
 * the middle of every card photo, so a tap meant to open the listing flipped
 * the photo instead (measured on lukkaplace.com at 375px). They are now
 * `hidden` below `sm` and `pointer-events-none` until the carousel is
 * hovered or an arrow has keyboard focus. The dot row is decorative on a
 * phone (`pointer-events-none` below `sm`): 6px dots are not a target anyone
 * can hit, and the swipe is the real control.
 *
 * `quality` is next/image's default 75. It was 90, which roughly doubled the
 * bytes of every grid photo on mobile data for a difference nobody can see
 * on a phone screen (same photo, measured: 64 KB at w=640 q=90 vs 34 KB at
 * w=750 q=75), and — because PhotoGallery asked for q=75 — made the detail
 * page download a card's cover photo a second time. A subtle
 * contrast/brightness/saturate lift on the image is kept.
 *
 * Only the cover photo (index 0) actually mounts a next/image on first
 * render — a listing can carry 10+ gallery photos, and every one of them
 * used to mount inside this snap-scroller at once (all `flex-shrink-0`,
 * side by side), so a feed of a dozen cards fired a dozen photos' worth of
 * requests each, most for photos nobody ever scrolled to. `loaded` tracks
 * which slide indices are allowed to render their real image; the current
 * index plus its immediate neighbours are added as `index` changes, so the
 * next/previous photo is already mounted (and starts decoding) before a
 * swipe or arrow-click finishes animating into view, without ever loading
 * the whole gallery up front. With Data Saver on (lib/useSaveData.js) only
 * the photo actually swiped to is loaded. An unloaded slide renders an empty
 * canvas-alt placeholder that still carries the real flex-shrink-0/w-full
 * sizing, so the scroller's snap points and scrollWidth stay correct
 * either way.
 */
export default function CardImageCarousel({
  images, alt, sizes = '(min-width: 1024px) 22rem, 100vw', onIndexChange, priority = false,
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(() => new Set([0]));
  const scrollerRef = useRef(null);
  const total = images.length;
  const lightData = useSaveData();

  // Marks a slide (and its immediate neighbours) as allowed to mount its
  // real image — called directly from the two places `index` actually
  // changes (scrollToIndex/handleScroll below), not from a useEffect keyed
  // on `index`: deriving state from a prop/state change belongs in the
  // event handler that causes the change, not a synchronous setState inside
  // an effect (see react-hooks/set-state-in-effect).
  function markLoadedAround(i) {
    const wanted = lightData ? [i] : [i - 1, i, i + 1];
    setLoaded((prev) => {
      let next = prev;
      for (const idx of wanted) {
        if (idx >= 0 && idx < total && !next.has(idx)) {
          if (next === prev) next = new Set(prev);
          next.add(idx);
        }
      }
      return next;
    });
  }

  // Notifies a caller rendering its own "current/total" counter
  // (PropertyCard's pill) whenever the visible photo actually changes, so
  // it stays in sync instead of a static "1/N" that never moves once
  // someone swipes past the first photo. An effect, not a call inlined into
  // setIndex's updater — calling a *different* component's setState from
  // inside this component's state-updater function is exactly the "Cannot
  // update a component while rendering a different component" anti-pattern
  // React warns about; an effect defers it to after commit, which is the
  // correct place for one component to tell another "my state changed".
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);

  function visibleDots() {
    if (total <= DOT_WINDOW) {
      return images.map((_, i) => ({ photoIndex: i, edge: false }));
    }
    const start = Math.max(0, Math.min(index - Math.floor(DOT_WINDOW / 2), total - DOT_WINDOW));
    return Array.from({ length: DOT_WINDOW }, (_, k) => {
      const photoIndex = start + k;
      const edge = (k === 0 && start > 0) || (k === DOT_WINDOW - 1 && start + DOT_WINDOW < total);
      return { photoIndex, edge };
    });
  }

  function scrollToIndex(i, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTo({ left: i * scroller.clientWidth, behavior: 'smooth' });
    }
    setIndex(i);
    markLoadedAround(i);
  }

  function go(delta, e) {
    scrollToIndex((index + delta + total) % total, e);
  }

  function handleScroll(e) {
    const scroller = e.currentTarget;
    const width = scroller.clientWidth;
    if (!width) return;
    const next = Math.min(Math.max(Math.round(scroller.scrollLeft / width), 0), total - 1);
    setIndex((current) => (next === current ? current : next));
    markLoadedAround(next);
  }

  // Desktop hover reveals the arrow buttons (sm:group-hover/carousel below)
  // — the same gesture is real "explicit intent to browse", so it also
  // preloads the next photo, ahead of an actual swipe/click, purely so a
  // hover-then-click has nothing left to wait on. Touch devices have no
  // hover state, so this never fires the eager-load spec explicitly wants
  // reserved for swipe/expansion there.
  //
  // Gated on `pointerType === 'mouse'`, and it must stay a pointer event, not
  // onMouseEnter. A tap on iOS Safari fires compatibility mouseover/
  // mouseenter events BEFORE the click, and WebKit cancels that click if the
  // DOM changes during them (its "hover menu" heuristic: the tap is spent
  // revealing the menu). The handler used to be onMouseEnter, so every tap
  // on a multi-photo card mounted photo 2's <img>, and iPhone users had to
  // tap a card twice to open the listing — the first tap did nothing.
  function handlePointerEnter(e) {
    if (e.pointerType !== 'mouse') return;
    if (total > 1) {
      setLoaded((prev) => (prev.has(1) ? prev : new Set(prev).add(1)));
    }
  }

  const arrowClass =
    'u-press absolute top-1/2 hidden -translate-y-1/2 rounded-full bg-surface/90 p-1.5 text-ink opacity-0 pointer-events-none backdrop-blur-sm transition-opacity hover:bg-surface sm:flex sm:group-hover/carousel:pointer-events-auto sm:group-hover/carousel:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100';

  return (
    <div className="group/carousel relative h-full w-full overflow-hidden bg-canvas-alt" onPointerEnter={handlePointerEnter}>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {images.map((src, i) => (
          // `overflow-hidden` keeps the hover zoom below inside its own slide;
          // without it the NEXT slide's scaled photo paints over this one's edge.
          <div key={`${src}-${i}`} className="relative h-full w-full flex-shrink-0 snap-center overflow-hidden">
            {loaded.has(i) ? (
              <SafeImage
                src={src}
                alt={i === 0 ? alt : `${alt} — photo ${i + 1}`}
                fill
                sizes={sizes}
                priority={priority && i === 0}
                // A slow inner zoom while the pointer is on the card (the card's
                // Link is the `group`). Tailwind's hover variant is already
                // (hover: hover)-gated, so it never sticks on a phone.
                className="object-cover contrast-[1.03] brightness-[1.02] saturate-[1.04] transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
              />
            ) : null}
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => go(-1, e)}
            aria-label={t('listings.gallery.previousPhoto')}
            className={`${arrowClass} left-2`}
          >
            <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => go(1, e)}
            aria-label={t('listings.gallery.nextPhoto')}
            className={`${arrowClass} right-2`}
          >
            <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex items-center justify-center gap-1.5 sm:pointer-events-auto"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {visibleDots().map(({ photoIndex, edge }) => (
              <button
                key={photoIndex}
                type="button"
                tabIndex={-1}
                onClick={(e) => scrollToIndex(photoIndex, e)}
                aria-label={`Photo ${photoIndex + 1}`}
                aria-current={photoIndex === index}
                className={`rounded-full shadow-sm transition-all ${
                  photoIndex === index
                    ? 'h-1.5 w-4 bg-white'
                    : edge
                      ? 'h-1 w-1 bg-white/40'
                      : 'h-1.5 w-1.5 bg-white/60'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
