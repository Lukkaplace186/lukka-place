'use client';

import { motion } from 'framer-motion';
import PropertyCard from './PropertyCard';
import { revealUp } from '@/lib/motion';
import { useMotionSafe } from '@/lib/useMotionSafe';

/**
 * Client wrapper around FeaturedListings' server-fetched data.
 *
 * Two distinct layouts, not one carousel styled two ways:
 *   - Below sm (640px): a real snap-scroll carousel — `overflow-x-auto
 *     snap-x snap-mandatory` with `no-scrollbar` since a touch carousel
 *     doesn't need a visible scrollbar track. Deliberately no extra
 *     horizontal padding or negative-margin breakout here: the parent
 *     <section> (FeaturedListings.js) already carries `px-4`, and each
 *     card is wrapped in its own `w-full shrink-0 snap-start` div — the
 *     doc comment here used to describe this same intent ("each card is
 *     w-full/min-w-full") without any class actually doing it: PropertyCard
 *     defaults to `layout="vertical"`, whose own root wrapper carries no
 *     width class at all (only the `layout="horizontal"` branch gets
 *     `w-full`), so every card in this flex row collapsed to its
 *     min-content width — confirmed directly, 2px per card on a real
 *     390px viewport, the whole row reading as a series of vertical
 *     hairlines. The wrapper below is what RelatedListings.js's own
 *     "Biens similaires" rail needed for the identical reason; `sm:contents`
 *     removes it from the box tree once the layout below switches to a
 *     real grid, so PropertyCard's own Link is the direct grid item there,
 *     same as before this fix.
 *     An earlier version broke out of the section's padding (`-mx-4/px-4`
 *     + `scroll-p-4`) to bleed cards near-full-bleed at 85vw with a
 *     deliberate sliver of the next card showing; on real devices that
 *     sliver read as a mid-scroll glitch rather than a hint, so this now
 *     shows exactly one full card at a time instead.
 *   - sm and up: a real CSS grid (`grid-cols-2 md:grid-cols-3
 *     lg:grid-cols-4`), not a horizontal scroll strip. There is nothing to
 *     scroll on a wrapping grid, so the previous hover-revealed arrow
 *     buttons and their scrollBy() handler are gone — they only ever did
 *     anything on the same widths that no longer scroll.
 *
 * The reveal lives on this wrapper, not on the cards — each card runs its
 * own independent hover variant, and framer-motion's `animate` prop takes
 * priority over `whileInView`, so combining both on one element makes the
 * scroll reveal silently lose.
 */
export default function FeaturedListingsCarousel({ listings }) {
  const safe = useMotionSafe();

  return (
    <motion.div
      variants={safe ? revealUp : undefined}
      initial={safe ? 'hidden' : false}
      whileInView={safe ? 'visible' : undefined}
      viewport={{ once: true, amount: 0.15 }}
      className={[
        'flex w-full snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 no-scrollbar',
        'sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0',
        'md:grid-cols-3',
        'lg:grid-cols-4',
      ].join(' ')}
    >
      {listings.map((listing, i) => (
        <div key={listing.id} className="w-full shrink-0 snap-start sm:contents">
          {/* First row of the lg:grid-cols-4 desktop grid (and the single
              visible card on the mobile snap-carousel) is above the fold —
              `priority` skips next/image's lazy-loading for those so the
              LCP photo starts requesting immediately instead of waiting on
              an IntersectionObserver, matching CardImageCarousel's own
              cover-photo-only default. Everything past index 4 stays lazy. */}
          <PropertyCard listing={listing} priority={i < 4} />
        </div>
      ))}
    </motion.div>
  );
}
