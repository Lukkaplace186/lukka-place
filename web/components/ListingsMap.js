'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MarkerClusterer, SuperClusterAlgorithm } from '@googlemaps/markerclusterer';
import { placeResolvedListings, KINSHASA_CENTER } from '@/lib/geocoding';
import { buildPricePinIcon, buildBuildingPinIcon, buildClusterIcon, priceZIndex } from '@/lib/mapIcons';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { groupListingsByBuilding, buildingPinLabel } from '@/lib/buildingGroups';
import { baseMapOptions } from '@/lib/mapBase';
import {
  FETCH_DEBOUNCE_MS,
  boundsContain,
  boundsToQuery,
  boundsWithin,
  locationGeocodeQueries,
  locationTarget,
  mapFilterQuery,
  padBounds,
} from '@/lib/mapViewport';
import { useT } from '@/lib/i18n/client';

/**
 * The /listings map, Rightmove / Zillow style: every listing matching the
 * active filters inside the visible area, re-fetched whenever the map comes to
 * rest — never just the 12 cards of the list page beside it.
 *
 * - **Data** comes from GET /api/listings/map (lib/listings.js getMapMarkers):
 *   lightweight markers for the padded viewport. A pan that stays inside the
 *   area already fetched costs no request; one that leaves it waits
 *   FETCH_DEBOUNCE_MS for the map to settle, and aborts whatever was still in
 *   flight.
 * - **Opening view.** A search naming a place (commune, quartier) opens on
 *   that place's real geocoded viewport; the visitor can then pan out and the
 *   other filters keep applying to the wider area. A search naming none opens
 *   on the box around everything that matches. Changing a non-location filter
 *   keeps the view where the visitor left it.
 * - **Clustering** (@googlemaps/markerclusterer) folds dense pins into a
 *   count bubble when zoomed out; past CLUSTER_MAX_ZOOM every pin is its own
 *   price tag again. The count is listings, so a building pin counts its units.
 * - **Positions** are the stored coordinates, or the commune centroid for a
 *   listing without them — both jittered and fanned exactly as before
 *   (lib/geocoding.js placeResolvedListings), so nothing about privacy or
 *   co-location changed. No client-side geocoding of listings happens here at
 *   all any more; the only geocoder call is for the opening view of a place.
 * - **Honesty.** The badge states how many listings are in view, how many sit
 *   on a commune centroid, and how many match but cannot be placed at all.
 *
 * Tapping a pin opens MapListingPreview through `onListingSelect`. The marker
 * payload has no photos, so the full listing comes from the list page when it
 * is one of those 12, and from /api/listings?ids= otherwise.
 */
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** Clusters break apart into individual price tags above this zoom. */
const CLUSTER_MAX_ZOOM = 15;
/** Opening on a place never zooms in past a neighbourhood. */
const MAX_FIT_ZOOM = 15;
/** A "place" wider than this many degrees is the city, not the quartier asked for. */
const MAX_PLACE_SPAN_DEG = 0.35;

/** Geocoded viewports of named places, per tab — a place does not move. */
const placeViewportCache = new Map();
/** Listings behind each marker, for cluster counts. */
const markerUnits = new WeakMap();

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function toBounds(latLngBounds) {
  const ne = latLngBounds.getNorthEast();
  const sw = latLngBounds.getSouthWest();
  return { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() };
}

function iconFor(group, hovered) {
  return group.isBuilding
    ? buildBuildingPinIcon({ label: buildingPinLabel(group), hovered })
    : buildPricePinIcon({ listing: group.representative, hovered });
}

function zIndexFor(group) {
  // A building stands for several listings, so it should not be buried under
  // the single most expensive pin beside it.
  return group.isBuilding ? priceZIndex(group.priceMax) + 1 : priceZIndex(group.representative.price);
}

function geocodeOnce(geocoder, address) {
  return new Promise((resolve) => {
    geocoder.geocode({ address, region: 'cd' }, (results, status) => {
      resolve(status === 'OK' ? results?.[0] ?? null : null);
    });
  });
}

