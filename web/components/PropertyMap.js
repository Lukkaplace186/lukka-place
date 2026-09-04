'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { resolveListingLocation, KINSHASA_CENTER } from '@/lib/geocoding';
import { buildPricePinIcon } from '@/lib/mapIcons';
import { MAP_STYLES } from '@/lib/mapStyle';
import { NO_PHOTO_URL } from '@/lib/constants';
import { formatPrice, formatCdfCompact } from '@/lib/format';
import { usableImageSrc } from '@/lib/listingView';
import { convertToCdf } from '@/lib/currency';
import { useCdfRate } from '@/lib/CurrencyRateContext';
import { getCurrency } from '@/lib/currencyPreference';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Plain HTML string, not JSX — Google's InfoWindow renders outside React's
 * tree, so this can't use SafeImage/next/image; the onerror attribute below
 * is the same NO_PHOTO_URL fallback SafeImage uses, just implemented as a
 * raw DOM event handler instead of a React one. Every real field is HTML-
 * escaped (this text ultimately originates from agent WhatsApp submissions
 * — untrusted third-party input, not user-generated-content from a random
 * site visitor, but still never safe to interpolate unescaped).
 *
 * Currency: reads the visitor's USD/CDF preference once, at the moment the
 * marker is clicked and this content is built — not a live React
 * subscription, since this HTML string is handed to Google's InfoWindow and
 * never re-rendered by React. If the visitor flips CurrencyToggle while an
 * InfoWindow is already open, that one InfoWindow keeps showing what it was
 * built with until closed and reopened; every other price on the page
 * (which does use <Price>, a real subscription) updates immediately.
 */
function buildInfoWindowContent(listing, cdfPerUsd) {
  const currency = getCurrency();
  const price =
    currency === 'CDF'
      ? `≈ ${formatCdfCompact(convertToCdf(listing.price, cdfPerUsd)) ?? '—'} FC${listing.purpose === 'rent' ? ' / mois' : ''}`
      : formatPrice(listing.price, listing.purpose);
  // A bare Laravel filename (`default.jpg`) is not a resolvable URL — see
  // usableImageSrc(). In an InfoWindow it renders as a broken image rather
  // than crashing, but it is still a dead request every time a pin opens.
  const image = usableImageSrc(listing.featured_image) ? listing.featured_image : NO_PHOTO_URL;
  const spec = [
    listing.beds != null ? `${listing.beds} ch` : null,
    listing.bath != null ? `${listing.bath} sdb` : null,
    Number(listing.area) > 0 ? `${listing.area} m²` : null,
  ].filter(Boolean).join(' | ');
  const location = [listing.quartier, listing.commune].filter(Boolean).join(', ');

  return `
    <div style="width:220px;font-family:inherit;">
      <img
        src="${escapeHtml(image)}"
        onerror="this.onerror=null;this.src='${NO_PHOTO_URL}';"
        alt=""
        style="width:100%;height:120px;object-fit:cover;border-radius:6px 6px 0 0;display:block;"
      />
      <div style="padding:10px 6px 6px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#0B1120;">${escapeHtml(price)}</p>
        <p style="margin:4px 0 0;font-size:13px;font-weight:500;color:#2C3444;line-height:1.35;">${escapeHtml(listing.title)}</p>
        ${spec ? `<p style="margin:4px 0 0;font-size:12px;color:#5C6679;">${escapeHtml(spec)}</p>` : ''}
        ${location ? `<p style="margin:2px 0 0;font-size:12px;color:#5C6679;">${escapeHtml(location)}</p>` : ''}
        <a
          href="/listings/${encodeURIComponent(listing.id)}"
          style="display:inline-block;margin-top:8px;font-size:13px;font-weight:600;color:#16307E;text-decoration:none;"
        >
          Voir les détails →
        </a>
      </div>
    </div>
  `;
}

