'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { createPinLayer } from '@/lib/mapPinLayer';
import { baseMapOptions } from '@/lib/mapBase';
import { placeResolvedListings } from '@/lib/geocoding';
import { formatPrice } from '@/lib/format';
import { PIN_ICONS, pinKind } from '@/lib/listingPin';
import { useT } from '@/lib/i18n/client';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
/** The listing's immediate neighbourhood — streets and quartier names readable. */
export const LISTING_MAP_ZOOM = 14;

/**
 * The detail page's map (2026-09-28): this one listing, as a big royal-blue
 * pill carrying a symbol for what it is (an apartment building, a house, a
 * plot — lib/listingPin.js) and its full price, at zoom 14.
 *
 * The pin sits on the same privacy-jittered point it has on /listings
 * (placeResolvedListings, seeded by the listing id), so the two maps agree.
 * `position` is the listing's stored coordinate; the caller only mounts this
 * component when it has one.
 */
export default function ListingPinMap({ listing, position }) {
  const t = useT();
  const mapElementRef = useRef(null);
  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));

  useEffect(() => {
    if (!MAPS_API_KEY) {
      console.error('[ListingPinMap] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set');
      return undefined;
    }
    let cancelled = false;
    let layer = null;
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });

    importLibrary('maps')
      .then(() => {
        if (cancelled || !mapElementRef.current) return;
        const placed = placeResolvedListings([
          { id: listing.id, base: { lat: position.lat, lng: position.lng, source: 'existing', precise: true } },
        ]).get(listing.id) || position;
        const point = { lat: placed.lat, lng: placed.lng };

        const map = new google.maps.Map(mapElementRef.current, {
          ...baseMapOptions(),
          center: point,
          zoom: LISTING_MAP_ZOOM,
        });
        layer = createPinLayer(map, { onClick: () => {}, onHover: () => {} });
        layer.setPins([
          {
            key: `listing-${listing.id}`,
            id: String(listing.id),
            lat: point.lat,
            lng: point.lng,
            label: formatPrice(listing.price, listing.purpose, listing.price_period),
            title: listing.title || '',
            building: false,
            verified: listing.verified_at != null,
            zIndex: 0,
            variant: 'featured',
            icon: PIN_ICONS[pinKind(listing)],
          },
        ]);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[ListingPinMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      layer?.destroy();
    };
  }, [listing, position]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mapElementRef} className="h-full w-full" />
      {status === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas-alt text-sm text-ink-45">
          {t('listings.map.loading')}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface p-6 text-center text-sm text-ink-45">
          {t('listings.map.loadError')}
        </div>
      ) : null}
    </div>
  );
}
