'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { resolveListingBase, placeResolvedListings } from '@/lib/geocoding';
import { buildPricePinIcon, buildBuildingPinIcon, priceZIndex } from '@/lib/mapIcons';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { groupListingsByBuilding, buildingPinLabel } from '@/lib/buildingGroups';
import { baseMapOptions } from '@/lib/mapBase';
import { useT } from '@/lib/i18n/client';

/**
 * Interactive property map (product task #55): real Google Maps rendering
 * and price-tag markers. Clicking a price pin calls `onListingSelect`, and
 * the caller renders the preview card (MapListingPreview) beside the map —
 * this used to be a Google InfoWindow built from an HTML string, which could
 * not reach React at all and shipped a literal `{t('listings.map.viewDetails')}`
 * as its link text. Clicking the bare map calls `onListingSelect(null)`.
 * Pin positions come from lib/geocoding.js's resolution pipeline (real
 * geocoded address → real commune centroid fallback → privacy jitter) —
 * never a fabricated coordinate. Listings that resolve to nothing (no
 * commune, geocoder totally unavailable) are silently skipped rather than
 * placed at a made-up point.
 */
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

export default function PropertyMap({ listings, hoveredId, onMarkerHover, maxZoom, onBuildingSelect, onListingSelect }) {
  const t = useT();
  const mapElementRef = useRef(null);
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
    // namespace (per the loader's own docs), which is how they are used
    // below and inside lib/mapIcons.js. (This used to be justified by
    // @googlemaps/markerclusterer needing that global; clustering is gone,
    // but the global is still the API surface the rest of this file uses.)
    Promise.all([importLibrary('maps'), importLibrary('geocoding'), importLibrary('marker')])
      .then(async () => {
        if (cancelled || !mapElementRef.current) return;

        // Gesture handling, zoom buttons and the basemap style are shared
        // with the /listings map — see lib/mapBase.js for why touch and
        // desktop differ.
        const map = new google.maps.Map(mapElementRef.current, baseMapOptions());

        const geocoder = new google.maps.Geocoder();
        // Tapping the bare map dismisses an open preview card. Marker clicks
        // do not propagate to the map, so this never closes the card a pin
        // tap has just opened.
        map.addListener('click', () => onListingSelect?.(null));
        const bounds = new google.maps.LatLngBounds();
        const markers = [];
        markersRef.current = new Map();

        // Three passes, and the split is load-bearing rather than tidiness.
        // Nothing about where a pin ENDS UP can be decided one listing at a
        // time: both the co-location fan (placeResolvedListings) and the
        // final de-overlap pass (spreadColocatedPins) need to see which
        // listings share a spot, which is only knowable once every base
        // point is in. Resolution itself is still sequential, so the
        // "X / Y biens localisés" progress advances as it goes.
        //
        // Pass 1 — resolve each listing to its REAL, un-jittered point.
        //
        // Grouped FIRST, because units of one building genuinely share an
        // address: geocoding them separately would spend N calls to get the
        // same point N times, and then lib/mapPinSpread.js would fan them
        // apart into N buildings that do not exist. One group, one pin.
        const groups = groupListingsByBuilding(listings);

        const bases = [];
        for (const group of groups) {
          if (cancelled) break;

          const listing = group.representative;
          // Sequential, not Promise.all — Google's client Geocoder self-throttles, and resolving one at a time keeps us well under its rate limit.
          const base = await resolveListingBase({ listing, geocoder });
          if (!base) {
            console.log(`[PropertyMap] listing #${listing.id}: unresolved — skipped, no pin`);
            continue;
          }

          console.log(
            `[PropertyMap] listing #${listing.id}: ${base.source} (${base.lat.toFixed(5)}, ${base.lng.toFixed(5)})` +
              (base.query ? ` via "${base.query}"` : ''),
          );
          bases.push({ id: listing.id, listing, base, group });
          setResolvedTotal((prev) => ({ ...prev, resolved: prev.resolved + 1 }));
        }

        if (cancelled) return;

        // Pass 2 — privacy jitter, with listings sharing a base point fanned
        // onto a ring around it instead of each hopping off in an
        // independently random direction.
        const placements = placeResolvedListings(bases);
        const resolved = [];
        for (const { listing, group } of bases) {
          const placement = placements.get(listing.id);
          if (!placement) continue;
          if (placement.colocated) {
            console.log(
              `[PropertyMap] listing #${listing.id}: 1 of ${placement.groupSize} at the same spot — offset to (${placement.lat.toFixed(5)}, ${placement.lng.toFixed(5)})`,
            );
          }
          resolved.push({ listing, group, lat: placement.lat, lng: placement.lng });
        }

        // Pass 3 — the last-resort de-overlap net, for the case where two
        // independent base points happen to jitter onto each other anyway.
        const positions = spreadColocatedPins(
          resolved.map(({ listing, lat, lng }) => ({ id: listing.id, lat, lng })),
        );

        for (const { listing, group } of resolved) {
          const placed = positions.get(listing.id);
          if (!placed) continue;
          const position = { lat: placed.lat, lng: placed.lng };

          // `map` is passed straight to the constructor now. It used to be
          // omitted because MarkerClusterer owned adding and removing
          // markers from the map; with clustering gone, every marker has to
          // put itself on the map and take itself off again (see cleanup).
          const marker = new google.maps.Marker({
            map,
            position,
            title: group.isBuilding ? (group.buildingName || listing.title) : listing.title,
            icon: group.isBuilding
              ? buildBuildingPinIcon({ label: buildingPinLabel(group) })
              : buildPricePinIcon({ listing }),
            // A building stands for several listings, so it should not be
            // buried under the single most expensive pin beside it.
            zIndex: group.isBuilding ? priceZIndex(group.priceMax) + 1 : priceZIndex(listing.price),
          });
          marker.addListener('click', () => {
            // A building opens the unit list rather than a preview card: the
            // whole point is that there is no single listing to preview.
            if (group.isBuilding) {
              onListingSelect?.(null);
              onBuildingSelect?.(group);
              return;
            }
            onListingSelect?.(listing);
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
        }

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
      // MarkerClusterer.clearMarkers() used to do this. Without it, a
      // re-run (new filters, new page of results) would leave every
      // previous marker on the map and stack stale price tags on top of
      // the current ones.
      for (const marker of markersRef.current.values()) marker.setMap(null);
      markersRef.current = new Map();
    };
    // `listings` is the array from the current page's data fetch — a new
    // array reference each server render, which is exactly when the map
    // should re-resolve/re-render (new filters, new page of results).
    // `onMarkerHover` deliberately excluded: it's `setHoveredId` from
    // ListingsSplitView's useState, which React guarantees is referentially
    // stable — adding it here would risk re-running the sequential,
    // quota-sensitive geocoding loop if a future caller ever passed a
    // non-stable callback instead.
    // `onBuildingSelect` and `onListingSelect` are excluded for the same reason as `onMarkerHover`:
    // re-running this effect replays the entire sequential Geocoding loop, and
    // a caller passing an inline arrow would do that on every render.
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
        marker.setIcon(buildPricePinIcon({ listing }));
        marker.setZIndex(undefined);
      }
    }

    if (hoveredId != null && markers.has(hoveredId)) {
      const listing = listings.find((l) => l.id === hoveredId);
      if (listing) {
        const marker = markers.get(hoveredId);
        marker.setIcon(buildPricePinIcon({ listing, hovered: true }));
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
          <p>{t('listings.map.loading')}</p>
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