/** The real viewport Google holds for a named place, most specific query first. */
async function geocodePlace(geocoder, target) {
  for (const query of locationGeocodeQueries(target)) {
    if (!placeViewportCache.has(query)) {
      const result = geocoder ? await geocodeOnce(geocoder, query) : null;
      const area = result?.geometry?.viewport || result?.geometry?.bounds;
      let viewport = area ? toBounds(area) : null;
      if (viewport && (viewport.north - viewport.south > MAX_PLACE_SPAN_DEG || viewport.east - viewport.west > MAX_PLACE_SPAN_DEG)) {
        viewport = null;
      }
      placeViewportCache.set(query, viewport);
    }
    const cached = placeViewportCache.get(query);
    if (cached) return cached;
  }
  return null;
}

async function fetchExtent(filterQuery) {
  try {
    const qs = new URLSearchParams(filterQuery);
    qs.set('extent', '1');
    const response = await fetch(`/api/listings/map?${qs}`);
    if (!response.ok) return null;
    const body = await response.json();
    return body.extent ? padBounds(body.extent, 0.08) : null;
  } catch (err) {
    console.error('[ListingsMap] extent fetch failed', err);
    return null;
  }
}

function fitTo(map, bounds) {
  if (!bounds) {
    map.setCenter(KINSHASA_CENTER);
    map.setZoom(12);
    return;
  }
  // One listing, or several on one point: a zero-size box would zoom to the street.
  if (bounds.north - bounds.south < 0.004 && bounds.east - bounds.west < 0.004) {
    map.setCenter({ lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 });
    map.setZoom(MAX_FIT_ZOOM - 1);
    return;
  }
  map.fitBounds(
    new google.maps.LatLngBounds({ lat: bounds.south, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }),
    32,
  );
  google.maps.event.addListenerOnce(map, 'idle', () => {
    if (map.getZoom() > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM);
  });
}

