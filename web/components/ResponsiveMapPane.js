'use client';

import { useCallback, useEffect, useState } from 'react';
import PropertyMap from './PropertyMap';
import ListingsMap from './ListingsMap';
import BuildingUnitsDrawer from './BuildingUnitsDrawer';
import MapListingPreview from './MapListingPreview';

/**
 * Mounts a map only when it's actually going to be seen: on desktop
 * (>=1024px, the split-screen breakpoint — see app/listings/page.js) it's
 * always visible, on mobile only when the user has switched to the Carte
 * view. A plain `hidden lg:block` on the map directly would keep it mounted
 * — loading the Maps JS API and, on /listings, fetching markers for the
 * viewport — even while CSS-hidden on a mobile visitor who never opens the
 * map. Deciding client-side after mount (matchMedia) means a one-frame
 * placeholder instead of a server/client hydration mismatch, which is the
 * correct tradeoff here.
 *
 * Two maps, one pane:
 *   - `filterParams` given (/listings) → ListingsMap, the viewport map: every
 *     listing matching those URL filters inside the visible area, fetched as
 *     the visitor pans. `listings` is then only the list page's own cards,
 *     used to open a preview without a round trip.
 *   - no `filterParams` (the detail page) → PropertyMap, which plots exactly
 *     the `listings` it is given.
 *
 * `listingPreview={false}` turns off the pin preview card — the detail page's
 * single-listing map, where the card would only link to the page already open.
 * `onPreviewChange(open)` lets a caller move its own chrome out of the card's
 * way (ListingsSplitView hides the mobile "Liste" button behind it).
 */
export default function ResponsiveMapPane({
  listings, filterParams, isMapView, hoveredId, onMarkerHover, className, maxZoom, listingPreview = true, onPreviewChange,
}) {
  const [shouldRender, setShouldRender] = useState(false);
  // The multi-unit building whose unit list is open, or null. Held here
  // rather than inside the map because the drawer must render OUTSIDE the
  // map element — Google owns that subtree and repaints it freely.
  const [openBuilding, setOpenBuilding] = useState(null);
  // The single listing whose preview card is open, or null — same reason.
  const [selectedListing, setSelectedListing] = useState(null);

  // Stable identity: both maps register these once on Google's listeners, and
  // PropertyMap deliberately excludes them from its geocoding effect's deps.
  const closeBuilding = useCallback(() => setOpenBuilding(null), []);
  const closePreview = useCallback(() => setSelectedListing(null), []);

  // A filter change swaps the listings out from under an open drawer, which
  // would otherwise keep showing units no longer in the results. Adjusted
  // during render rather than in an effect — React's own documented pattern
  // for resetting state when a prop changes; an effect here would render the
  // stale drawer once before clearing it.
  const [renderedListings, setRenderedListings] = useState(listings);
  if (listings !== renderedListings) {
    setRenderedListings(listings);
    setOpenBuilding(null);
    setSelectedListing(null);
  }

  // Telling the PARENT is an effect, not a call during render: setting
  // another component's state while this one renders is the warning React
  // raises for exactly that.
  const previewOpen = Boolean(selectedListing);
  useEffect(() => {
    onPreviewChange?.(previewOpen);
  }, [previewOpen, onPreviewChange]);

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const update = () => setShouldRender(mql.matches || isMapView);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [isMapView]);

  // The selected pin keeps the highlighted icon while its card is open, so
  // the card visibly belongs to one price tag.
  const highlightedId = hoveredId ?? selectedListing?.id ?? null;

  return (
    <div className={`relative ${className || ''}`}>
      {shouldRender ? (
        <>
          {filterParams ? (
            <ListingsMap
              params={filterParams}
              pageListings={listings}
              hoveredId={highlightedId}
              onMarkerHover={onMarkerHover}
              onBuildingSelect={setOpenBuilding}
              onListingSelect={listingPreview ? setSelectedListing : undefined}
            />
          ) : (
            <PropertyMap
              listings={listings}
              hoveredId={highlightedId}
              onMarkerHover={onMarkerHover}
              maxZoom={maxZoom}
              onBuildingSelect={setOpenBuilding}
              onListingSelect={listingPreview ? setSelectedListing : undefined}
            />
          )}
          {listingPreview ? (
            <MapListingPreview key={selectedListing?.id ?? 'none'} listing={selectedListing} onClose={closePreview} />
          ) : null}
          <BuildingUnitsDrawer group={openBuilding} onClose={closeBuilding} />
        </>
      ) : (
        <div className="h-full w-full bg-canvas-alt" />
      )}
    </div>
  );
}
