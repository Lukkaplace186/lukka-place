'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';
import ResponsiveMapPane from './ResponsiveMapPane';
import { storedPosition } from '@/lib/comparables';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useSaveData } from '@/lib/useSaveData';
import { useT } from '@/lib/i18n/client';

const ListingComparablesMap = dynamic(() => import('./ListingComparablesMap'), { ssr: false });

/**
 * The detail page's "Emplacement" map.
 *
 * LOADS BY ITSELF, when the frame comes within 400px of the viewport, on
 * every screen size (2026-09-28, on product direction: "I prefer the map to
 * load automatically without forcing users to tap"). It used to wait for a
 * tap below 1024px to save phone data — the Maps JS API is ~245 KB of script
 * plus tiles. It still never loads for a visitor who does not scroll this
 * far, and a visitor with Data Saver on or a 2G connection (lib/useSaveData)
 * still gets the "Afficher la carte" button: they told their browser to
 * spare their data. Until the map arrives the frame shows a light
 * placeholder at the map's full height, so nothing shifts when it does.
 *
 * WHICH MAP:
 *   - the listing has stored coordinates → ListingComparablesMap: this
 *     listing as a big pin, comparable listings nearby as small ones
 *     (lib/comparables.js);
 *   - it has none → the geocoding single-pin map (ResponsiveMapPane →
 *     PropertyMap), which can still find its street from the address.
 *
 * `isMapView` is forced true so ResponsiveMapPane mounts the map on mobile
 * too — its matchMedia gate exists to protect the Geocoding quota on
 * /listings. The explicit height on the frame is load-bearing: both maps'
 * root divs are `h-full`, which resolves to 0 without an ancestor that
 * actually has a height (that collapse shipped once, as an invisible map
 * above its caption).
 */
export default function ListingLocationMap({ listing }) {
  const t = useT();
  const lightData = useSaveData();
  const frameRef = useRef(null);
  const [requested, setRequested] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const position = useMemo(() => storedPosition(listing), [listing]);

  useEffect(() => {
    if (requested || nearViewport || lightData) return undefined;
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [requested, nearViewport, lightData]);

  const show = requested || nearViewport;
  // Data Saver / 2G, before a tap: the short "Afficher la carte" strip.
  const asking = lightData && !show;

  return (
    <div>
      <div
        ref={frameRef}
        className={`u-card overflow-hidden rounded-lg border border-line ${
          asking ? 'h-32 lg:h-[26rem]' : 'h-[22rem] sm:h-[26rem]'
        }`}
      >
        {show ? (
          position ? (
            <ListingComparablesMap listing={listing} position={position} />
          ) : (
            <ResponsiveMapPane
              listings={[listing]}
              isMapView
              hoveredId={null}
              onMarkerHover={() => {}}
              maxZoom={15}
              listingPreview={false}
              className="h-full"
            />
          )
        ) : asking ? (
          <button
            type="button"
            onClick={() => setRequested(true)}
            className="flex h-full w-full flex-col items-center justify-center gap-2 bg-canvas-alt px-6 text-center lg:gap-3"
          >
            <span className="hidden h-12 w-12 place-items-center rounded-full bg-surface text-blue shadow-sm lg:grid">
              <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="inline-flex min-h-11 items-center rounded-full bg-blue px-5 text-[0.9375rem] font-semibold text-white">
              {t('listings.map.show')}
            </span>
            <span className="max-w-xs text-[0.8125rem] leading-relaxed text-ink-45">{t('listings.map.showHint')}</span>
          </button>
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-canvas-alt">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-surface text-blue shadow-sm">
              <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            </span>
          </div>
        )}
      </div>
      <p className="mt-2.5 text-[0.75rem] text-ink-45">
        Localisation approximative, affichée à l&apos;échelle du quartier pour préserver la confidentialité du bien.
      </p>
    </div>
  );
}
