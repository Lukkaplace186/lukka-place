'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, MapPinned } from 'lucide-react';
import PropertyCard from './PropertyCard';
import SidebarInsights from './SidebarInsights';
import ResponsiveMapPane from './ResponsiveMapPane';
import MobileMapChrome from './MobileMapChrome';
import MobileMapBar from './MobileMapBar';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { boundsToQuery } from '@/lib/mapViewport';
import { useT } from '@/lib/i18n/client';

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
export default function ListingsSplitView({
  listings, isMapView, page, totalPages, params, popularCommunes, communes, clearAreaHref = null, nearby = null,
}) {
  const t = useT();
  const router = useRouter();
  // How many listings the map counts in view — the mobile Liste button says it.
  const [inView, setInView] = useState(null);

  // The visitor moved the map: the list becomes that area (lib/listings.js
  // getListings, `bounds`). On desktop the list pane is on screen, so the
  // server re-renders it (router.replace, no scroll jump). On a phone the list
  // is hidden behind the fullscreen map, so re-rendering it on every pan would
  // spend the visitor's data for nothing: the URL is updated in place — Next
  // keeps useSearchParams in step with history.replaceState — and the Liste
  // button carries the area when it is tapped.
  const onAreaChange = useCallback((bounds) => {
    const qs = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(boundsToQuery(bounds))) qs.set(key, value);
    qs.delete('page');
    const url = `/listings?${qs.toString()}`;
    if (window.matchMedia('(min-width: 1024px)').matches) router.replace(url, { scroll: false });
    else window.history.replaceState(null, '', url);
  }, [router]);

  // "Voir N biens" on the phone map's bottom bar: ask the map to slide its
  // swipeable cards up (a counter, so every tap is a new request).
  const [cardsRequest, setCardsRequest] = useState(0);
  const openCards = useCallback(() => setCardsRequest((n) => n + 1), []);
  const [hoveredId, setHoveredId] = useState(null);
  // A pin's preview card sits over the bottom of the map, exactly where the
  // mobile "Liste" button floats — so the button steps aside while it is open.
  const [previewOpen, setPreviewOpen] = useState(false);

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
        {listings.length === 0 ? (
          // Only reachable with a map area (page.js renders the full empty
          // state otherwise): the map stays on screen, so the way out is to
          // move it — or to drop the area and go back to the search.
          <div className="rounded-lg border border-line bg-surface px-6 py-10 text-center">
            <MapPinned strokeWidth={ICON_STROKE_WIDTH} className="mx-auto mb-3 h-5 w-5 text-ink-45" aria-hidden="true" />
            <p className="text-[0.9375rem] font-semibold text-ink">{t('listings.results.emptyAreaTitle')}</p>
            <p className="mt-1 text-[0.8125rem] text-ink-45">{t('listings.results.emptyAreaHint')}</p>
            {clearAreaHref ? (
              <Link href={clearAreaHref} className="mt-4 inline-block text-[0.8125rem] font-semibold text-blue-deep underline-offset-2 hover:underline">
                {t('listings.results.clearArea')}
              </Link>
            ) : null}
          </div>
        ) : null}
        <div className="u-stagger-in-view flex flex-col gap-5">
          {/* Single column, so only the first couple of rows are ever
              actually above the fold — priority for those skips next/image's
              lazy-loading for the real LCP candidate on this page. */}
          {listings.map((listing, i) => (
            <PropertyCard
              key={listing.id}
              listing={listing}
              layout="horizontal"
              priority={i < 2}
              isHovered={hoveredId === listing.id}
              onHoverStart={() => setHoveredId(listing.id)}
              onHoverEnd={() => setHoveredId((current) => (current === listing.id ? null : current))}
            />
          ))}
        </div>

        {/* Only one or two exact results: the nearest others, below and
            labelled, never mixed into the exact list (app/(site)/listings/
            page.js, lib/listings.js getNearbyExtras). */}
        {nearby?.listings?.length ? (
          <section className="mt-8" aria-labelledby="nearby-extras-title">
            <p id="nearby-extras-title" className="u-eyebrow mb-1">
              {t('listings.results.nearbyExtrasTitle', { place: nearby.place })}
            </p>
            {nearby.places?.length ? (
              <p className="mb-3 text-[0.8125rem] text-ink-45">
                {nearby.places.map(({ commune, km }) => `${commune} (${km} km)`).join(', ')}
              </p>
            ) : null}
            <div className="flex flex-col gap-5">
              {nearby.listings.map((listing) => (
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
          </section>
        ) : null}

        {totalPages > 1 ? (
          <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
            {page > 1 ? (
              <Link href={buildPageHref(params, page - 1)} className={pagerLink}>
                <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('common.actions.previous')}
              </Link>
            ) : null}
            <span className="u-tabular px-2 text-[0.8125rem] text-ink-45">
              Page {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={buildPageHref(params, page + 1)} className={pagerLink}>
                {t('common.actions.next')}
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
          Header, down to the true viewport bottom — `bottom-0`, not
          `bottom-16`), carrying MobileMapChrome's floating nav/search/
          filter/badge on top of it — the immersive, Rightmove-style map
          mode. `lg:` reverts everything back to the normal sticky in-flow
          pane. PropertyMap itself owns no border/rounding any more (see
          its own comment) precisely so this one wrapper can flip between
          "full-bleed fixed layer" and "rounded sticky rail" without
          PropertyMap needing to know which.

          `bottom-16` used to be load-bearing: this app had a persistent
          fixed BottomNav.js tab bar a reference portal's own app chrome
          doesn't, so pinning the map to the raw viewport bottom would have
          seated ~64px of it underneath that bar, unusable — the same class
          of correction as the `top-[8.5rem]` sticky offset above. That bar
          is gone entirely now (see app/(site)/layout.js), so there is
          nothing left to clear; MobileMapBar's own "Liste" button
          (`absolute bottom-6` *within* this box) already follows this
          box's real bottom edge automatically. */}
      <div
        className={`flex flex-col ${
          isMapView
            ? 'fixed inset-x-0 top-16 bottom-0 z-30 bg-canvas'
            : 'hidden'
        } lg:inset-auto lg:z-auto lg:flex lg:overflow-hidden lg:rounded-2xl lg:sticky lg:top-[8.5rem] lg:h-[calc(100vh-10rem)]`}
      >
        {/* Sticky top bar — a real in-flow row (shrink-0), not floating
            over the map, so the map area below it can claim "the rest of
            the viewport" with flex-1 instead of a guessed pixel offset. */}

        {/* The map area itself: ResponsiveMapPane and MobileMapBar
            (badge + Liste button) are siblings sharing this `relative`
            box, so the overlay's `top-4`/`bottom-6` land relative to the
            map's own bounds, not the sticky bar or the whole fixed layer. */}
        <div className="relative min-h-0 flex-1">
          {/* `filterParams` makes this the viewport map: every listing
              matching the URL's filters inside the visible area, not just
              this page's 12 cards (see components/ListingsMap.js). */}
          {/* The phone map runs edge to edge; its controls float over it
              (MobileMapBar), kept above Google's logo and attribution line,
              which must stay visible. */}
          <div className={isMapView ? 'absolute inset-0 lg:static lg:h-full' : 'h-full'}>
            <ResponsiveMapPane
              listings={listings}
              filterParams={params}
              isMapView={isMapView}
              hoveredId={hoveredId}
              onMarkerHover={setHoveredId}
              onPreviewChange={setPreviewOpen}
              onAreaChange={onAreaChange}
              onInViewChange={setInView}
              openCardsRequest={cardsRequest}
              className="h-full w-full"
            />
          </div>
          {/* Phone map: the search floats over the full-height map. */}
          {isMapView ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-2.5 lg:hidden">
              <MobileMapChrome params={params} />
            </div>
          ) : null}
          {isMapView && !previewOpen ? <MobileMapBar inView={inView} onOpenCards={openCards} /> : null}
        </div>
      </div>
    </div>
  );
}
