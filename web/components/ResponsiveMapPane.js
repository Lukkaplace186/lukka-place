'use client';

import { useEffect, useState } from 'react';
import PropertyMap from './PropertyMap';

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

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const update = () => setShouldRender(mql.matches || isMapView);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [isMapView]);

  return (
    <div className={className}>
      {shouldRender ? (
        <PropertyMap listings={listings} hoveredId={hoveredId} onMarkerHover={onMarkerHover} maxZoom={maxZoom} />
      ) : (
        <div className="h-full w-full bg-canvas-alt" />
      )}
    </div>
  );
}
