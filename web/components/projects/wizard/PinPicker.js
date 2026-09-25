'use client';

import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { Crosshair, LocateFixed, MapPin, Trash2 } from 'lucide-react';
import { baseMapOptions } from '@/lib/mapBase';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Where the project is: the developer moves the MAP under a fixed centre pin
 * (the ride-hailing pattern — one finger, no marker to grab on a small
 * screen) or taps "Je suis sur le chantier" to use the phone's position. The
 * point is written into hidden `latitude` / `longitude` inputs of the
 * surrounding form; the server re-checks it against the commune
 * (developmentRules.pinWithinCommune).
 *
 * Opens on the stored pin, else on the chosen commune's centroid. Without a
 * map (no key, blocked, offline) the two numbers are typed instead — the
 * pin is optional, and a project without one sits at its commune centroid,
 * labelled approximate.
 *
 * Labels come resolved from the server page (this component is used under the
 * agent layout, whose dictionary does not carry the public `projects.*` keys).
 */
export default function PinPicker({ initial = null, centre, labels }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const [point, setPoint] = useState(initial);
  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'manual'));
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!MAPS_API_KEY) return undefined;
    let cancelled = false;
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });
    importLibrary('maps')
      .then(() => {
        if (cancelled || !elementRef.current) return;
        const start = initial || centre;
        const map = new google.maps.Map(elementRef.current, {
          ...baseMapOptions(),
          center: start,
          zoom: initial ? 17 : 15,
          streetViewControl: false,
          mapTypeControl: true,
          mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
        });
        mapRef.current = map;
        map.addListener('idle', () => {
          const c = map.getCenter();
          if (c) setPoint({ lat: round(c.lat()), lng: round(c.lng()) });
        });
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[PinPicker] Maps failed to load', err);
        if (!cancelled) setStatus('manual');
      });
    return () => {
      cancelled = true;
    };
    // The map is created once; moving it is the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setMessage(labels.locateUnavailable);
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        const next = { lat: round(position.coords.latitude), lng: round(position.coords.longitude) };
        setPoint(next);
        mapRef.current?.panTo(next);
        mapRef.current?.setZoom(18);
      },
      () => {
        setLocating(false);
        setMessage(labels.locateRefused);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  function clear() {
    setPoint(null);
    if (mapRef.current) mapRef.current.panTo(centre);
  }

  const manual = status === 'manual';

  return (
    <div className="flex flex-col gap-3">
      {!manual ? (
        <div className="relative h-72 overflow-hidden rounded-card border border-line bg-canvas-alt sm:h-96">
          <div ref={elementRef} className="h-full w-full" />
          {status === 'loading' ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-45">{labels.loading}</div>
          ) : null}
          {status === 'ready' ? (
            <>
              {/* The fixed centre pin: its tip is the map's centre. */}
              <MapPin
                aria-hidden="true"
                strokeWidth={2}
                className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-full fill-blue text-white drop-shadow"
              />
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
              <p className="pointer-events-none absolute inset-x-3 top-3 mx-auto w-fit rounded-full bg-surface/95 px-3 py-1 text-[0.75rem] font-semibold text-ink shadow-sm">
                {labels.dragHint}
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg bg-canvas-alt px-3 py-2 text-[0.8125rem] text-ink-70">{labels.manualHint}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={locate}
          disabled={locating}
          className="u-press inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-50"
        >
          <LocateFixed strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {locating ? labels.locating : labels.locate}
        </button>
        {point ? (
          <button type="button" onClick={clear} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-70 hover:text-ink">
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {labels.clear}
          </button>
        ) : null}
        <span className="inline-flex items-center gap-1 text-[0.75rem] text-ink-45">
          <Crosshair strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : labels.noPin}
        </span>
      </div>
      {message ? <p className="text-[0.8125rem] text-danger" role="alert">{message}</p> : null}

      {manual ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink-70">{labels.latitude}</span>
            <input
              inputMode="decimal"
              value={point?.lat ?? ''}
              onChange={(e) => setPoint((p) => ({ lat: e.target.value === '' ? '' : Number(e.target.value), lng: p?.lng ?? '' }))}
              placeholder="-4.3250"
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink-70">{labels.longitude}</span>
            <input
              inputMode="decimal"
              value={point?.lng ?? ''}
              onChange={(e) => setPoint((p) => ({ lat: p?.lat ?? '', lng: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="15.3120"
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
            />
          </label>
        </div>
      ) : null}

      <input type="hidden" name="latitude" value={point && point.lat !== '' ? String(point.lat) : ''} />
      <input type="hidden" name="longitude" value={point && point.lng !== '' ? String(point.lng) : ''} />
    </div>
  );
}