/**
 * Interactive property map (product task #55): real Google Maps rendering,
 * clustered markers, and an InfoWindow property-card preview on click.
 * Pin positions come from lib/geocoding.js's resolution pipeline (real
 * geocoded address → real commune centroid fallback → privacy jitter) —
 * never a fabricated coordinate. Listings that resolve to nothing (no
 * commune, geocoder totally unavailable) are silently skipped rather than
 * placed at a made-up point.
 */
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function PropertyMap({ listings, hoveredId, onMarkerHover, maxZoom }) {
  const { cdfPerUsd } = useCdfRate();
  const mapElementRef = useRef(null);
  const clustererRef = useRef(null);
  // id -> google.maps.Marker, rebuilt each time the main geocoding effect
  // runs. Read/written by the separate hover-only effect below, which must
  // never trigger a re-run of that effect (see its own comment).
  const markersRef = useRef(new Map());
  const previousHoveredRef = useRef(null);
  // Lazy initial state reflects a missing key immediately — no synchronous
  // setState-in-effect needed for that branch (the effect below just skips
  // its work entirely when the key is absent).
  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));
  const [resolvedTotal, setResolvedTotal] = useState({ resolved: 0, total: listings.length });

  useEffect(() => {
    if (!MAPS_API_KEY) {
      console.error('[PropertyMap] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set');
      return undefined;
    }

    let cancelled = false;
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });

    // Once these resolve, the classes are also on the global `google.maps`
    // namespace (per the loader's own docs) — used that way below since
    // @googlemaps/markerclusterer expects that global to already exist.
    Promise.all([importLibrary('maps'), importLibrary('geocoding'), importLibrary('marker')])
      .then(async () => {
        if (cancelled || !mapElementRef.current) return;

        const map = new google.maps.Map(mapElementRef.current, {
          center: KINSHASA_CENTER,
          zoom: 12,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          clickableIcons: false,
          styles: MAP_STYLES,
        });

        const geocoder = new google.maps.Geocoder();
        const infoWindow = new google.maps.InfoWindow();
        const bounds = new google.maps.LatLngBounds();
        const markers = [];
        markersRef.current = new Map();

        for (const listing of listings) {
          if (cancelled) break;

          // Sequential, not Promise.all — Google's client Geocoder self-throttles, and resolving one at a time keeps us well under its rate limit.
          const location = await resolveListingLocation({ listing, geocoder });
          console.log(
            `[PropertyMap] listing #${listing.id}: ${location.source}` +
              (location.source !== 'unresolved' ? ` (${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})` : ' — skipped, no pin'),
          );
          if (location.source === 'unresolved') continue;

          const position = { lat: location.lat, lng: location.lng };
          const marker = new google.maps.Marker({
            position,
            title: listing.title,
            icon: buildPricePinIcon({ price: listing.price, purpose: listing.purpose }),
          });
          marker.addListener('click', () => {
            infoWindow.setContent(buildInfoWindowContent(listing, cdfPerUsd));
            infoWindow.open({ map, anchor: marker });
          });
          // Map -> card hover-sync direction. The card -> map direction
          // (ListingCardVertical's onHoverStart/onHoverEnd) is handled by
          // the separate `hoveredId` effect below, never by re-running this
          // one — see that effect's comment for why.
          marker.addListener('mouseover', () => onMarkerHover?.(listing.id));
          marker.addListener('mouseout', () => onMarkerHover?.(null));

          markers.push(marker);
          markersRef.current.set(listing.id, marker);
          bounds.extend(position);
          setResolvedTotal((prev) => ({ ...prev, resolved: prev.resolved + 1 }));
        }

        if (cancelled) return;

        clustererRef.current = new MarkerClusterer({ map, markers });

        if (markers.length > 0) {
          map.fitBounds(bounds, 48);
          if (maxZoom != null) {
            google.maps.event.addListenerOnce(map, 'idle', () => {
              if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
            });
          }
          setStatus('ready');
        } else {
          setStatus('empty');
        }
      })
      .catch((err) => {
        console.error('[PropertyMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
    };
    // `listings` is the array from the current page's data fetch — a new
    // array reference each server render, which is exactly when the map
    // should re-resolve/re-render (new filters, new page of results).
    // `onMarkerHover` deliberately excluded: it's `setHoveredId` from
    // ListingsSplitView's useState, which React guarantees is referentially
    // stable — adding it here would risk re-running the sequential,
    // quota-sensitive geocoding loop if a future caller ever passed a
    // non-stable callback instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  // Card -> map hover-sync direction, deliberately its own effect: swapping
  // a marker's icon on hover must never touch the effect above, which would
  // re-run the sequential, quota-sensitive Geocoding API loop on every
  // mouse move. This effect only ever calls the cheap `setIcon`/`setZIndex`
  // on the two markers actually affected (the previous hover, the new one).
  useEffect(() => {
    const markers = markersRef.current;
    const previous = previousHoveredRef.current;

    if (previous != null && previous !== hoveredId && markers.has(previous)) {
      const listing = listings.find((l) => l.id === previous);
      if (listing) {
        const marker = markers.get(previous);
        marker.setIcon(buildPricePinIcon({ price: listing.price, purpose: listing.purpose }));
        marker.setZIndex(undefined);
      }
    }

    if (hoveredId != null && markers.has(hoveredId)) {
      const listing = listings.find((l) => l.id === hoveredId);
      if (listing) {
        const marker = markers.get(hoveredId);
        marker.setIcon(buildPricePinIcon({ price: listing.price, purpose: listing.purpose, hovered: true }));
        marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
      }
    }

    previousHoveredRef.current = hoveredId;
  }, [hoveredId, listings]);

  // No border/rounding of its own — every caller (the desktop split pane,
  // the mobile fullscreen overlay) already owns its own edge treatment, and
  // this used to double up with ListingsSplitView's own rounded-2xl wrapper.
  // Height is always the parent's — the previous `h-[70vh]` mobile fallback
  // pinned the map to 70% of the viewport regardless of what container it
  // sat in, which is exactly wrong for a fixed-fullscreen mobile map that
  // needs to fill an explicit top/bottom inset instead.
  return (
    <div className="relative h-full w-full overflow-hidden">
      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-white/90 text-sm text-ink-45">
          <p>Chargement de la carte...</p>
          {resolvedTotal.total > 0 && (
            <p className="text-xs text-ink-25">
              {resolvedTotal.resolved} / {resolvedTotal.total} biens localisés
            </p>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-sm text-ink-45">
          La carte n&apos;a pas pu se charger. Réessayez plus tard.
        </div>
      )}
      {status === 'empty' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-sm text-ink-45">
          Aucun bien de cette recherche n&apos;a pu être localisé sur la carte.
        </div>
      )}
      <div ref={mapElementRef} className="h-full w-full" />
    </div>
  );
}
