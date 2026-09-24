'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MapPin, X } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { baseMapOptions } from '@/lib/mapBase';
import { createPinLayer } from '@/lib/mapPinLayer';
import { KINSHASA_DEFAULT_VIEW } from '@/lib/mapViewport';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/**
 * The /projets map — its OWN map, showing projects only, so developments
 * never crowd the listings map (product decision, 2026-09-24). Same basemap,
 * same HTML pill layer (lib/mapPinLayer.js) as /listings; the pills are ink
 * rather than white (`.lkp-projects` in globals.css) so a project never reads
 * as a listing price.
 *
 * Positions come from the server (lib/developments.js projectPosition): the
 * project's own coordinates, else its commune centroid, flagged approximate
 * and said so in the preview. A project with neither has no pin.
 *
 * `single` is the project page's own map: one pin, no preview card, and on a
 * phone it loads only when asked (the Maps JS API is ~245 KB; web/CLAUDE.md,
 * "Mobile performance").
 *
 * @param {{pins: Array<{id:number, slug:string, name:string, lat:number, lng:number,
 *   approximate:boolean, verified:boolean, label:string, subtitle:string|null,
 *   cover:string|null, coverIsRender:boolean}>, single?: boolean, className?: string}} props
 */
export default function ProjectsMap({ pins, single = false, className = '' }) {
  const t = useT();
  // Desktop loads by itself; a phone waits for a tap. Safe to read `window`
  // here: this module is only ever loaded client-side (ProjectsMapPane,
  // next/dynamic with ssr: false).
  const [requested, setRequested] = useState(() => !single || window.matchMedia('(min-width: 1024px)').matches);

  if (!requested) {
    return (
      <div className={`flex min-h-32 items-center justify-center rounded-card border border-line bg-canvas-alt ${className}`}>
        <button
          type="button"
          onClick={() => setRequested(true)}
          className="u-press inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-5 text-sm font-semibold text-ink shadow-sm"
        >
          <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('projects.map.show')}
        </button>
      </div>
    );
  }
  return <LoadedMap pins={pins} single={single} className={className} />;
}

function LoadedMap({ pins, single, className }) {
  const t = useT();
  const elementRef = useRef(null);
  const layerRef = useRef(null);
  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!MAPS_API_KEY) return undefined;
    let cancelled = false;
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });
    importLibrary('maps')
      .then(() => {
        if (cancelled || !elementRef.current) return;
        const map = new google.maps.Map(elementRef.current, {
          ...baseMapOptions(),
          center: KINSHASA_DEFAULT_VIEW.center,
          zoom: KINSHASA_DEFAULT_VIEW.zoom,
        });
        const layer = createPinLayer(map, {
          onClick: (pin) => {
            if (single) return;
            layer.setActive(pin.id);
            setSelected(pin.payload);
          },
          onHover: () => {},
        });
        layerRef.current = layer;
        map.addListener('click', () => {
          layer.setActive(null);
          setSelected(null);
        });

        layer.setPins(pins.map((pin) => ({
          key: `project:${pin.id}`,
          id: String(pin.id),
          lat: pin.lat,
          lng: pin.lng,
          label: pin.label,
          title: pin.name,
          building: false,
          verified: pin.verified,
          zIndex: pin.verified ? 10 : 0,
          payload: pin,
        })));

        if (pins.length === 1) {
          map.setCenter({ lat: pins[0].lat, lng: pins[0].lng });
          map.setZoom(pins[0].approximate ? 14 : 16);
        } else if (pins.length > 1) {
          const bounds = new google.maps.LatLngBounds();
          for (const pin of pins) bounds.extend({ lat: pin.lat, lng: pin.lng });
          map.fitBounds(bounds, 64);
          google.maps.event.addListenerOnce(map, 'idle', () => {
            if (map.getZoom() > 15) map.setZoom(15);
          });
        }
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[ProjectsMap] Maps failed to load', err);
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      layerRef.current?.destroy();
      layerRef.current = null;
    };
    // Pins come from the server render; a new set is a new page.
  }, [pins, single]);

  return (
    <div className={`lkp-projects relative overflow-hidden rounded-card border border-line bg-canvas-alt ${className}`}>
      <div ref={elementRef} className="h-full w-full" />
      {status === 'loading' ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-45">{t('projects.map.loading')}</div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-70">{t('projects.map.unavailable')}</div>
      ) : null}
      {single && pins[0]?.approximate ? (
        <p className="absolute bottom-2 left-2 rounded bg-surface/95 px-2 py-1 text-[0.75rem] text-ink-70 shadow-sm">
          {t('projects.map.approximate')}
        </p>
      ) : null}
      {selected ? (
        <div className="u-rise absolute inset-x-3 bottom-8 z-10 mx-auto flex max-w-md items-stretch gap-3 overflow-hidden rounded-card bg-surface p-2 shadow-lg">
          <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-canvas-alt">
            {selected.cover ? (
              <SafeImage src={selected.cover} alt={selected.name} fill sizes="96px" className="object-cover" />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 pr-6">
            <Link href={`/projets/${selected.slug}`} className="truncate font-semibold text-ink hover:underline">
              {selected.name}
            </Link>
            {selected.subtitle ? <p className="truncate text-[0.8125rem] text-ink-70">{selected.subtitle}</p> : null}
            {selected.approximate ? <p className="text-[0.75rem] text-ink-45">{t('projects.map.approximateShort')}</p> : null}
            <Link href={`/projets/${selected.slug}`} className="text-[0.8125rem] font-semibold text-blue-deep hover:underline">
              {t('projects.map.open')}
            </Link>
          </div>
          <button
            type="button"
            aria-label={t('projects.map.close')}
            onClick={() => {
              layerRef.current?.setActive(null);
              setSelected(null);
            }}
            className="u-hit absolute right-2 top-2 rounded-full p-1 text-ink-45 hover:text-ink"
          >
            <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
