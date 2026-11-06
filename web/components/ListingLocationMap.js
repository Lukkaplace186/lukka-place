'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Info, MapPin } from 'lucide-react';
import ResponsiveMapPane from './ResponsiveMapPane';
import { storedPosition } from '@/lib/listingPin';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useSaveData } from '@/lib/useSaveData';
import { useT } from '@/lib/i18n/client';

const ListingPinMap = dynamic(() => import('./ListingPinMap'), { ssr: false });

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
 *   - stored coordinates AND `staticMapSrc` (NEXT_PUBLIC_STATIC_LISTING_MAP=on,
 *     lib/staticMap.js) → the same zone as ONE Static Maps image: one
 *     request instead of ~200 KB of Maps JS in four or five round trips plus
 *     tiles. A tap, or an image that fails to load, opens ListingPinMap;
 *   - stored coordinates otherwise → ListingPinMap: this listing
 *     alone, as a big blue pin with a symbol for its type and its price,
 *     at zoom 14 (a comparison with nearby listings was tried and reverted
 *     the same day, on product direction);
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
export default function ListingLocationMap({ listing, staticMapSrc = null }) {
  const t = useT();
  const lightData = useSaveData();
  const frameRef = useRef(null);
  const [requested, setRequested] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const position = useMemo(() => storedPosition(listing), [listing]);
  // `staticMapSrc` (lib/staticMap.js listingStaticMapSrc, built on the
  // server so its place data never ships to the browser) shows the map as
  // ONE image. A tap, or an image that fails to load, swaps in the
  // interactive map.
  const [interactive, setInteractive] = useState(false);
  const staticSrc = position ? staticMapSrc : null;

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
          position && staticSrc && !interactive ? (
            <button
              type="button"
              onClick={() => setInteractive(true)}
              aria-label={t('listings.map.show')}
              className="relative block h-full w-full bg-canvas-alt"
            >
              {/* A plain <img>: Google serves and caches it; next/image would
                  route it through our Paris server for nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={staticSrc}
                alt=""
                decoding="async"
                onError={() => setInteractive(true)}
                className="h-full w-full object-cover"
              />
              <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.75rem] font-semibold text-ink shadow-sm">
                <Info strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-blue" aria-hidden="true" />
                {t('listings.map.zoneApprox')}
              </span>
            </button>
          ) : position ? (
            <ListingPinMap listing={listing} position={position} />
          ) : (
            <ResponsiveMapPane
              listings={[listing]}
              isMapView
              hoveredId={null}
              onMarkerHover={() => {}}
              maxZoom={14}
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
