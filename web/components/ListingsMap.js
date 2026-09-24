'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LocateFixed, Loader2, X } from 'lucide-react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { placeResolvedListings } from '@/lib/geocoding';
import { compactPrice, priceZIndex } from '@/lib/mapIcons';
import { createPinLayer } from '@/lib/mapPinLayer';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { getRecentIds } from '@/lib/recentlyViewed';
import { groupListingsByBuilding, buildingPinLabel } from '@/lib/buildingGroups';
import { baseMapOptions } from '@/lib/mapBase';
import { flyTo } from '@/lib/mapFly';
import { useCountUp } from '@/lib/useCountUp';
import { landmarkPoint } from '@/lib/landmarks';
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
 * - **Every listing shows its price at every zoom.** Clustering, and later
 *   collapsing overlapping pills into dots, were both removed on explicit
 *   product direction: the price is what this map exists to show. Pins are
 *   HTML speech-bubble pills (lib/mapPinLayer.js); higher prices sit in front
 *   and the hovered/selected pin above everything.
 * - **Positions** are the stored coordinates, or the commune centroid for a
 *   listing without them — both jittered and fanned (lib/geocoding.js
 *   placeResolvedListings). No client-side geocoding of listings happens here;
 *   the only geocoder calls are for the opening view of a named place.
 * - **One plain-text counter pill** ("35 biens dans cette zone") on desktop.
 *   The ⓘ breakdown beside it (commune-centroid / unplaceable counts) was
 *   removed on product direction, 2026-09-23 — an icon nobody understood.
 *   On a phone the count is the "Voir N biens" button's job (MobileMapBar),
 *   so the pill appears there only while loading, on a failure, or when the
 *   answer is capped (it then says to zoom in instead of a false count).
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

