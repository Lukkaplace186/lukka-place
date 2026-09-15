'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { placeResolvedListings } from '@/lib/geocoding';
import { buildPricePinIcon, buildBuildingPinIcon, priceZIndex } from '@/lib/mapIcons';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { groupListingsByBuilding, buildingPinLabel } from '@/lib/buildingGroups';
import { baseMapOptions } from '@/lib/mapBase';
import {
  FETCH_DEBOUNCE_MS,
  KINSHASA_DEFAULT_VIEW,
  boundsContain,
  boundsToQuery,
  boundsWithin,
  locationGeocodeQueries,
  locationTarget,
  mapFilterQuery,
  padBounds,
  targetView,
} from '@/lib/mapViewport';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
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
 * - **Opening view.** Every URL param travels into this view (the list/map
 *   toggles copy the whole query string), so a search naming a place opens
 *   ON that place: the commune's geocoded point at zoom 14, or the quartier's
 *   at zoom 15 when it really lies in that commune (lib/mapViewport.js
 *   targetView). Deliberately a centre and a zoom, never a fit to Google's
 *   viewport for the place — Limete's reaches into the river, and fitting it
 *   opened a phone on Brazzaville. The visitor can then pan out and the other
 *   filters keep applying to the wider area. A search naming no place opens on
 *   the Kinshasa core (KINSHASA_DEFAULT_VIEW). Changing a non-location filter
 *   keeps the view where the visitor left it.
 * - **Every listing is its own price tag at every zoom.** Clustering was tried
 *   and removed on an explicit product direction: a field of scannable prices
 *   is the point of this map, and a "13" bubble hides exactly that. Overlap is
 *   handled by the co-location fan and the de-overlap net below, and stacking
 *   is predictable — higher prices in front, the hovered/selected pin above all.
 * - **Positions** are the stored coordinates, or the commune centroid for a
 *   listing without them — both jittered and fanned (lib/geocoding.js
 *   placeResolvedListings). No client-side geocoding of listings happens here;
 *   the only geocoder calls are for the opening view of a named place.
 * - **Honesty, compactly.** One pill states how many listings are in view; an
 *   info button beside it opens the breakdown (placed on a commune centroid,
 *   matching but unplaceable, truncated) instead of stacking three pills over
 *   the top of a phone-sized map.
 *
 * Tapping a pin opens MapListingPreview through `onListingSelect`. The marker
 * payload has no photos, so the full listing comes from the list page when it
 * is one of those 12, and from /api/listings?ids= otherwise.
 */
const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/** The extent fallback never zooms in past a neighbourhood. */
const MAX_FIT_ZOOM = 15;
/**
 * A geocode whose own viewport is wider than this many degrees came back as
 * the city ("Kinshasa"), not the commune or quartier asked for — its point is
 * the city centre, not the place, and is ignored.
 */
const MAX_PLACE_SPAN_DEG = 0.35;

/** Geocoded points of named places, per tab — a place does not move. */
const placePointCache = new Map();

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
  // Higher prices in front, so where two tags overlap the pricier one stays
  // readable. A building stands for several listings, so it sits one above
  // its own most expensive unit's price.
  return group.isBuilding ? priceZIndex(group.priceMax) + 1 : priceZIndex(group.representative.price);
}

/** One geocode → the place's point, or null for no match or a city-level answer. */
function geocodePoint(geocoder, address) {
  if (!geocoder || !address) return Promise.resolve(null);
  if (placePointCache.has(address)) return Promise.resolve(placePointCache.get(address));
  return new Promise((resolve) => {
    geocoder.geocode({ address, region: 'cd' }, (results, status) => {
      const geometry = status === 'OK' ? results?.[0]?.geometry : null;
      let point = null;
      if (geometry?.location) {
        const area = geometry.viewport || geometry.bounds;
        const span = area ? toBounds(area) : null;
        const cityLevel = span && (span.north - span.south > MAX_PLACE_SPAN_DEG || span.east - span.west > MAX_PLACE_SPAN_DEG);
        if (!cityLevel) point = { lat: geometry.location.lat(), lng: geometry.location.lng() };
      }
      placePointCache.set(address, point);
      resolve(point);
    });
  });
}

/** The opening view for a searched place: its centre at a fixed zoom (lib/mapViewport.js targetView). */
async function viewForTarget(geocoder, target) {
  const queries = locationGeocodeQueries(target);
  const [commune, quartier] = await Promise.all([geocodePoint(geocoder, queries.commune), geocodePoint(geocoder, queries.quartier)]);
  return targetView(target, { commune, quartier });
}