export default function ListingsMap({ params, pageListings, hoveredId, onMarkerHover, onListingSelect, onBuildingSelect }) {
  const t = useT();
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const clustererRef = useRef(null);
  const geocoderRef = useRef(null);
  // group key -> { marker, group, signature, lat, lng }
  const entriesRef = useRef(new Map());
  // listing id -> marker data, for the in-view counts
  const markerDataRef = useRef(new Map());
  const requestRef = useRef({ controller: null, timer: null, fetched: null, filterQuery: null, targetKey: null, positioning: false });
  const hoveredRef = useRef(null);
  const selectSeqRef = useRef(0);
  // Google listeners are registered once; they read the latest props from here.
  const propsRef = useRef({});

  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));
  const [mapReady, setMapReady] = useState(false);
  const [view, setView] = useState({ loaded: false, inView: 0, approximate: 0, unlocated: 0, truncated: false, fetching: false, failed: false });

  const filterQuery = useMemo(() => mapFilterQuery(params), [params]);

  useEffect(() => {
    propsRef.current = { pageListings, onMarkerHover, onListingSelect, onBuildingSelect, t };
  });

  const updateCounts = useCallback((viewport) => {
    let inView = 0;
    let approximate = 0;
    for (const marker of markerDataRef.current.values()) {
      if (!boundsContain(viewport, marker)) continue;
      inView += 1;
      if (marker.approximate) approximate += 1;
    }
    setView((v) => (v.inView === inView && v.approximate === approximate ? v : { ...v, inView, approximate }));
  }, []);

  const applyHover = useCallback((id) => {
    const find = (target) => {
      if (target == null) return null;
      for (const entry of entriesRef.current.values()) {
        if (!entry.group.isBuilding && sameId(entry.group.representative.id, target)) return entry;
      }
      return null;
    };
    const previousId = hoveredRef.current;
    if (!sameId(previousId, id)) {
      const previous = find(previousId);
      if (previous) {
        previous.marker.setIcon(iconFor(previous.group, false));
        previous.marker.setZIndex(zIndexFor(previous.group));
      }
    }
    const current = find(id);
    if (current) {
      current.marker.setIcon(iconFor(current.group, true));
      current.marker.setZIndex(google.maps.Marker.MAX_ZINDEX + 1);
    }
    hoveredRef.current = id;
  }, []);

  const selectListing = useCallback(async (id) => {
    const { pageListings: page, onListingSelect: select } = propsRef.current;
    if (!select) return;
    const seq = ++selectSeqRef.current;
    const local = page?.find((listing) => sameId(listing.id, id));
    if (local) {
      select(local);
      return;
    }
    try {
      const response = await fetch(`/api/listings?ids=${encodeURIComponent(id)}`);
      const body = await response.json();
      if (seq !== selectSeqRef.current) return;
      // An empty answer means the listing was unpublished since the pins
      // were fetched — nothing to preview, rather than a card for a ghost.
      select(body.data?.[0] ?? null);
    } catch (err) {
      console.error(`[ListingsMap] could not load listing #${id} for its preview`, err);
    }
  }, []);

  const renderMarkers = useCallback((markers) => {
    const clusterer = clustererRef.current;
    if (!clusterer) return;

    markerDataRef.current = new Map(markers.map((m) => [String(m.id), m]));

    // Same three passes PropertyMap uses: group units of one building, fan
    // listings sharing a base point onto a ring (privacy jitter included),
    // then the screen-space de-overlap net.
    const groups = groupListingsByBuilding(markers);
    const bases = groups.map((group) => {
      const r = group.representative;
      return {
        id: r.id,
        group,
        base: { lat: r.lat, lng: r.lng, source: r.approximate ? 'commune_fallback' : 'existing', precise: !r.approximate },
      };
    });
    const placements = placeResolvedListings(bases);
    const placed = [];
    for (const { id, group } of bases) {
      const p = placements.get(id);
      if (p) placed.push({ id, group, lat: p.lat, lng: p.lng });
    }
    const positions = spreadColocatedPins(placed.map(({ id, lat, lng }) => ({ id, lat, lng })));

    // Reconcile rather than rebuild: a pin that is still in view keeps its
    // Marker, so panning never makes the whole map blink.
    const previous = new Map(entriesRef.current);
    const next = new Map();
    const added = [];
    for (const { id, group } of placed) {
      const position = positions.get(id);
      if (!position) continue;
      const signature = group.isBuilding
        ? `b:${buildingPinLabel(group)}`
        : `l:${group.representative.price}:${group.representative.purpose}`;

      let entry = previous.get(group.key);
      if (entry) {
        previous.delete(group.key);
        if (entry.lat !== position.lat || entry.lng !== position.lng) {
          entry.marker.setPosition({ lat: position.lat, lng: position.lng });
        }
        if (entry.signature !== signature) {
          entry.marker.setIcon(iconFor(group, false));
          entry.marker.setZIndex(zIndexFor(group));
        }
        Object.assign(entry, { group, signature, lat: position.lat, lng: position.lng });
      } else {
        entry = { group, signature, lat: position.lat, lng: position.lng, marker: null };
        const marker = new google.maps.Marker({
          position: { lat: position.lat, lng: position.lng },
          title: group.isBuilding ? (group.buildingName || group.representative.title) : group.representative.title,
          icon: iconFor(group, false),
          zIndex: zIndexFor(group),
        });
        // Listeners read `entry`, which is updated in place above, so a pin
        // whose listing changed between fetches never acts on stale data.
        const current = entry;
        marker.addListener('click', () => {
          const { onListingSelect: select, onBuildingSelect: selectBuilding } = propsRef.current;
          if (current.group.isBuilding) {
            // A building opens the unit list rather than a preview card: there
            // is no single listing to preview.
            selectSeqRef.current += 1;
            select?.(null);
            selectBuilding?.(current.group);
            return;
          }
          selectListing(current.group.representative.id);
        });
        marker.addListener('mouseover', () => propsRef.current.onMarkerHover?.(current.group.representative.id));
        marker.addListener('mouseout', () => propsRef.current.onMarkerHover?.(null));
        entry.marker = marker;
        added.push(marker);
      }
      markerUnits.set(entry.marker, group.isBuilding ? group.unitCount : 1);
      next.set(group.key, entry);
    }

    const removed = [...previous.values()].map((entry) => {
      google.maps.event.clearInstanceListeners(entry.marker);
      return entry.marker;
    });
    entriesRef.current = next;

    clusterer.removeMarkers(removed, true);
    clusterer.addMarkers(added, true);
    clusterer.render();
    applyHover(hoveredRef.current);
  }, [applyHover, selectListing]);

  const fetchMarkers = useCallback(async ({ force = false } = {}) => {
    const map = mapRef.current;
    const req = requestRef.current;
    const latLngBounds = map?.getBounds();
    if (!latLngBounds || req.filterQuery === null || req.positioning) return;

    const viewport = toBounds(latLngBounds);
    updateCounts(viewport);

    const fetched = req.fetched;
    if (!force && fetched && fetched.filterQuery === req.filterQuery && !fetched.truncated && boundsWithin(viewport, fetched.bounds)) {
      return;
    }

    const bounds = padBounds(viewport);
    const filterQuery = req.filterQuery;
    req.controller?.abort();
    const controller = new AbortController();
    req.controller = controller;
    setView((v) => ({ ...v, fetching: true, failed: false }));

    try {
      const qs = new URLSearchParams(filterQuery);
      for (const [key, value] of Object.entries(boundsToQuery(bounds))) qs.set(key, value);
      const response = await fetch(`/api/listings/map?${qs}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (controller.signal.aborted || req.filterQuery !== filterQuery) return;

      req.fetched = { filterQuery, bounds, truncated: Boolean(body.truncated) };
      renderMarkers(body.markers || []);

      if (body.unlocated > 0) {
        console.warn(
          `[ListingsMap] ${body.unlocated} matching listing(s) have neither coordinates nor a commune and are not on the map: ` +
            (body.unlocatedIds || []).map((id) => `#${id}`).join(', '),
        );
      }

      setView((v) => ({
        ...v,
        loaded: true,
        fetching: false,
        failed: false,
        unlocated: body.unlocated || 0,
        truncated: Boolean(body.truncated),
      }));
      const now = mapRef.current?.getBounds();
      if (now) updateCounts(toBounds(now));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('[ListingsMap] marker fetch failed', err);
      if (req.controller === controller) setView((v) => ({ ...v, fetching: false, failed: true }));
    }
  }, [renderMarkers, updateCounts]);

  const scheduleFetch = useCallback(() => {
    const req = requestRef.current;
    clearTimeout(req.timer);
    req.timer = setTimeout(() => fetchMarkers(), FETCH_DEBOUNCE_MS);
  }, [fetchMarkers]);

  // Load the Maps JS API and build the map, once.
  useEffect(() => {
    if (!MAPS_API_KEY) {
      console.error('[ListingsMap] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set');
      return undefined;
    }

    let cancelled = false;
    const listeners = [];
    const req = requestRef.current;
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });

    Promise.all([importLibrary('maps'), importLibrary('geocoding'), importLibrary('marker')])
      .then(() => {
        if (cancelled || !elementRef.current) return;

        const map = new google.maps.Map(elementRef.current, baseMapOptions());
        mapRef.current = map;
        geocoderRef.current = new google.maps.Geocoder();
        clustererRef.current = new MarkerClusterer({
          map,
          algorithm: new SuperClusterAlgorithm({ maxZoom: CLUSTER_MAX_ZOOM, radius: 64 }),
          renderer: {
            render: ({ markers, position }) => {
              const count = markers.reduce((sum, marker) => sum + (markerUnits.get(marker) || 1), 0);
              return new google.maps.Marker({
                position,
                icon: buildClusterIcon({ count }),
                title: propsRef.current.t?.('listings.map.clusterLabel', { count }),
                // Above every price tag, so a bubble never hides under a pin.
                zIndex: google.maps.Marker.MAX_ZINDEX + count,
              });
            },
          },
        });

        // Tapping the bare map dismisses an open preview card. Marker clicks
        // do not propagate to the map, so this never closes the card a pin
        // tap has just opened.
        listeners.push(map.addListener('click', () => {
          selectSeqRef.current += 1;
          propsRef.current.onListingSelect?.(null);
        }));
        listeners.push(map.addListener('idle', () => scheduleFetch()));

        setStatus('ready');
        setMapReady(true);
      })
      .catch((err) => {
        console.error('[ListingsMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      for (const listener of listeners) listener.remove();
      clearTimeout(req.timer);
      req.controller?.abort();
      for (const entry of entriesRef.current.values()) google.maps.event.clearInstanceListeners(entry.marker);
      clustererRef.current?.clearMarkers();
      clustererRef.current?.setMap(null);
      entriesRef.current = new Map();
      markerDataRef.current = new Map();
    };
  }, [scheduleFetch]);

  // Filters changed (or the map just became ready): decide where to look,
  // then fetch for it.
  useEffect(() => {
    if (!mapReady) return undefined;

    const req = requestRef.current;
    const firstRun = req.filterQuery === null;
    const target = locationTarget(new URLSearchParams(filterQuery));
    const targetKey = target ? `${target.commune}|${target.quartier || ''}` : '';
    const placeChanged = firstRun || targetKey !== req.targetKey;

    req.filterQuery = filterQuery;
    req.targetKey = targetKey;
    req.fetched = null;

    // Same place, different filters ("2 chambres" → "3 chambres"): the
    // visitor's view stays exactly where they left it.
    if (!placeChanged) {
      fetchMarkers({ force: true });
      return undefined;
    }

    let cancelled = false;
    req.positioning = true;
    (async () => {
      const viewport = (target ? await geocodePlace(geocoderRef.current, target) : null) ?? (await fetchExtent(filterQuery));
      if (cancelled) return;
      req.positioning = false;
      fitTo(mapRef.current, viewport);
      // fitBounds fires `idle` when the view actually moves; ask directly as
      // well for the case where it did not.
      scheduleFetch();
    })();

    return () => {
      cancelled = true;
      req.positioning = false;
    };
  }, [mapReady, filterQuery, fetchMarkers, scheduleFetch]);

  // Card -> map hover sync: only ever touches the two markers affected.
  useEffect(() => {
    if (mapReady) applyHover(hoveredId);
  }, [hoveredId, mapReady, applyHover]);

  const notices = [];
  if (view.failed) notices.push(t('listings.map.fetchError'));
  if (view.truncated) notices.push(t('listings.map.truncated'));
  if (view.approximate > 0) notices.push(t('listings.map.approximate', { count: view.approximate }));
  if (view.unlocated > 0) notices.push(t('listings.map.unlocated', { count: view.unlocated }));

  // No border/rounding of its own — every caller already owns its edge
  // treatment (see PropertyMap's same note).
  return (
    <div className="relative h-full w-full overflow-hidden">
      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-sm text-ink-45">
          <p>{t('listings.map.loading')}</p>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white p-6 text-center text-sm text-ink-45">
          {t('listings.map.loadError')}
        </div>
      )}

      <div ref={elementRef} className="h-full w-full" />

      {status === 'ready' ? (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex flex-col items-center gap-1.5 px-3" aria-live="polite">
          <span
            className={`u-lift u-tabular whitespace-nowrap rounded-xl border border-line bg-surface/95 px-4 py-2 text-[0.75rem] font-semibold text-ink backdrop-blur-md transition-opacity ${
              view.fetching && view.loaded ? 'opacity-70' : ''
            }`}
          >
            {view.loaded ? t('listings.map.inArea', { count: view.inView }) : t('listings.map.updating')}
          </span>
          {notices.map((notice) => (
            <span
              key={notice}
              className="max-w-full rounded-lg border border-line bg-surface/95 px-3 py-1 text-center text-[0.6875rem] text-ink-70 backdrop-blur-md"
            >
              {notice}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
