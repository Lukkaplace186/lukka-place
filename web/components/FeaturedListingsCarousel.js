'use client';

import PropertyCard from './PropertyCard';

/**
 * Client wrapper around FeaturedListings' server-fetched data.
 *
 * Two distinct layouts, not one carousel styled two ways:
 *   - Below sm (640px): a snap-scroll rail whose next card deliberately
 *     PEEKS in from the right edge, so a visitor can see there is more to
 *     swipe to (product direction, 2026-09-22 — this reverses an earlier
 *     one-full-card-at-a-time version, where nothing on screen said the
 *     section scrolled at all).
 *     - The rail breaks out of the section's `px-4` (`-mx-4 px-4`) so cards
 *       scroll all the way to the screen edge instead of being cut at the
 *       gutter, and `scroll-px-4` keeps each snapped card aligned with the
 *       heading above it.
 *     - Each card is `w-[82vw] max-w-[310px]`: at 390px that is ~320px of
 *       card, a 12px gap, and the next card's border and photo edge showing.
 *       PropertyCard's own `border-line` + resting shadow is what makes the
 *       peeking edge read as a card rather than a glitch.
 *     - The wrapper carries the width because PropertyCard's default
 *       `layout="vertical"` root has no width class — an unconstrained flex
 *       child collapses to its min-content width (2px per card, confirmed on
 *       a real 390px viewport). `sm:contents` removes the wrapper from the box
 *       tree once the grid below takes over.
 *     - Equal heights, not equal content: the row stretches every wrapper to
 *       the tallest card, and `[&>div]:h-full` passes that height through
 *       PropertyCard's `@container` div (which has no height of its own) to
 *       the Link's `h-full`. The card's `mt-auto` action bar then takes the
 *       slack, so a card with no amenity chips keeps its natural spacing and
 *       its buttons line up with its neighbour's — the difference shows as
 *       air above the button rule, never as a stretched or padded section.
 *     - `pt-2 pb-5`: an overflow-x container clips on both axes, so the
 *       vertical padding is what leaves room for the card shadow.
 *   - sm and up: a real CSS grid (`grid-cols-2 md:grid-cols-3
 *     lg:grid-cols-4`), not a horizontal scroll strip.
 *
 * The reveal is `.u-rail-reveal` (app/globals.css), a CSS scroll-driven
 * animation with no JavaScript: the whole strip reveals below sm (the cards'
 * nearest scroller is the strip, which never scrolls vertically), and from sm
 * each card reveals on its own, cascading across the grid row. A browser
 * without `animation-timeline` simply shows the cards with no reveal.
 */
export default function FeaturedListingsCarousel({ listings }) {
  return (
    <div
      className={[
        'u-rail-reveal -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-5 no-scrollbar',
        'sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:px-0 sm:pt-0 sm:pb-0',
        'md:grid-cols-3',
        'lg:grid-cols-4',
      ].join(' ')}
    >
      {listings.map((listing, i) => (
        <div key={listing.id} className="w-[82vw] max-w-[310px] shrink-0 snap-start sm:contents [&>div]:h-full">
          {/* The first cards (mobile: the one in view plus the peek; desktop:
              the first grid row) are above the fold — `priority` skips
              next/image's lazy-loading so the LCP photo requests immediately. */}
          <PropertyCard listing={listing} priority={i < 4} />
        </div>
      ))}
    </div>
  );
}
