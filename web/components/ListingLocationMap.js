'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import ResponsiveMapPane from './ResponsiveMapPane';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useSaveData } from '@/lib/useSaveData';
import { useT } from '@/lib/i18n/client';

/** Wide enough that the map sits beside the content rather than at the bottom of a phone-length page. */
const AUTOLOAD_QUERY = '(min-width: 1024px)';

/**
 * Single-property map for the detail page — reuses the exact same pipeline
 * as /listings (lib/geocoding.js: real geocode, then commune-centroid
 * fallback, then a deterministic 200-400m privacy jitter seeded by listing
 * id). Nothing here places a pin at an invented coordinate; a listing that
 * resolves to nothing renders the map's own empty state.
 *
 * The privacy note below is not decoration: every pin on this site is a
 * resolved approximation, and saying so is the honest version of what the
 * reference portals label "approximate location".
 *
 * LOADED ON REQUEST ON A PHONE. The Maps JS API is ~245 KB of script
 * (measured on lukkaplace.com at 375px: main 83, util 71, common 38, map 26,
 * marker 21, geocoder 3) plus tiles and a billable geocode, and it used to
 * load the moment a listing page opened — far below the fold, before anyone
 * had scrolled to it. Most of our visitors pay per megabyte. So:
 *   - below 1024px, or with Data Saver on at any width, the frame shows a
 *     "Afficher la carte" button and nothing is fetched until it is tapped;
 *   - on a desktop it still loads by itself, but only once the frame comes
 *     within 400px of the viewport.
 * On a desktop the frame keeps its full height either way, so nothing shifts
 * when the map arrives by itself. Below 1024px the unloaded frame is a short
 * strip instead of a 22rem empty box: there the map only ever arrives from a
 * tap, and a layout change right after the visitor's own input is expected
 * (it is not counted as layout shift).
 *
 * `isMapView` is forced true so ResponsiveMapPane mounts the map on mobile
 * too once asked — its matchMedia gate exists to protect the Geocoding quota
 * on /listings. The explicit height on the frame is load-bearing:
 * ResponsiveMapPane's wrapper and PropertyMap's root div are both `h-full`,
 * which resolves to 0 without an ancestor that actually has a height (that
 * collapse shipped once, as an invisible map above its caption).
 */
export default function ListingLocationMap({ listing }) {
  const t = useT();
  const lightData = useSaveData();
  const frameRef = useRef(null);
  const [requested, setRequested] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    if (requested || nearViewport || lightData) return undefined;
    if (!window.matchMedia(AUTOLOAD_QUERY).matches) return undefined;
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

  return (
    <div>
      <div
        ref={frameRef}
        className={`u-card overflow-hidden rounded-lg border border-line ${
          show ? 'h-[22rem] sm:h-[26rem]' : 'h-32 lg:h-[26rem]'
        }`}
      >
        {show ? (
          <ResponsiveMapPane
            listings={[listing]}
            isMapView
            hoveredId={null}
            onMarkerHover={() => {}}
            maxZoom={15}
            listingPreview={false}
            className="h-full"
          />
        ) : (
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
        )}
      </div>
      <p className="mt-2.5 text-[0.75rem] text-ink-45">
        Localisation approximative, affichée à l&apos;échelle du quartier pour préserver la confidentialité du bien.
      </p>
    </div>
  );
}
