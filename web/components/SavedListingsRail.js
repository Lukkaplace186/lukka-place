'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import PropertyCard from './PropertyCard';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { revealUp } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';
import { useT } from '@/lib/i18n/client';

/**
 * The saved-properties shelf.
 *
 * A horizontal snap rail at EVERY breakpoint, unlike
 * FeaturedListingsCarousel which scrolls below sm and becomes a wrapping
 * grid above it. That difference is the point rather than an inconsistency:
 * a wrapping grid says "here is the catalogue, it continues", which is right
 * for the newest listings and wrong for a personal shelf whose whole length
 * is a fact about the visitor. A rail stays the same object at four saved
 * properties or forty, and never leaves a half-empty second row.
 *
 * Each card carries an explicit `w-[19rem] shrink-0` for the reason
 * RelatedListings.js documents from a live repro: PropertyCard's default
 * `layout="vertical"` root has no width class of its own, so an
 * unconstrained flex child collapses to near-zero and the whole rail
 * renders as blank space. `snap-start` is what the row's own
 * snap-x/snap-mandatory needs per item. On the narrowest viewports the
 * cards go full-width (`w-[85vw]` capped by `max-w-[19rem]`) so a saved
 * card reads as the single thing in view rather than a 19rem column beside
 * a sliver of the next.
 *
 * Arrows exist because this rail scrolls on desktop, where
 * FeaturedListings' grid does not — a mouse has no horizontal gesture, so
 * a rail with no controls is a rail most desktop visitors never scroll.
 * They are rendered only when the content genuinely overflows and each one
 * disables itself at its end of the track, measured from real scroll
 * geometry rather than assumed from the card count (which cannot know the
 * viewport width). See RailArrow at the bottom of this file.
 */

/** One card width plus its gap — a click moves by a whole card, never a partial one. */
const CARD_STEP = 304 + 16;

export default function SavedListingsRail({ listings }) {
  const safe = useMotionSafe();
  const t = useT();
  const railRef = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    // 1px of slack: sub-pixel layout means scrollLeft rarely lands exactly
    // on scrollWidth - clientWidth at the end of the track.
    const maxScroll = el.scrollWidth - el.clientWidth;
    setOverflow({ left: el.scrollLeft > 1, right: el.scrollLeft < maxScroll - 1 });
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    measure();
    // ResizeObserver catches the viewport changing under a rail whose
    // scroll position never moved — a plain scroll listener would leave the
    // arrows stale after a rotate or a window resize.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, listings]);

  function scrollByCard(direction) {
    railRef.current?.scrollBy({ left: direction * CARD_STEP, behavior: 'smooth' });
  }

  const scrollable = overflow.left || overflow.right;

  return (
    <div className="relative">
      <motion.div
        ref={railRef}
        onScroll={measure}
        variants={safe ? revealUp : undefined}
        initial={safe ? 'hidden' : false}
        whileInView={safe ? 'visible' : undefined}
        viewport={{ once: true, amount: 0.15 }}
        tabIndex={0}
        role="group"
        aria-label={t('home.saved.title')}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 no-scrollbar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2"
      >
        {listings.map((listing, i) => (
          <div key={listing.id} className="w-[85vw] max-w-[19rem] shrink-0 snap-start sm:w-[19rem]">
            {/* Only the cards that can be on screen before any scrolling
                skip lazy-loading, matching FeaturedListingsCarousel's own
                first-row-only `priority` rule. */}
            <PropertyCard listing={listing} priority={i < 4} />
          </div>
        ))}
      </motion.div>

      {scrollable && (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between lg:flex">
          <RailArrow
            direction={-1}
            enabled={overflow.left}
            onActivate={scrollByCard}
            Icon={ChevronLeft}
            offset="-translate-x-1/2"
          />
          <RailArrow
            direction={1}
            enabled={overflow.right}
            onActivate={scrollByCard}
            Icon={ChevronRight}
            offset="translate-x-1/2"
          />
        </div>
      )}
    </div>
  );
}

/**
 * One end-of-track control. Written as two explicit siblings above rather
 * than a `.map` over a two-item array: there is no list here, only a left
 * and a right, and the array version bought nothing but a key React was
 * never satisfied with (a real "unique key prop" warning in the console,
 * caught in local QA).
 *
 * `aria-hidden` + `tabIndex={-1}`: the rail itself is a focusable,
 * keyboard-scrollable region, so these are a redundant pointer affordance
 * for mouse users, not a second tab stop per section.
 */
function RailArrow({ direction, enabled, onActivate, Icon, offset }) {
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      disabled={!enabled}
      onClick={() => onActivate(direction)}
      /* pointer-events, not just opacity: an invisible-but-present button at
         the end of the track would still swallow the click meant for the
         card sitting under it. */
      className={`-mt-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink-70 shadow-sm transition-opacity hover:text-blue-deep ${offset} ${
        enabled ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
    </button>
  );
}
