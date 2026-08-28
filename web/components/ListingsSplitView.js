'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PropertyCard from './PropertyCard';
import SidebarInsights from './SidebarInsights';
import ResponsiveMapPane from './ResponsiveMapPane';
import MobileMapChrome from './MobileMapChrome';
import MobileMapOverlay from './MobileMapOverlay';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

function buildPageHref(searchParams, page) {
  const params = new URLSearchParams(searchParams);
  params.set('page', String(page));
  return `/listings?${params.toString()}`;
}

/**
 * Split screen: results on the LEFT, sticky map on the right.
 *
 * This is the order web/Design's "Résultats — desktop" screen uses — a
 * single column of horizontal PropertyCards taking the remaining width,
 * beside a sticky map. It was previously map-left at 42% with a two-column
 * grid of vertical cards; then results-left with a fixed 400px map rail;
 * now a real 50/50 (`grid-cols-1 lg:grid-cols-2`), per explicit instruction.
 *
 * Extracted as a client component because the card <-> map-pin hover sync
 * needs a `hoveredId` somewhere and the page itself is an async Server
 * Component that cannot hold state.
 *
 * Sticky offset is 8.5rem (h-16 fixed Header + the sticky FilterBar
 * directly beneath it), not the 80px a literal instruction asked for —
 * measured directly against FilterBar.js's own rendered height, which
 * varies with whether the active-filter-chips row is present. 80px would
 * seat the map's top edge *underneath* the sticky filter bar, hidden
 * behind it rather than starting where the results column visually does.
 */
export default function ListingsSplitView({ listings, isMapView, page, totalPages, params, popularCommunes, communes, total }) {
  const [hoveredId, setHoveredId] = useState(null);

  // Mobile map mode is a `fixed` fullscreen layer (see the map wrapper
  // below), painted over whatever the document would otherwise show at
  // that scroll position. Without this, the body underneath is still
  // scrollable — a visitor could scroll the empty, hidden filter/results
  // chrome behind the fixed map and see dead space once they scroll past
  // it. Scoped to <lg with matchMedia, same pattern ResponsiveMapPane.js
  // already uses: on desktop the map is a normal in-flow sticky pane, not
  // fixed, so the page must stay scrollable there regardless of isMapView.
  useEffect(() => {
    if (!isMapView) return undefined;
    const mql = window.matchMedia('(max-width: 1023.98px)');
    const apply = () => {
      document.body.style.overflow = mql.matches ? 'hidden' : '';
    };
    apply();
    mql.addEventListener('change', apply);
    return () => {
      mql.removeEventListener('change', apply);
      document.body.style.overflow = '';
    };
  }, [isMapView]);

  const pagerLink =
    'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-4 py-2 text-[0.8125rem] font-medium text-ink transition-colors hover:border-blue hover:text-blue-deep';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
      <div className={isMapView ? 'hidden lg:block' : 'block'}>
        {/* Container query, not a viewport breakpoint: at exactly the lg
            cutoff where this pane first appears next to the map (measured
            live: 1024px viewport -> only ~480px for this pane), a
            viewport-based sm:grid-cols-2 forced two ~232px cards, too
            cramped to read on a real iPad in landscape. Sizing off the
            pane's own rendered width means it self-corrects for any
            combination of viewport + rail + map width instead of guessing
            per device.

            The previous `-mx-4 gap-0` mobile treatment (bleeding the feed
            edge-to-edge and letting each card's own `border-b` separate
            them) is gone with the old ListingCardVertical: the design's
            PropertyCard is always a rounded, hairline-bounded card, so it
            needs a real gap at every width — fused edge-to-edge cards with
            14px corners and no gap is exactly the "layout bug" look.

            One column of horizontal cards, per the design's results screen
            — not a two-up grid of vertical ones. Each card carries its own
            @container and stacks its image above the body when the column
            is too narrow for the 300px thumbnail. */}
        <div className="flex flex-col gap-5">
          {listings.map((listing) => (
            <PropertyCard
              key={listing.id}
              listing={listing}
              layout="horizontal"
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

      {/* Map, right on desktop — the other half of the 50/50 split, sticky
          and rounded per the earlier request. On mobile, switching into map
          view no longer just reveals this pane in normal document flow: it
          becomes a `fixed` fullscreen layer (viewport minus the h-16 fixed
          Header and the h-16 BottomNav — this app has a persistent bottom
          nav a reference portal's own app chrome doesn't, so pinning the
          map to the raw viewport bottom would seat ~64px of it underneath
          BottomNav, unusable, the same class of correction as the
          `top-[8.5rem]` sticky offset above), carrying MobileMapChrome's
          floating nav/search/filter/badge on top of it — the immersive,
          Rightmove-style map mode. `lg:` reverts everything back to the
          normal sticky in-flow pane. PropertyMap itself owns no border/
          rounding any more (see its own comment) precisely so this one
          wrapper can flip between "full-bleed fixed layer" and "rounded
          sticky rail" without PropertyMap needing to know which. */}
      <div
        className={`flex flex-col ${
          isMapView
            ? 'fixed inset-x-0 top-16 bottom-16 z-30'
            : 'hidden'
        } lg:inset-auto lg:z-auto lg:flex lg:overflow-hidden lg:rounded-2xl lg:sticky lg:top-[8.5rem] lg:h-[calc(100vh-10rem)]`}
      >
        {/* Sticky top bar — a real in-flow row (shrink-0), not floating
            over the map, so the map area below it can claim "the rest of
            the viewport" with flex-1 instead of a guessed pixel offset. */}
        {isMapView ? <MobileMapChrome params={params} /> : null}

        {/* The map area itself: ResponsiveMapPane and MobileMapOverlay
            (badge + Liste button) are siblings sharing this `relative`
            box, so the overlay's `top-4`/`bottom-6` land relative to the
            map's own bounds, not the sticky bar or the whole fixed layer. */}
        <div className="relative min-h-0 flex-1">
          <ResponsiveMapPane
            listings={listings}
            isMapView={isMapView}
            hoveredId={hoveredId}
            onMarkerHover={setHoveredId}
            className="h-full w-full"
          />
          {isMapView ? <MobileMapOverlay shown={listings.length} totalMatching={total} /> : null}
        </div>
      </div>
    </div>
  );
}
