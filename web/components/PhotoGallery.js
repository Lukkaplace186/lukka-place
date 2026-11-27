'use client';

import { Fragment, ViewTransition, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, ImageOff, MoveHorizontal, Play, X } from 'lucide-react';
import SafeImage from './SafeImage';
import CardImageCarousel from './CardImageCarousel';
import VideoPlayBadge from './VideoPlayBadge';
import { isVideoPoster } from '@/lib/listingVideos';
import { Badge } from './ListingBadges';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { listingEventPayload, trackEvent } from '@/lib/analyticsClient';
import { initialGalleryState, noteGalleryStep } from '@/lib/galleryEngagement';
import { DETAIL_HERO_SIZES, DETAIL_SIDE_SIZES } from '@/lib/detailGallerySizes';
import { useBackToClose } from '@/lib/useBackToClose';

/** A finger travel this far (px) down the viewer closes it; sideways pages. */
const SWIPE_CLOSE_PX = 70;

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
/**
 * `videos` ([{url, poster}], lib/listingVideos.js) are items of the gallery,
 * not a section further down: the cover frame alone read as one more photo
 * and visitors never found the player (reported 2026-10-22). With photos the
 * first video is the second item, so it shows in the mosaic and as the second
 * slide; with no photo it leads. Its tile carries a play badge and the
 * viewer plays it. A cover frame passed in `images` is dropped — the video
 * item stands for it.
 */
