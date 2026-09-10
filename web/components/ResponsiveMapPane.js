'use client';

import { useCallback, useEffect, useState } from 'react';
import PropertyMap from './PropertyMap';
import BuildingUnitsDrawer from './BuildingUnitsDrawer';

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
 */
export default function ResponsiveMapPane({ listings, isMapView, hoveredId, onMarkerHover, className, maxZoom }) {
  const [shouldRender, setShouldRender] = useState(false);
  // The multi-unit building whose unit list is open, or null. Held here
  // rather than inside PropertyMap because the drawer must render OUTSIDE
  // the map element — Google owns that subtree and repaints it freely.
  const [openBuilding, setOpenBuilding] = useState(null);

  // Stable identity: PropertyMap deliberately excludes this from its
  // geocoding effect's deps, and an inline arrow here would make that
  // exclusion the only thing preventing a full re-geocode on every render.
  const closeBuilding = useCallback(() => setOpenBuilding(null), []);

  // A filter change swaps the listings out from under an open drawer, which
  // would otherwise keep showing units no longer in the results. Adjusted
  // during render rather than in an effect — React's own documented pattern
  // for resetting state when a prop changes; an effect here would render the
  // stale drawer once before clearing it.
  const [renderedListings, setRenderedListings] = useState(listings);
  if (listings !== renderedListings) {
    setRenderedListings(listings);
    setOpenBuilding(null);
  }

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
            hoveredId={hoveredId}
            onMarkerHover={onMarkerHover}
            maxZoom={maxZoom}
            onBuildingSelect={setOpenBuilding}
          />
          <BuildingUnitsDrawer group={openBuilding} onClose={closeBuilding} />
        </>
      ) : (
        <div className="h-full w-full bg-canvas-alt" />
      )}
    </div>
  );
}