function labelFor(group) {
  if (group.isBuilding) return buildingPinLabel(group, (value) => compactPrice(value, 'sale'));
  const listing = group.representative;
  return compactPrice(listing.price, listing.purpose, { pricePeriod: listing.price_period }) || 'N.C.';
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
  // A landmark with a verified stored point (lib/landmarks.js) needs no
  // geocoder round trip — and gets the same point the list measures from.
  const storedNear = landmarkPoint(target.commune, target.near);
  const [commune, quartier, near] = await Promise.all([
    geocodePoint(geocoder, queries.commune),
    geocodePoint(geocoder, queries.quartier),
    storedNear ? Promise.resolve(storedNear) : geocodePoint(geocoder, queries.near),
  ]);
  return targetView(target, { commune, quartier, near });
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
  onVisibleIdsChange, revealId, onNearChange,
}) {
  const t = useT();
  const router = useRouter();
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
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState(null);
  // The words dropped from a search that matched nothing anywhere, and the
  // filter query that dropping produced (the banner lasts until it changes).
  const [relaxed, setRelaxed] = useState(null);
  const relaxRef = useRef({ run: null, checked: null, sourceQuery: null, producedQuery: null });
  const noticeTimerRef = useRef(null);
  const visibleKeyRef = useRef('');
  const [view, setView] = useState({ loaded: false, inView: 0, truncated: false, fetching: false, failed: false });

  const filterQuery = useMemo(() => mapFilterQuery(params), [params]);
  // The desktop pill's count rolls to its new value as the map moves.
  const shownInView = useCountUp(view.loaded && !view.failed ? view.inView : null);
  // Whether the URL currently carries a map area. Only its removal matters
  // here ("Effacer la zone"): the map then goes back to the searched place.
  const hasUrlArea = useMemo(() => Boolean(parseBounds(params).bounds), [params]);
  const hadUrlAreaRef = useRef(hasUrlArea);

  useEffect(() => {
    propsRef.current = { pageListings, onMarkerHover, onListingSelect, onBuildingSelect, onAreaChange, onVisibleIdsChange };
  });

  const updateCounts = useCallback((viewport) => {
    const visible = [];
    for (const marker of markerDataRef.current.values()) {
      if (boundsContain(viewport, marker)) visible.push(marker);
    }
    const inView = visible.length;
    setView((v) => (v.inView === inView ? v : { ...v, inView }));
    // West to east, the order the phone's swipeable cards walk them in.
    const ids = visible.sort((a, b) => a.lng - b.lng || b.lat - a.lat).map((m) => String(m.id));
    const key = ids.join(',');
    if (key !== visibleKeyRef.current) {
      visibleKeyRef.current = key;
      propsRef.current.onVisibleIdsChange?.(ids);
    }
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
        label: labelFor(group),
        title: group.isBuilding ? (group.buildingName || r.title) : r.title,
        building: group.isBuilding,
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
      if (!(body.markers || []).length) relaxRef.current.run?.(filterQuery);

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

  /**
   * A text search (`q`) that leaves this view empty. World-class portals never
   * answer a search with a blank map, and neither does this one:
   *
   *   - the words match listings elsewhere in the city → go there (the box
   *     around them, the same extent the opening view falls back to);
   *   - they match nothing anywhere → drop the words, keep every other filter
   *     and the view, and say so in a banner ("Aucun bien pour « St lu » —
   *     voici les biens à proximité"). The URL loses `q` too, so the list and
   *     the "Voir N biens" count agree with the pins.
   *
   * Checked once per filter query. Place filters are never dropped here — the
   * map already lets the viewport replace them.
   */
  // Assigned in an effect (never during render); it reads the latest router.
  useEffect(() => {
    relaxRef.current.run = async (filterQuery) => {
      const state = relaxRef.current;
      const text = new URLSearchParams(filterQuery).get('q');
      if (!text || state.checked === filterQuery) return;
      state.checked = filterQuery;
      try {
        const qs = new URLSearchParams(filterQuery);
        qs.set('extent', '1');
        const response = await fetch(`/api/listings/map?${qs}`);
        if (!response.ok) return;
        const body = await response.json();
        if (requestRef.current.filterQuery !== filterQuery || !mapRef.current) return;
        if (body.total > 0 && body.extent) {
          fitTo(mapRef.current, padBounds(body.extent, 0.08));
          return;
        }
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        url.searchParams.delete('page');
        state.sourceQuery = filterQuery;
      state.producedQuery = mapFilterQuery(url.searchParams);
        setRelaxed(text);
        router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
      } catch (err) {
        console.error('[ListingsMap] could not relax an empty text search', err);
      }
    };
  });

  // A new search retires the banner — anything but the query that was relaxed
  // (still in the URL for a moment) or the one the relaxation produced.
  useEffect(() => {
    const { sourceQuery, producedQuery } = relaxRef.current;
    if (relaxed && filterQuery !== sourceQuery && filterQuery !== producedQuery) setRelaxed(null);
  }, [filterQuery, relaxed]);

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

        // Tapping the bare map dismisses an open preview card. Marker clicks
        // do not propagate to the map, so this never closes the card a pin
        // tap has just opened.
        listeners.push(map.addListener('click', () => {
          selectSeqRef.current += 1;
          propsRef.current.onListingSelect?.(null);
        }));
        // Pills step back while the map moves and come forward as it settles.
        listeners.push(map.addListener('dragstart', () => layerRef.current?.setMoving(true)));
        listeners.push(map.addListener('zoom_changed', () => layerRef.current?.setMoving(true)));
        listeners.push(map.addListener('idle', () => {
          layerRef.current?.setMoving(false);
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
    const targetKey = target ? `${target.commune}|${target.quartier || ''}|${target.near || ''}` : '';
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
    // there; after a place is cleared, this brings it back — flying, so the
    // visitor sees where they came from (lib/mapFly.js).
    if (!target) {
      if (firstRun) {
        fitTo(mapRef.current, null);
        areaRef.current = { baseline: viewKey(mapRef.current), reported: null };
        scheduleFetch();
        return undefined;
      }
      let cancelledHome = false;
      req.positioning = true;
      flyTo(mapRef.current, KINSHASA_DEFAULT_VIEW).then(() => {
        if (cancelledHome) return;
        req.positioning = false;
        areaRef.current = { baseline: viewKey(mapRef.current), reported: null };
        scheduleFetch();
      });
      return () => {
        cancelledHome = true;
        req.positioning = false;
      };
    }

    let cancelled = false;
    req.positioning = true;
    (async () => {
      const placeView = await viewForTarget(geocoderRef.current, target);
      const extent = placeView ? null : await fetchExtent(filterQuery);
      if (cancelled) return;
      if (placeView) {
        // A new place while the map is already open: fly there across the
        // city rather than blinking. The first view of the page opens in
        // place — there is nowhere to fly from.
        if (firstRun) showView(mapRef.current, placeView);
        else if (!(await flyTo(mapRef.current, placeView)) || cancelled) return;
        req.positioning = false;
        // Show where the search landed.
        google.maps.event.addListenerOnce(mapRef.current, 'idle', () => layerRef.current?.pulseAt(placeView.center));
        areaRef.current = { baseline: viewKey(mapRef.current), reported: null };
      } else {
        req.positioning = false;
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

  // A swiped-to card whose pin is off screen: glide the map to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || revealId == null) return;
    const point = layerRef.current?.positionOf(revealId);
    const bounds = map.getBounds();
    if (point && bounds && !bounds.contains(point)) map.panTo(point);
  }, [revealId, mapReady]);

  // The searched landmark, for the cards' "à 1,2 km de …" line.
  const nearLabel = useMemo(() => locationTarget(new URLSearchParams(filterQuery))?.near || null, [filterQuery]);
  const nearCommune = useMemo(() => locationTarget(new URLSearchParams(filterQuery))?.commune || null, [filterQuery]);
  useEffect(() => {
    const point = landmarkPoint(nearCommune, nearLabel);
    onNearChange?.(point ? { label: nearLabel, point } : null);
  }, [nearLabel, nearCommune, onNearChange]);

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

  // One line of text, never an icon to decode. A capped answer (more
  // matches than the map will draw) replaces the count, because "2000 biens"
  // would then be false.
  let pillText = t('listings.map.updating');
  if (view.failed) pillText = t('listings.map.fetchError');
  else if (view.truncated) pillText = t('listings.map.truncated');
  else if (view.loaded) pillText = t('listings.map.inArea', { count: shownInView ?? view.inView });
  // On a phone the settled count is the "Voir N biens" button's job, so the
  // pill only appears there for loading, a failure, or a capped answer.
  const phoneHidden = view.loaded && !view.failed && !view.truncated;

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
        // A text-only counter pill, top-centre. Only the pill takes pointer
        // events, so the map stays draggable right up to it.
        // Below the floating search bar on a phone.
        <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-20 flex flex-col items-center gap-2 px-3 lg:top-3">
          <p
            aria-live="polite"
            className={`u-tabular rounded-full bg-surface px-3.5 py-1.5 text-[0.75rem] font-semibold leading-5 text-ink shadow-[0_2px_8px_rgba(0,0,0,0.12)] transition-opacity ${
              view.fetching && view.loaded ? 'opacity-80' : ''
            } ${phoneHidden ? 'hidden lg:block' : ''}`}
          >
            {pillText}
          </p>
          {relaxed ? (
            <div
              role="status"
              className="u-rise pointer-events-auto flex max-w-[22rem] items-start gap-2 rounded-2xl bg-surface py-2 pl-3.5 pr-2 text-[0.75rem] leading-snug text-ink shadow-[0_2px_8px_rgba(0,0,0,0.12)]"
            >
              <span className="min-w-0 flex-1">{t('listings.map.relaxedText', { text: relaxed })}</span>
              <button
                type="button"
                onClick={() => setRelaxed(null)}
                aria-label={t('listings.map.dismiss')}
                className="u-press -my-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
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
