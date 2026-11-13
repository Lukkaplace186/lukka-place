'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { ZONE_DRAW_PUBLIC, simplifyScreenPath } from '@/lib/mapZone';

// The site's action blue (--blue). Google's shapes cannot read CSS variables
// (see lib/mapIcons.js), so the token's value is repeated here.
const ZONE_BLUE = '#1E3AA8';

// A screen point inside the map's box → its place on the ground, from the
// map's own projection (no tilt or rotation on this map).
function toLatLng(map, x, y) {
  const projection = map.getProjection();
  const bounds = map.getBounds();
  if (!projection || !bounds) return null;
  const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
  const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
  const scale = 2 ** map.getZoom();
  const world = new window.google.maps.Point(bottomLeft.x + x / scale, topRight.y + y / scale);
  const place = projection.fromPointToLatLng(world);
  return place ? { lat: place.lat(), lng: place.lng() } : null;
}

/**
 * Draw a zone on the listings map with a finger (the owner's app design).
 *
 * The pencil puts a clear layer over the map that takes the touch instead of
 * the map: the path is drawn as it goes, and on release it is thinned to a
 * few corners (lib/mapZone.js), turned into places on the ground and handed
 * to `onZone`. A tap or a slip is not a shape and changes nothing. The zone
 * in force (`zone`, from the URL) is drawn on the map itself as a dashed
 * outline with a faint fill, and "Effacer la zone" removes it.
 *
 * Nothing here filters listings: the zone goes into the URL (ListingsMap) and
 * the server narrows the search to it.
 */
export default function MapZoneDraw({ map, zone = null, onZone, enabled = false }) {
  const t = useT();
  const [allowed, setAllowed] = useState(ZONE_DRAW_PUBLIC);
  const [drawing, setDrawing] = useState(false);
  const [path, setPath] = useState([]);
  const pathRef = useRef([]);
  const layerRef = useRef(null);
  const activeRef = useRef(false);
  const shapesRef = useRef([]);

  // Private switch while the drawing is being checked on real phones.
  useEffect(() => {
    if (ZONE_DRAW_PUBLIC) return;
    try {
      if (window.localStorage.getItem('lp_zone') === '1') setAllowed(true);
    } catch {
      /* no storage: the pencil stays hidden */
    }
  }, []);

  // The zone in force, drawn by the map itself so it pans and zooms with it.
  useEffect(() => {
    for (const shape of shapesRef.current) shape.setMap(null);
    shapesRef.current = [];
    if (!map || !zone || !window.google?.maps) return undefined;
    const ring = [...zone, zone[0]];
    const fill = new window.google.maps.Polygon({
      map, paths: zone, clickable: false, strokeOpacity: 0, fillColor: ZONE_BLUE, fillOpacity: 0.07, zIndex: 1,
    });
    const outline = new window.google.maps.Polyline({
      map,
      path: ring,
      clickable: false,
      strokeOpacity: 0,
      zIndex: 2,
      icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: ZONE_BLUE, scale: 2.5 }, offset: '0', repeat: '11px' }],
    });
    shapesRef.current = [fill, outline];
    return () => {
      fill.setMap(null);
      outline.setMap(null);
    };
  }, [map, zone]);

  const stop = useCallback(() => {
    activeRef.current = false;
    pathRef.current = [];
    setPath([]);
    setDrawing(false);
  }, []);

  useEffect(() => {
    if (!drawing) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, stop]);

  function pointOf(event) {
    const box = layerRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  function onDown(event) {
    if (event.button > 0) return;
    activeRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pathRef.current = [pointOf(event)];
    setPath(pathRef.current);
  }
  function onMove(event) {
    if (!activeRef.current) return;
    const point = pointOf(event);
    const last = pathRef.current[pathRef.current.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 3) return;
    pathRef.current = [...pathRef.current, point];
    setPath(pathRef.current);
  }
  function onUp() {
    if (!activeRef.current) return;
    activeRef.current = false;
    const corners = simplifyScreenPath(pathRef.current);
    const places = corners && map ? corners.map((p) => toLatLng(map, p.x, p.y)) : null;
    if (places && places.every(Boolean)) {
      onZone?.(places);
      stop();
    } else {
      // Not a shape: stay in drawing mode for another try.
      pathRef.current = [];
      setPath([]);
    }
  }

  if (!enabled || !allowed || !map) return null;

  return (
    <>
      {drawing ? (
        <div
          ref={layerRef}
          role="application"
          aria-label={t('listings.zone.hint')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="absolute inset-0 z-30 cursor-crosshair touch-none bg-blue-900/10"
        >
          {path.length > 1 ? (
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
              <polyline
                points={path.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={ZONE_BLUE}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="2 8"
              />
            </svg>
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 top-[7.75rem] flex justify-center px-4 lg:top-4">
            <p className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink py-1.5 pl-4 pr-1.5 text-[0.8125rem] font-semibold text-white shadow-[var(--shadow-md)]">
              {t('listings.zone.hint')}
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={stop}
                aria-label={t('listings.zone.cancel')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15"
              >
                <X strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
              </button>
            </p>
          </div>
        </div>
      ) : null}

      {!drawing ? (
        <div className="pointer-events-none absolute bottom-[9.5rem] right-3 z-20 flex flex-col items-end gap-2 lg:bottom-auto lg:top-[4.25rem]">
          {zone ? (
            <button
              type="button"
              onClick={() => onZone?.(null)}
              className="u-press pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-3.5 text-[0.8125rem] font-semibold text-ink shadow-[var(--shadow-md)]"
            >
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('listings.zone.clear')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setDrawing(true)}
            aria-label={t(zone ? 'listings.zone.redraw' : 'listings.zone.draw')}
            title={t(zone ? 'listings.zone.redraw' : 'listings.zone.draw')}
            className="u-press pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue text-white shadow-[var(--shadow-md)]"
          >
            <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