// `clearBack`: in the app the photo runs under a clear top bar whose back
// button sits top-left, so the "Annonce vérifiée" badge steps aside.
export default function PhotoGallery({ images, videos = [], alt, mobileActions = null, verifiedAt = null, eventListing = null, clearBack = false, transitionName = null }) {
  // The app: the phone photo carries the tapped card's view-transition name, so
  // the card's photo grows into it (lib/appPhotoHandoff.js). No name, no wrapper.
  const Morph = transitionName ? ViewTransition : Fragment;
  const morphProps = transitionName ? { name: transitionName, share: 'morph', default: 'none' } : {};
  const t = useT();
  const photoShots = (images || []).filter((src) => !isVideoPoster(src));
  const videoItems = (videos || []).map((video) => ({ src: video.poster || '', video: video.url }));
  const items = videoItems.length
    ? photoShots.length
      ? [{ src: photoShots[0], video: null }, ...videoItems, ...photoShots.slice(1).map((src) => ({ src, video: null }))]
      : videoItems
    : (images || []).map((src) => ({ src, video: null }));
  const shots = items.map((item) => item.src);
  const hasVideo = videoItems.length > 0;
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

  // Phone thumbnail strip (2026-11-17, owner's reference: a row of small
  // photos under the main one). A tap jumps the carousel there; the strip
  // keeps the current photo in view as the visitor swipes.
  const carouselControl = useRef(null);
  const thumbStripRef = useRef(null);
  useEffect(() => {
    const strip = thumbStripRef.current;
    const thumb = strip?.querySelector(`[data-thumb="${mobileIndex}"]`);
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - (strip.clientWidth - thumb.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [mobileIndex]);

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

  // Pause before closing: Radix keeps the content mounted through its exit
  // animation, and a video still playing there is heard after it is gone.
  const videoRef = useRef(null);
  const swipeRef = useRef(null);
  const closeLightbox = useCallback(() => {
    videoRef.current?.pause();
    setLightboxIndex(null);
  }, []);
  // Back (Android's button, the iPhone edge swipe, the browser's) closes the
  // viewer or the grid and leaves the listing where it was (lib/useBackToClose.js).
  useBackToClose(isOpen, closeLightbox);
  const releaseGridBack = useBackToClose(gridOpen, () => setGridOpen(false));

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
      <Morph {...morphProps}>
      <div className="relative -mx-4 sm:hidden" data-listing-hero="">
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
          {/* DETAIL_HERO_SIZES, not "100vw": the same width on a phone, but on
              desktop this hidden carousel's priority photo then asks for the
              desktop hero's exact file instead of a second, 1920w copy of the
              same cover (measured 2026-11-06: both were downloaded). */}
          {/* preloadAhead: photos 2–3 are fetched once the cover has painted,
              so the first swipe lands on a photo instead of a grey frame
              (owner's iPhone, 2026-11-17: ~1.5 s per photo from Kinshasa).
              loadingShimmer: a slow photo reads as loading, not as missing. */}
          {/* No arrows and no "1/N photos" on the phone photo (owner,
              2026-11-18): the swipe hint below says it moves, and the
              thumbnail strip shows where you are and replaces the dots. */}
          <CardImageCarousel images={shots} alt={alt} sizes={DETAIL_HERO_SIZES} fullWidth priority fetchPriority="high" preloadAhead={2} loadingShimmer showDots={false} controlRef={carouselControl} onIndexChange={onMobileIndexChange} />
        </div>

        {verifiedAt ? (
          <span className={`pointer-events-none absolute z-10 flex flex-wrap gap-2 ${clearBack ? 'left-16 top-5' : 'left-3.5 top-3.5'}`}>
            <Badge tone="white">{t('listings.gallery.verified')}</Badge>
          </span>
        ) : null}

        {/* "Glissez pour voir" where the counter was, until the first swipe. */}
        {total > 1 && mobileIndex === 0 ? (
          <span className="u-glass-royal pointer-events-none absolute bottom-3.5 right-3.5 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] font-semibold">
            <MoveHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('listings.gallery.swipeHint')}
          </span>
        ) : null}

        {mobileActions ? (
          <span className="absolute right-3.5 top-3.5 z-10 flex gap-2">{mobileActions}</span>
        ) : null}

        {/* No "Voir les N photos" button on the photo any more (2026-11-18,
            owner): the swipe, the arrows and the thumbnail strip below already
            reach every photo, and the button covered part of it. */}
      </div>
      </Morph>

      {/* Thumbnails, phone only. Small files (sizes 80px, low fetch
          priority, never ahead of the main photo), so a visitor sees at once
          what the other photos are and can jump to one. `relative` makes
          each thumb's offsetLeft count from the strip (the effect above). */}
      {total > 1 ? (
        <div
          ref={thumbStripRef}
          aria-label={t('listings.gallery.allPhotos')}
          className="no-scrollbar relative -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 pt-2 sm:hidden"
        >
          {shots.map((src, index) => (
            <button
              key={`${src}-${index}`}
              type="button"
              data-thumb={index}
              onClick={() => carouselControl.current?.goTo(index)}
              aria-label={`Photo ${index + 1}`}
              aria-current={index === mobileIndex ? 'true' : undefined}
              className={`relative h-14 w-20 flex-none overflow-hidden rounded-md bg-canvas-deep transition-shadow ${
                index === mobileIndex ? 'ring-2 ring-blue ring-offset-1 ring-offset-canvas' : ''
              }`}
            >
              {/* The first six (what a phone shows) load at once: lazy
                  loading inside this horizontal strip did not start on
                  lukkaplace.com until the strip was scrolled (grey tiles,
                  measured 2026-11-17). The rest stay lazy and load on scroll. */}
              <SafeImage src={src} alt="" fill sizes="80px" fetchPriority="low" loading={index < 6 ? 'eager' : 'lazy'} draggable={false} className="object-cover" />
              {items[index]?.video ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/60 text-white">
                    <Play strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3 translate-x-[1px] fill-white" />
                  </span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

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
                  // The viewer takes over the grid's back step; taking the
                  // grid's entry back here would race the viewer's own.
                  releaseGridBack();
                  setGridOpen(false);
                  setLightboxIndex(index);
                }}
                aria-label={t('listings.gallery.enlargePhoto', { n: index + 1 })}
                className={`relative overflow-hidden rounded-lg bg-canvas-deep ${index === 0 ? 'col-span-2 h-52' : 'h-32'}`}
              >
                <SafeImage src={src} alt="" fill sizes={index === 0 ? '96vw' : '48vw'} className="object-cover" />
                {items[index]?.video ? <VideoPlayBadge size="sm" /> : null}
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
              fetchPriority="high"
              sizes={DETAIL_HERO_SIZES}
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
            {items[0]?.video ? <VideoPlayBadge /> : null}

            {/* Only on a real verified_at — see the component's doc comment. */}
            {verifiedAt ? (
              <span className="pointer-events-none absolute left-3.5 top-3.5 z-10 flex flex-wrap gap-2">
                <Badge tone="white">{t('listings.gallery.verified')}</Badge>
              </span>
            ) : null}
            {/* No "1/N photos" badge here either (owner, 2026-11-18): the
                mosaic shows the next photos, and "Toutes les photos" opens
                them all. */}
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
                      sizes={DETAIL_SIDE_SIZES}
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
                    />
                    {items[i + 1]?.video ? <VideoPlayBadge size="sm" /> : null}
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

      <Dialog open={isOpen} onOpenChange={(next) => !next && closeLightbox()}>
        {/* Full screen on a phone, with its own top bar: the dialog's stock ×
            was a dark 32px icon on this dark frame, sitting under the native
            video controls (iOS draws volume / PiP in the same corner), so a
            visitor watching a video had no visible way out (reported
            2026-10-23). The bar sits ABOVE the stage, never over the video.
            z-[70]: the site header is z-[60] and painted over the top of
            every z-50 dialog — exactly where a close button goes. */}
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[70] bg-black/70"
          className="z-[70] flex max-w-[min(96vw,80rem)] flex-col gap-0 border-none bg-ink/95 p-0 sm:max-w-[min(96vw,80rem)] max-sm:inset-0 max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:bg-black"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>

          <div className="flex h-14 shrink-0 items-center justify-between px-3 pt-[env(safe-area-inset-top)] sm:absolute sm:inset-x-0 sm:top-0 sm:z-20">
            <span className="u-tabular text-[0.8125rem] font-semibold text-white/85">
              {total > 1 && isOpen ? `${lightboxIndex + 1} / ${total}` : ''}
            </span>
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t('listings.gallery.close')}
                className="u-press flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink shadow-md"
              >
                <X strokeWidth={2.25} className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>

          {/* A tap on the bare stage around the video closes the viewer (the
              phone layout has no backdrop left to tap), and so does a swipe
              down anywhere on it. */}
          <div
            className="relative flex min-h-0 w-full flex-1 items-center justify-center max-sm:pb-[env(safe-area-inset-bottom)] sm:h-[80vh] sm:flex-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeLightbox();
            }}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              swipeRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
            }}
            onTouchEnd={(e) => {
              const start = swipeRef.current;
              const touch = e.changedTouches[0];
              swipeRef.current = null;
              if (!start || !touch) return;
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;
              if (dy > SWIPE_CLOSE_PX && dy > Math.abs(dx) * 1.5) closeLightbox();
              else if (total > 1 && !items[lightboxIndex]?.video && Math.abs(dx) > SWIPE_CLOSE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
                step(dx < 0 ? 1 : -1);
              }
            }}
          >
            {isOpen && items[lightboxIndex]?.video ? (
              // Keyed by index so paging to another item stops this one.
              // autoPlay: the viewer only opens on the visitor's own tap.
              // Its own size (max-h/max-w), not h-full w-full: the area
              // around it stays a stage a tap can close.
              <video
                ref={videoRef}
                key={lightboxIndex}
                src={items[lightboxIndex].video}
                poster={items[lightboxIndex].src || undefined}
                controls
                autoPlay
                playsInline
                className="max-h-full max-w-full object-contain"
                aria-label={t('listings.gallery.playVideo')}
              />
            ) : isOpen ? (
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
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