/** Last resort when a named place resolves to nothing at all: the box around what matches it. */
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

function showView(map, { center, zoom }) {
  map.setCenter(center);
  map.setZoom(zoom);
}

function fitTo(map, bounds) {
  if (!bounds) {
    showView(map, KINSHASA_DEFAULT_VIEW);
    return;
  }
  // One listing, or several on one point: a zero-size box would zoom to the street.
  if (bounds.north - bounds.south < 0.004 && bounds.east - bounds.west < 0.004) {
    showView(map, { center: { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }, zoom: MAX_FIT_ZOOM - 1 });
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
  const detailsId = useId();
  const elementRef = useRef(null);
  const mapRef = useRef(null);
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [view, setView] = useState({ loaded: false, inView: 0, approximate: 0, unlocated: 0, truncated: false, fetching: false, failed: false });

  const filterQuery = useMemo(() => mapFilterQuery(params), [params]);

  useEffect(() => {
    propsRef.current = { pageListings, onMarkerHover, onListingSelect, onBuildingSelect };
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
      // Above every resting tag, whatever its price.
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
    const map = mapRef.current;
    if (!map) return;

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
          map,
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
      }
      next.set(group.key, entry);
    }

    for (const entry of previous.values()) {
      google.maps.event.clearInstanceListeners(entry.marker);
      entry.marker.setMap(null);
    }
    entriesRef.current = next;
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

        // Built on the default Kinshasa view; a searched place moves it there
        // before any marker is fetched (see `positioning` below).
        const map = new google.maps.Map(elementRef.current, { ...baseMapOptions(), ...KINSHASA_DEFAULT_VIEW });
        mapRef.current = map;
        geocoderRef.current = new google.maps.Geocoder();

        // Tapping the bare map dismisses an open preview card and the badge's
        // breakdown. Marker clicks do not propagate to the map, so this never
        // closes the card a pin tap has just opened.
        listeners.push(map.addListener('click', () => {
          selectSeqRef.current += 1;
          propsRef.current.onListingSelect?.(null);
          setDetailsOpen(false);
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
      for (const entry of entriesRef.current.values()) {
        google.maps.event.clearInstanceListeners(entry.marker);
        entry.marker.setMap(null);
      }
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

    // No place named: the Kinshasa core. On first load the map is already
    // there; after a place is cleared, this brings it back.
    if (!target) {
      fitTo(mapRef.current, null);
      scheduleFetch();
      return undefined;
    }

    let cancelled = false;
    req.positioning = true;
    (async () => {
      const placeView = await viewForTarget(geocoderRef.current, target);
      const extent = placeView ? null : await fetchExtent(filterQuery);
      if (cancelled) return;
      req.positioning = false;
      if (placeView) showView(mapRef.current, placeView);
      else fitTo(mapRef.current, extent);
      // Moving the map fires `idle`; ask directly as well for the case where
      // the view did not actually change.
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

  const details = [];
  if (view.truncated) details.push(t('listings.map.truncated'));
  if (view.approximate > 0) details.push(t('listings.map.approximate', { count: view.approximate }));
  if (view.unlocated > 0) details.push(t('listings.map.unlocated', { count: view.unlocated }));
  const hasDetails = details.length > 0 && !view.failed;

  let pillText = t('listings.map.updating');
  if (view.failed) pillText = t('listings.map.fetchError');
  else if (view.loaded) pillText = t('listings.map.inArea', { count: view.inView });

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
        // One pill, ~28px tall, top-centre. Only the pill and its breakdown
        // take pointer events, so the map stays draggable right up to it.
        <div className="pointer-events-none absolute inset-x-0 top-2.5 z-20 flex flex-col items-center px-3">
          <div
            className={`u-lift pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface/95 py-1 pl-3 lg:backdrop-blur-md transition-opacity ${
              hasDetails ? 'pr-1' : 'pr-3'
            } ${view.fetching && view.loaded ? 'opacity-80' : ''}`}
          >
            <span aria-live="polite" className="u-tabular whitespace-nowrap text-[0.75rem] font-semibold leading-5 text-ink">
              {pillText}
            </span>
            {hasDetails ? (
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                aria-label={t('listings.map.locationDetails')}
                title={t('listings.map.locationDetails')}
                className="u-press flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
              >
                <Info strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {hasDetails && detailsOpen ? (
            <ul
              id={detailsId}
              className="u-lift pointer-events-auto mt-1.5 max-w-[18rem] space-y-1 rounded-xl border border-line bg-surface/95 px-3 py-2 text-[0.6875rem] leading-snug text-ink-70 lg:backdrop-blur-md"
            >
              {details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
