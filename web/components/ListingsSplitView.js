'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/LocaleLink';
import { useRouter } from 'next/navigation';
import { ChevronLeft, MapPinned } from 'lucide-react';
import PropertyCard from './PropertyCard';
import ListingsFeed from './ListingsFeed';
import SidebarInsights from './SidebarInsights';
import ResponsiveMapPane from './ResponsiveMapPane';
import MobileMapChrome from './MobileMapChrome';
import MobileMapBar from './MobileMapBar';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { boundsToQuery } from '@/lib/mapViewport';
import { MAP_MOVING_EVENT } from '@/lib/mapMovingEvent';
import { useT } from '@/lib/i18n/client';

function buildPageHref(searchParams, page) {
  const params = new URLSearchParams(searchParams);
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  const qs = params.toString();
  return qs ? `/listings?${qs}` : '/listings';
}

/**
 * The search the feed extends, as a query string: every filter, without the
 * page (the feed's cursor replaces it) or the map/list view (switching views
 * is the same search, so it must not restart the feed).
 */
function feedQueryString(searchParams) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (key === 'page' || key === 'view' || key === 'cursor') continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (typeof v === 'string' && v !== '') qs.append(key, v);
    }
  }
  return qs.toString();
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
 * Desktop map sticks at top-16 (flush under the fixed h-16 Header) and is
 * 100vh - 4rem tall, so it runs from the header to the viewport bottom.
 * It used to stick at 8.5rem to clear FilterBar, but on /listings the
 * FilterBar's sticky box is only as tall as its own wrapper and scrolls
 * away (measured live 2026-09-25), which left a 72px gap above a map that
 * stopped 1.5rem short of the bottom.
 */
export default function ListingsSplitView({
  listings, isMapView, page, params, popularCommunes, communes, clearAreaHref = null, similar = null, nextCursor = null, propertyTypes = [],
}) {
  const t = useT();
  const queryString = feedQueryString(params);
  const feedKey = `${queryString}#${page}`;
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

  // The phone's liquid-glass search panel slides away while the visitor drags
  // or pinches the map, for a clear view, and comes back once the map has
  // settled (owner, 2026-11-17; lib/mapMovingEvent.js). It stays while they
  // are typing in it, and the short wait stops it flickering between gestures.
  const [glassAway, setGlassAway] = useState(false);
  useEffect(() => {
    if (!isMapView) return undefined;
    let timer = null;
    const onMoving = (event) => {
      clearTimeout(timer);
      if (event.detail?.moving) {
        const typing = document.activeElement?.closest?.('[data-map-glass]');
        if (!typing) setGlassAway(true);
      } else {
        timer = setTimeout(() => setGlassAway(false), 250);
      }
    };
    window.addEventListener(MAP_MOVING_EVENT, onMoving);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(MAP_MOVING_EVENT, onMoving);
      setGlassAway(false);
    };
  }, [isMapView]);

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
        {/* Endless feed (components/ListingsFeed.js, lib/listingsFeed.js):
            the exact results, then — for a place search — the nearby ones
            under their own heading. Keyed on the search, so a new search
            starts over while the map beside it stays mounted. */}
        {page > 1 ? (
          // Reached from a "Voir plus" link without JavaScript, or an old
          // shared ?page= link: a way back to the start of the list.
          <Link href={buildPageHref(params, 1)} className={`${pagerLink} mb-4`}>
            <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('common.actions.previous')}
          </Link>
        ) : null}
        <ListingsFeed
          key={feedKey}
          feedKey={feedKey}
          queryString={queryString}
          initialListings={listings}
          initialSimilar={similar}
          initialNext={nextCursor}
          place={params.commune || null}
          renderCard={(listing, i) => (
            <PropertyCard
              key={listing.id}
              listing={listing}
              layout="horizontal"
              // Single column, so only the first couple of rows are ever
              // above the fold — priority for those skips next/image's
              // lazy-loading for the real LCP candidate on this page.
              priority={page === 1 && i < 2}
              isHovered={hoveredId === listing.id}
              onHoverStart={() => setHoveredId(listing.id)}
              onHoverEnd={() => setHoveredId((current) => (current === listing.id ? null : current))}
            />
          )}
        />

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
          of correction as the desktop sticky offset. That bar
          is gone entirely now (see app/(site)/layout.js), so there is
          nothing left to clear; MobileMapBar's own "Liste" button
          (`absolute bottom-6` *within* this box) already follows this
          box's real bottom edge automatically. */}
      <div
        data-map-layer
        className={`flex flex-col ${
          isMapView
            // top-0: the logo bar steps aside on the phone map (2026-11-17,
            // app/globals.css [data-site-header]); its ☰ is in the glass header.
            ? 'fixed inset-x-0 top-0 bottom-0 z-30 bg-canvas'
            : 'hidden'
        } lg:inset-auto lg:z-auto lg:flex lg:overflow-hidden lg:rounded-2xl lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)]`}
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
          {/* Phone map: search + Prix / Chambres / Type on a liquid-glass
              panel floating over the map (2026-11-17, owner), so the pins
              under it still show through. It was a solid row above the map
              earlier the same day, and before that an opaque float that hid
              the busiest pins. z-30: the search's suggestions open over the
              map. */}
          {isMapView ? (
            <div
              data-map-glass
              data-away={glassAway ? 'true' : 'false'}
              className="lkp-glass-wrap pointer-events-none absolute inset-x-0 top-0 z-30 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden"
            >
              <div className="u-liquid-glass pointer-events-auto rounded-[22px] px-2.5 pb-2 pt-2.5">
                <MobileMapChrome params={params} propertyTypes={propertyTypes} />
              </div>
            </div>
          ) : null}
          {isMapView && !previewOpen ? <MobileMapBar inView={inView} onOpenCards={openCards} /> : null}
        </div>
      </div>
    </div>
  );
}
