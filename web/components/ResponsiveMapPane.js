'use client';

import { useCallback, useEffect, useState } from 'react';
import PropertyMap from './PropertyMap';
import BuildingUnitsDrawer from './BuildingUnitsDrawer';
import MapListingPreview from './MapListingPreview';

/**
 * Mounts PropertyMap only when it's actually going to be seen: on desktop
 * (>=1024px, the split-screen breakpoint — see app/listings/page.js) it's
 * always visible, on mobile only when the user has switched to the Carte
 * view. A plain `hidden lg:block` on <PropertyMap> directly would keep it
 * mounted (and its effect — sequential client-side geocoding of every
 * listing, see lib/geocoding.js — running) even while CSS-hidden on a
 * mobile visitor who never opens the map, silently burning through the
 * Geocoding API's real request quota for nothing. Deciding client-side
 * after mount (matchMedia) means a one-frame placeholder instead of a
 * server/client hydration mismatch, which is the correct tradeoff here.
 *
 * `listingPreview={false}` turns off the pin preview card — the detail page's
 * single-listing map, where the card would only link to the page already open.
 * `onPreviewChange(open)` lets a caller move its own chrome out of the card's
 * way (ListingsSplitView hides the mobile "Liste" button behind it).
 */
export default function ResponsiveMapPane({
  listings, isMapView, hoveredId, onMarkerHover, className, maxZoom, listingPreview = true, onPreviewChange,
}) {
  const [shouldRender, setShouldRender] = useState(false);
  // The multi-unit building whose unit list is open, or null. Held here
  // rather than inside PropertyMap because the drawer must render OUTSIDE
  // the map element — Google owns that subtree and repaints it freely.
  const [openBuilding, setOpenBuilding] = useState(null);
  // The single listing whose preview card is open, or null — same reason.
  const [selectedListing, setSelectedListing] = useState(null);

  // Stable identity: PropertyMap deliberately excludes these from its
  // geocoding effect's deps, and an inline arrow here would make that
  // exclusion the only thing preventing a full re-geocode on every render.
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

  return (
    <div className={`relative ${className || ''}`}>
      {shouldRender ? (
        <>
          <PropertyMap
            listings={listings}
            // The selected pin keeps the highlighted icon while its card is
            // open, so the card visibly belongs to one price tag.
            hoveredId={hoveredId ?? selectedListing?.id ?? null}
            onMarkerHover={onMarkerHover}
            maxZoom={maxZoom}
            onBuildingSelect={setOpenBuilding}
            onListingSelect={listingPreview ? setSelectedListing : undefined}
          />
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
