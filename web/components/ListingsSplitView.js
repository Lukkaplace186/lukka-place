'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import ListingCardVertical from './ListingCardVertical';
import SidebarInsights from './SidebarInsights';
import ResponsiveMapPane from './ResponsiveMapPane';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

function buildPageHref(searchParams, page) {
  const params = new URLSearchParams(searchParams);
  params.set('page', String(page));
  return `/listings?${params.toString()}`;
}

/**
 * Split screen: sticky map on the left, results grid on the right.
 *
 * Map-left matches the reference (Zillow's map view). It was previously
 * results-left / map-right, which reads as a list with a map bolted on
 * rather than a map you are browsing.
 *
 * Extracted as a client component because the card <-> map-pin hover sync
 * needs a `hoveredId` somewhere and the page itself is an async Server
 * Component that cannot hold state. Arbitrary-value grid template on
 * purpose: an uncommon grid-cols-N has silently failed to compile in this
 * Tailwind v4 setup before (see web/CLAUDE.md).
 *
 * Sticky offset is 8.5rem: the h-16 fixed Header plus the sticky FilterBar
 * sitting directly beneath it.
 */
export default function ListingsSplitView({ listings, isMapView, page, totalPages, params, popularCommunes, communes }) {
  const [hoveredId, setHoveredId] = useState(null);

  const pagerLink =
    'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[0.8125rem] font-medium text-ink transition-colors hover:border-blue hover:text-blue-deep';

  return (
    <div className="lg:grid lg:grid-cols-[42%_minmax(0,1fr)] lg:items-start lg:gap-6">
      <ResponsiveMapPane
        listings={listings}
        isMapView={isMapView}
        hoveredId={hoveredId}
        onMarkerHover={setHoveredId}
        className={`${isMapView ? 'block' : 'hidden lg:block'} lg:sticky lg:top-[8.5rem] lg:h-[calc(100vh-10rem)]`}
      />

      <div className={`@container ${isMapView ? 'hidden lg:block' : 'block'}`}>
        {/* Container query, not a viewport breakpoint: at exactly the lg
            cutoff where this pane first appears next to the map (measured
            live: 1024px viewport -> only ~480px for this pane), a
            viewport-based sm:grid-cols-2 forced two ~232px cards, too
            cramped to read on a real iPad in landscape. Sizing off the
            pane's own rendered width means it self-corrects for any
            combination of viewport + rail + map width instead of guessing
            per device.

            `-mx-4 min-[608px]:mx-0` bleeds the single-column mobile feed
            edge-to-edge (matching ListingCardVertical's own border-less
            mobile styling — see that file), the same breakout idiom
            FilterBar's pill row already uses. `min-[608px]`, not Tailwind's
            `sm` (640px): this pane's own width is `viewport - 32px` (the
            page's own `px-4`) below `lg`, so the `@[36rem]`(576px)
            container query actually flips to 2 columns at a 608px
            *viewport*, not 640 — using `sm:` here would leave a real
            32px-wide window where the query had already gone 2-column but
            the gap was still 0 and the margin still bled full-width,
            fusing two cards together with no gap and no border between
            them. ListingCardVertical's own border/rounded-corner switch
            uses the same 608px breakpoint for exactly this reason. Gap
            drops to 0 below that point — the cards' own `border-b` is what
            separates them there, not whitespace; a gap AND a border would
            double up. */}
        <div className="-mx-4 grid grid-cols-1 gap-0 min-[608px]:mx-0 min-[608px]:gap-4 @[36rem]:grid-cols-2">
          {listings.map((listing) => (
            <ListingCardVertical
              key={listing.id}
              listing={listing}
              isHovered={hoveredId === listing.id}
              onHoverStart={() => setHoveredId(listing.id)}
              onHoverEnd={() => setHoveredId((current) => (current === listing.id ? null : current))}
            />
          ))}
        </div>

        {totalPages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
            {page > 1 ? (
              <Link href={buildPageHref(params, page - 1)} className={pagerLink}>
                <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                Précédent
              </Link>
            ) : null}
            <span className="u-tabular px-2 text-[0.8125rem] text-ink-45">
              Page {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildPageHref(params, page + 1)} className={pagerLink}>
                Suivant
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="mt-12">
          <SidebarInsights popularCommunes={popularCommunes} allCommunes={communes} />
        </div>
      </div>
    </div>
  );
}
