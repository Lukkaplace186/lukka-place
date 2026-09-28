'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { baseMapOptions } from '@/lib/mapBase';
import { placeResolvedListings } from '@/lib/geocoding';
import { PIN_ICONS, pinKind, pointLabel, PRIVACY_RADIUS_M } from '@/lib/listingPin';
import { useT } from '@/lib/i18n/client';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
/** The listing's immediate neighbourhood — streets and quartier names readable. */
export const LISTING_MAP_ZOOM = 14;

/**
 * The detail page's map (2026-09-28), Rightmove-style: one round navy point
 * with a symbol for the property type (lib/listingPin.js), a soft pulse, the
 * commune on a small pill under it, and a pale disc of PRIVACY_RADIUS_M — the
 * approximate zone. No price on the map: the page shows it above and in the
 * bottom bar. Zoom 14, centred on the point.
 *
 * The point is the same privacy-jittered point the listing has on /listings
 * (placeResolvedListings, seeded by the id; 200–400 m from the stored
 * coordinate), and the disc is wider than that jitter, so the real spot is
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
    let overlay = null;
    let circle = null;
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
        // The approximate zone, under everything.
        circle = new google.maps.Circle({
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

        class PointOverlay extends google.maps.OverlayView {
          onAdd() {
            this.el = document.createElement('div');
            this.el.className = 'lkp-point';
            const pulse = document.createElement('span');
            pulse.className = 'lkp-point__pulse';
            const dot = document.createElement('span');
            dot.className = 'lkp-point__dot';
            dot.setAttribute('role', 'img');
            dot.setAttribute('aria-label', listing.title || '');
            dot.innerHTML = PIN_ICONS[pinKind(listing)];
            this.el.append(pulse, dot);
            const text = pointLabel(listing);
            if (text) {
              const label = document.createElement('span');
              label.className = 'lkp-point__label';
              label.textContent = text;
              this.el.append(label);
            }
            this.getPanes().overlayLayer.appendChild(this.el);
          }
          draw() {
            const at = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(point.lat, point.lng));
            if (at && this.el) this.el.style.transform = `translate3d(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px, 0)`;
          }
          onRemove() {
            this.el?.remove();
            this.el = null;
          }
        }
        overlay = new PointOverlay();
        overlay.setMap(map);
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[ListingPinMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      overlay?.setMap(null);
      circle?.setMap(null);
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
