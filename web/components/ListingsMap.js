'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Info, LocateFixed, Loader2 } from 'lucide-react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { placeResolvedListings } from '@/lib/geocoding';
import { compactPrice, priceZIndex } from '@/lib/mapIcons';
import { createPinLayer } from '@/lib/mapPinLayer';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { getRecentIds } from '@/lib/recentlyViewed';
import { groupListingsByBuilding, buildingPinLabel } from '@/lib/buildingGroups';
import { baseMapOptions } from '@/lib/mapBase';
import {
  FETCH_DEBOUNCE_MS,
  KINSHASA_DEFAULT_VIEW,
  KINSHASA_PROVINCE_ENVELOPE,
  boundsContain,
  boundsToQuery,
  boundsWithin,
  locationGeocodeQueries,
  locationTarget,
  mapFilterQuery,
  padBounds,
  parseBounds,
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
 * - **Every listing is its own pin at every zoom.** Clustering was tried and
 *   removed on an explicit product direction: a "13" bubble hides the prices
 *   this map exists to show. Pins are HTML pills (lib/mapPinLayer.js); where
 *   two would overlap, the lower-priority one shrinks to a dot at its real
 *   position (lib/mapDeclutter.js) and gets its price back as you zoom in.
 *   The hovered/selected pin is always labelled and above everything.
 * - **Positions** are the stored coordinates, or the commune centroid for a
 *   listing without them — both jittered and fanned (lib/geocoding.js
 *   placeResolvedListings). No client-side geocoding of listings happens here;
 *   the only geocoder calls are for the opening view of a named place.
 * - **Honesty, compactly.** One pill states how many listings are in view; an
 *   info button beside it opens the breakdown (placed on a commune centroid,
 *   matching but unplaceable, truncated) instead of stacking three pills over
 *   the top of a phone-sized map. On a phone the count itself is left to the
 *   "Voir N biens" button (MobileMapOverlay) — the pill shows only loading,
 *   failure, or the ⓘ alone, so one number is not printed twice.
 * - **"Autour de moi"** centres on the visitor's own position, only when they
 *   tap it, and only inside Kinshasa province: a diaspora visitor in Brussels
 *   is told so rather than flown to Belgium.
 *
 * **The list follows the map.** Once the visitor has moved the map themselves
 * — any view other than the one this component opened on — every settled view
 * is reported through `onAreaChange(bounds)`, and the caller writes it into
 * the URL (`sw_lat`…), which lists exactly the listings counted in the pill
 * (lib/listings.js getListings). The view we set ourselves (the opening view,
 * a new place) is never reported, so opening "Bandal" keeps the Bandal search
 * until the visitor pans. A URL that already carries an area opens on it.
 * `onInViewChange(count)` reports the pill's count, for the mobile Liste button.
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

/**
 * Recent marker answers, per tab, keyed by the exact query. Toggling Liste →
 * Carte remounts this component on the same view, so its first fetch repeats
 * the last one: served from here, the pins are on screen at once instead of
 * after a round trip on a Kinshasa 3G connection. Short-lived on purpose — a
 * listing approved a minute ago should appear.
 */
const markerResponseCache = new Map();
const MARKER_CACHE_TTL_MS = 60_000;
const MARKER_CACHE_MAX = 16;

function cachedMarkers(key) {
  const hit = markerResponseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MARKER_CACHE_TTL_MS) {
    markerResponseCache.delete(key);
    return null;
  }
  return hit.body;
}

function rememberMarkers(key, body) {
  markerResponseCache.delete(key);
  markerResponseCache.set(key, { at: Date.now(), body });
  while (markerResponseCache.size > MARKER_CACHE_MAX) {
    markerResponseCache.delete(markerResponseCache.keys().next().value);
  }
}

/** Pins tapped in this tab, greyed like visited links alongside opened listings. */
const tappedThisSession = new Set();

function sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function toBounds(latLngBounds) {
  const ne = latLngBounds.getNorthEast();
  const sw = latLngBounds.getSouthWest();
  return { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() };
}

function labelFor(group, monthly) {
  if (group.isBuilding) return buildingPinLabel(group, (value) => compactPrice(value, 'sale'));
  const listing = group.representative;
  return compactPrice(listing.price, listing.purpose, { pricePeriod: listing.price_period, monthly }) || 'N.C.';
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

/** Centre + zoom, to tell a visitor's pan or zoom from the view we set ourselves. */
function viewKey(map) {
  const center = map.getCenter();
  return center ? `${map.getZoom()}:${center.lat().toFixed(5)}:${center.lng().toFixed(5)}` : null;
}

function showView(map, { center, zoom }) {
  map.setCenter(center);
  map.setZoom(zoom);
}

function fitTo(map, bounds, { exact = false } = {}) {
  if (!bounds) {
    showView(map, KINSHASA_DEFAULT_VIEW);
    return;
  }
  // A saved map area: back to that box as closely as the zoom steps allow.
  if (exact) {
    map.fitBounds(
      new google.maps.LatLngBounds({ lat: bounds.south, lng: bounds.west }, { lat: bounds.north, lng: bounds.east }),
      0,
    );
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

export default function ListingsMap({
  params, pageListings, hoveredId, onMarkerHover, onListingSelect, onBuildingSelect, onAreaChange, onInViewChange,
}) {
  const t = useT();
  const detailsId = useId();
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const layerRef = useRef(null);
  // listing id -> marker data, for the in-view counts
  const markerDataRef = useRef(new Map());
  const requestRef = useRef({ controller: null, timer: null, fetched: null, filterQuery: null, targetKey: null, positioning: false });
  const hoveredRef = useRef(null);
  const selectSeqRef = useRef(0);
  // The view we positioned the map on (null until it has settled there), and
  // the last view reported — see "The list follows the map" above.
  const areaRef = useRef({ baseline: null, reported: null });
  // Google listeners are registered once; they read the latest props from here.
  const propsRef = useRef({});

  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));
  const [mapReady, setMapReady] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const [view, setView] = useState({ loaded: false, inView: 0, approximate: 0, unlocated: 0, truncated: false, fetching: false, failed: false });

  const filterQuery = useMemo(() => mapFilterQuery(params), [params]);
  // Whether the URL currently carries a map area. Only its removal matters
  // here ("Effacer la zone"): the map then goes back to the searched place.
  const hasUrlArea = useMemo(() => Boolean(parseBounds(params).bounds), [params]);
  const hadUrlAreaRef = useRef(hasUrlArea);

  useEffect(() => {
    propsRef.current = { pageListings, onMarkerHover, onListingSelect, onBuildingSelect, onAreaChange };
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
    hoveredRef.current = id;
    layerRef.current?.setActive(id);
  }, []);

  const selectListing = useCallback(async (id) => {
    const { pageListings: page, onListingSelect: select } = propsRef.current;
    if (!select) return;
    tappedThisSession.add(String(id));
    layerRef.current?.setVisited([...getRecentIds(), ...tappedThisSession]);
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

    // "/m" is only worth its width when a sale is on screen to tell a rent
    // from (lib/mapIcons.js compactPrice).
    const monthly = markers.some((m) => m.purpose !== 'rent');

    const pins = [];
    for (const { id, group } of placed) {
      const position = positions.get(id);
      if (!position) continue;
      const r = group.representative;
      pins.push({
        key: group.key,
        id: group.isBuilding ? null : String(r.id),
        lat: position.lat,
        lng: position.lng,
        label: labelFor(group, monthly),
        title: group.isBuilding ? (group.buildingName || r.title) : r.title,
        building: group.isBuilding,
        approximate: Boolean(r.approximate),
        verified: !group.isBuilding && Boolean(r.verified),
        zIndex: zIndexFor(group),
        group,
      });
    }
    layerRef.current?.setPins(pins);
    layerRef.current?.setActive(hoveredRef.current);
  }, []);

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
      const cacheKey = qs.toString();
      let body = cachedMarkers(cacheKey);
      if (!body) {
        const response = await fetch(`/api/listings/map?${qs}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.json();
        rememberMarkers(cacheKey, body);
      }
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

  // Runs on every `idle`. The first settled view after we position the map is
  // the baseline; any later view that differs from it is the visitor's.
  const reportArea = useCallback(() => {
    const map = mapRef.current;
    const area = areaRef.current;
    if (!map || requestRef.current.positioning) return;
    const key = viewKey(map);
    if (!key) return;
    if (area.baseline === null) {
      area.baseline = key;
      return;
    }
    if (key === area.reported || (area.reported === null && key === area.baseline)) return;
    area.reported = key;
    const latLngBounds = map.getBounds();
    if (latLngBounds) propsRef.current.onAreaChange?.(toBounds(latLngBounds));
  }, []);

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
        layerRef.current = createPinLayer(map, {
          onClick: (pin) => {
            const { onListingSelect: select, onBuildingSelect: selectBuilding } = propsRef.current;
            if (pin.building) {
              // A building opens the unit list rather than a preview card:
              // there is no single listing to preview.
              selectSeqRef.current += 1;
              select?.(null);
              selectBuilding?.(pin.group);
              return;
            }
            selectListing(pin.id);
          },
          onHover: (pin) => propsRef.current.onMarkerHover?.(pin && !pin.building ? pin.group.representative.id : null),
        });
        layerRef.current.setVisited([...getRecentIds(), ...tappedThisSession]);

        // Tapping the bare map dismisses an open preview card and the badge's
        // breakdown. Marker clicks do not propagate to the map, so this never
        // closes the card a pin tap has just opened.
        listeners.push(map.addListener('click', () => {
          selectSeqRef.current += 1;
          propsRef.current.onListingSelect?.(null);
          setDetailsOpen(false);
        }));
        listeners.push(map.addListener('idle', () => {
          scheduleFetch();
          reportArea();
        }));

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
      clearTimeout(noticeTimerRef.current);
      req.controller?.abort();
      layerRef.current?.destroy();
      layerRef.current = null;
      markerDataRef.current = new Map();
    };
  }, [scheduleFetch, reportArea, selectListing]);

  // Filters changed (or the map just became ready): decide where to look,
  // then fetch for it.
  useEffect(() => {
    if (!mapReady) return undefined;

    const req = requestRef.current;
    const firstRun = req.filterQuery === null;
    const target = locationTarget(new URLSearchParams(filterQuery));
    const targetKey = target ? `${target.commune}|${target.quartier || ''}` : '';
    const areaCleared = hadUrlAreaRef.current && !hasUrlArea;
    hadUrlAreaRef.current = hasUrlArea;
    const placeChanged = firstRun || areaCleared || targetKey !== req.targetKey;

    // Only the area we reported has landed in the URL: nothing to redo.
    if (!placeChanged && filterQuery === req.filterQuery) return undefined;

    req.filterQuery = filterQuery;
    req.targetKey = targetKey;
    req.fetched = null;

    // A URL that already names an area (a shared link, back from the list,
    // the Carte toggle) opens on that area — once, on the first run. After
    // that the area is whatever the visitor is looking at.
    const urlArea = firstRun ? parseBounds(params).bounds : null;
    if (urlArea) {
      areaRef.current = { baseline: null, reported: null };
      fitTo(mapRef.current, urlArea, { exact: true });
      scheduleFetch();
      return undefined;
    }

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
      areaRef.current = { baseline: viewKey(mapRef.current), reported: null };
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
      if (placeView) {
        showView(mapRef.current, placeView);
        areaRef.current = { baseline: viewKey(mapRef.current), reported: null };
      } else {
        // fitBounds settles asynchronously: the next idle is the baseline.
        areaRef.current = { baseline: null, reported: null };
        fitTo(mapRef.current, extent);
      }
      // Moving the map fires `idle`; ask directly as well for the case where
      // the view did not actually change.
      scheduleFetch();
    })();

    return () => {
      cancelled = true;
      req.positioning = false;
    };
    // `params` is read only on the first run (the URL's area); every later
    // change that matters is already in `filterQuery`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, filterQuery, hasUrlArea, fetchMarkers, scheduleFetch]);

  useEffect(() => {
    onInViewChange?.(view.loaded && !view.failed ? view.inView : null);
  }, [view.loaded, view.failed, view.inView, onInViewChange]);

  // Card -> map hover sync.
  useEffect(() => {
    if (mapReady) applyHover(hoveredId);
  }, [hoveredId, mapReady, applyHover]);

  // The list page's own listings win label collisions, so a card and its pin
  // can be matched by eye.
  useEffect(() => {
    if (mapReady) layerRef.current?.setPageIds((pageListings || []).map((listing) => listing.id));
  }, [pageListings, mapReady]);

  const flash = useCallback((key) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(key);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 3500);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      flash('listings.map.locateUnavailable');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const env = KINSHASA_PROVINCE_ENVELOPE;
        if (point.lat < env.south || point.lat > env.north || point.lng < env.west || point.lng > env.east) {
          flash('listings.map.locateOutside');
          return;
        }
        const map = mapRef.current;
        if (!map) return;
        layerRef.current?.setUserLocation(point);
        map.panTo(point);
        if ((map.getZoom() ?? 0) < 15) map.setZoom(15);
      },
      (error) => {
        setLocating(false);
        flash(error?.code === 1 ? 'listings.map.locateDenied' : 'listings.map.locateFailed');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }, [flash]);

  const details = [];
  if (view.truncated) details.push(t('listings.map.truncated'));
  if (view.approximate > 0) details.push(t('listings.map.approximate', { count: view.approximate }));
  if (view.unlocated > 0) details.push(t('listings.map.unlocated', { count: view.unlocated }));
  const hasDetails = details.length > 0 && !view.failed;

  let pillText = t('listings.map.updating');
  if (view.failed) pillText = t('listings.map.fetchError');
  else if (view.loaded) pillText = t('listings.map.inArea', { count: view.inView });
  // On a phone a settled count is the "Voir N biens" button's job.
  const phoneQuiet = view.loaded && !view.failed;

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
        <div
          className={`pointer-events-none absolute inset-x-0 top-2.5 z-20 flex-col items-center px-3 ${
            phoneQuiet && !hasDetails ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div
            className={`u-lift pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface/95 py-1 lg:backdrop-blur-md transition-opacity ${
              hasDetails ? 'pr-1' : 'pr-3'
            } ${phoneQuiet ? 'pl-1 lg:pl-3' : 'pl-3'} ${view.fetching && view.loaded ? 'opacity-80' : ''}`}
          >
            <span
              aria-live="polite"
              className={`u-tabular whitespace-nowrap text-[0.75rem] font-semibold leading-5 text-ink ${phoneQuiet ? 'max-lg:sr-only' : ''}`}
            >
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

      {status === 'ready' ? (
        // Bottom-right on a phone, clear of the centred "Voir N biens"
        // button; top-right on desktop, clear of Google's zoom buttons.
        <div className="pointer-events-none absolute bottom-6 right-3 z-20 flex flex-col items-end gap-2 lg:bottom-auto lg:top-2.5">
          {notice ? (
            <p
              role="status"
              className="u-lift u-rise pointer-events-auto max-w-[15rem] rounded-xl border border-line bg-surface px-3 py-2 text-[0.75rem] leading-snug text-ink-70 lg:order-last"
            >
              {t(notice)}
            </p>
          ) : null}
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label={t('listings.map.locate')}
            title={t('listings.map.locate')}
            className="u-lift u-press pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-70 transition-colors hover:text-blue disabled:opacity-70"
          >
            {locating ? (
              <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
