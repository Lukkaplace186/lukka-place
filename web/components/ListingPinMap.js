'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { baseMapOptions } from '@/lib/mapBase';
import { placeResolvedListings } from '@/lib/geocoding';
import { PRIVACY_RADIUS_M } from '@/lib/listingPin';
import { useT } from '@/lib/i18n/client';
import { Info } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
/** The listing's immediate neighbourhood — streets and quartier names readable. */
export const LISTING_MAP_ZOOM = 14;

/**
 * The detail page's map (2026-10-23, owner's choice): only the approximate
 * zone, a pale circle of PRIVACY_RADIUS_M, and a "Zone approximative" chip
 * in the corner. No pin, no symbol, no label: nothing that claims a spot.
 * No price either — the page shows it above and in the bottom bar. Zoom 14,
 * centred on the circle.
 *
 * The centre is the same privacy-jittered point the listing has on /listings
 * (placeResolvedListings, seeded by the id; 200–400 m from the stored
 * coordinate), and the circle is wider than that jitter, so the real spot is
 * always inside it. `position` is the stored coordinate; the caller only
 * mounts this component when it has one.
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
    let zone = null;
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
        // The approximate zone. Colours are the earlier navy, kept on product
        // direction; the Maps API cannot read CSS variables.
        zone = new google.maps.Circle({
          map,
          center: point,
          radius: PRIVACY_RADIUS_M,
          strokeColor: '#1e3a8a',
          strokeOpacity: 0.35,
          strokeWeight: 1,
          fillColor: '#1e3a8a',
          fillOpacity: 0.1,
          clickable: false,
        });
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[ListingPinMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      zone?.setMap(null);
    };
  }, [listing, position]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={mapElementRef} className="h-full w-full" />
      {status === 'ready' ? (
        // Bottom-left would cover Google's logo, which must stay visible.
        <span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.75rem] font-semibold text-ink shadow-sm">
          <Info strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-blue" aria-hidden="true" />
          {t('listings.map.zoneApprox')}
        </span>
      ) : null}
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
