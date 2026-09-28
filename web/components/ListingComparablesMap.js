'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import SafeImage from './SafeImage';
import Price from './Price';
import { createPinLayer } from '@/lib/mapPinLayer';
import { baseMapOptions } from '@/lib/mapBase';
import { placeResolvedListings } from '@/lib/geocoding';
import { spreadColocatedPins } from '@/lib/mapPinSpread';
import { compactPrice, priceZIndex } from '@/lib/mapIcons';
import { formatPrice } from '@/lib/format';
import { comparablesQuery, pickComparables } from '@/lib/comparables';
import { listingImages, specItems, typeLabel } from '@/lib/listingView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAX_ZOOM = 15;
const FEATURED_Z = 2000000;

/**
 * The detail page's map, as a comparison (2026-09-28): this listing is one
 * big royal-blue pill with its full price, and listings like it nearby
 * (lib/comparables.js: same purpose, same type, same bedroom count, within
 * 3 km) are small pills with their compact price. Tapping a small pill opens
 * a mini card with a link to that listing.
 *
 * Pins go through the /listings map's own placement (placeResolvedListings,
 * then spreadColocatedPins), so this listing's pin — and every comparable's —
 * sits on the same privacy-jittered point it has on /listings.
 *
 * `position` is the listing's stored coordinate (lib/comparables.js's
 * storedPosition); the caller only mounts this component when it has one.
 */
export default function ListingComparablesMap({ listing, position }) {
  const t = useT();
  const mapElementRef = useRef(null);
  const layerRef = useRef(null);
  const detailsRef = useRef(new Map());
  const [status, setStatus] = useState(() => (MAPS_API_KEY ? 'loading' : 'error'));
  const [count, setCount] = useState(0);
  const [selected, setSelected] = useState(null);
  const selectedIdRef = useRef(null);

  const openPreview = useCallback((id) => {
    selectedIdRef.current = id;
    layerRef.current?.setActive(id);
    if (id == null) {
      setSelected(null);
      return;
    }
    const cached = detailsRef.current.get(id);
    if (cached) {
      setSelected(cached);
      return;
    }
    fetch(`/api/listings?ids=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((body) => {
        const found = (body.data || [])[0];
        if (!found) return;
        detailsRef.current.set(id, found);
        if (selectedIdRef.current === id) setSelected(found);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!MAPS_API_KEY) {
      console.error('[ListingComparablesMap] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set');
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setOptions({ key: MAPS_API_KEY, v: 'weekly' });

    const query = comparablesQuery(listing, position);
    const comparablesPromise = query
      ? fetch(`/api/listings/map?${query.toString()}`, { signal: controller.signal })
          .then((r) => (r.ok ? r.json() : { markers: [] }))
          .then((body) => pickComparables(body.markers, listing, position))
          .catch(() => [])
      : Promise.resolve([]);

    Promise.all([importLibrary('maps'), comparablesPromise])
      .then(([, comparables]) => {
        if (cancelled || !mapElementRef.current) return;
        const map = new google.maps.Map(mapElementRef.current, {
          ...baseMapOptions(),
          center: position,
          zoom: MAX_ZOOM,
        });
        map.addListener('click', () => openPreview(null));

        const bases = [
          { id: listing.id, featured: true, base: { lat: position.lat, lng: position.lng, source: 'existing', precise: true } },
          ...comparables.map((m) => ({
            id: m.id,
            marker: m,
            base: {
              lat: m.lat,
              lng: m.lng,
              source: m.approximate ? 'commune_fallback' : 'existing',
              precise: !m.approximate,
              exact: Boolean(m.exact),
            },
          })),
        ];
        const placements = placeResolvedListings(bases);
        const placed = bases
          .map((b) => ({ ...b, point: placements.get(b.id) }))
          .filter((b) => b.point);
        const positions = spreadColocatedPins(placed.map((b) => ({ id: b.id, lat: b.point.lat, lng: b.point.lng })));

        const pins = [];
        const bounds = new google.maps.LatLngBounds();
        for (const b of placed) {
          const p = positions.get(b.id);
          if (!p) continue;
          bounds.extend(p);
          if (b.featured) {
            pins.push({
              key: `self-${b.id}`,
              id: `self-${b.id}`,
              lat: p.lat,
              lng: p.lng,
              label: formatPrice(listing.price, listing.purpose, listing.price_period),
              title: listing.title || '',
              building: false,
              verified: listing.verified_at != null,
              zIndex: FEATURED_Z,
              variant: 'featured',
            });
          } else {
            const m = b.marker;
            pins.push({
              key: String(m.id),
              id: String(m.id),
              lat: p.lat,
              lng: p.lng,
              label: compactPrice(m.price, m.purpose, { pricePeriod: m.price_period }),
              title: m.title || '',
              building: false,
              verified: Boolean(m.verified),
              zIndex: priceZIndex(m.price),
              variant: 'minor',
            });
          }
        }

        layerRef.current = createPinLayer(map, {
          onClick: (pin) => {
            if (pin.variant === 'featured') return;
            openPreview(selectedIdRef.current === pin.id ? null : pin.id);
          },
          onHover: () => {},
        });
        layerRef.current.setPins(pins);
        setCount(pins.length - 1);

        if (pins.length > 1) {
          // Room at the top for the pills' height, and for the legend.
          map.fitBounds(bounds, { top: 72, right: 40, bottom: 32, left: 40 });
          google.maps.event.addListenerOnce(map, 'idle', () => {
            if (map.getZoom() > MAX_ZOOM) map.setZoom(MAX_ZOOM);
          });
        }
        setStatus('ready');
      })
      .catch((err) => {
        console.error('[ListingComparablesMap] failed to load Google Maps', err);
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
      layerRef.current?.destroy();
      layerRef.current = null;
    };
  }, [listing, position, openPreview]);

  const beds = Number.parseInt(listing.beds, 10) > 0 ? Number.parseInt(listing.beds, 10) : null;

  return (
    <div className="lkp-compare relative h-full w-full overflow-hidden">
      <div ref={mapElementRef} className="h-full w-full" />

      {status === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas-alt text-sm text-ink-45">
          {t('listings.map.loading')}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface p-6 text-center text-sm text-ink-45">
          {t('listings.map.loadError')}
        </div>
      ) : null}

      {status === 'ready' && count > 0 ? (
        <div className="pointer-events-none absolute left-2.5 top-2.5 z-20 flex max-w-[calc(100%-1.25rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-line bg-surface px-3 py-1.5 text-[0.75rem] font-medium text-ink-70 shadow-sm">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-blue" />
            {t('listings.map.compareSelf')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm border border-ink-25 bg-surface" />
            {beds
              ? t('listings.map.compareLegendBeds', { count, beds })
              : t('listings.map.compareLegend', { count })}
          </span>
        </div>
      ) : null}

      {selected ? (
        <ComparablePreview
          key={selected.id}
          listing={selected}
          onClose={() => openPreview(null)}
        />
      ) : null}
    </div>
  );
}

/** The mini card a small pin opens: thumbnail, price, type and specs, a link. */
function ComparablePreview({ listing, onClose }) {
  const t = useT();
  const href = `/listings/${encodeURIComponent(listing.id)}`;
  const image = listingImages(listing)[0] || null;
  const type = typeLabel(listing, t);
  const specs = specItems(listing, t)
    .filter((s) => s.key !== 'units')
    .map((s) => (s.key === 'area' ? `${s.value} m²` : `${s.value} ${s.label}`));
  const place = listing.quartier || listing.commune || '';

  return (
    <div role="dialog" aria-label={listing.title || t('listings.map.viewDetails')} className="u-rise absolute inset-x-2.5 bottom-2.5 z-30 mx-auto max-w-sm">
      <div className="u-lift-lg relative flex overflow-hidden rounded-xl border border-line bg-surface">
        <Link href={href} className="relative block h-24 w-24 shrink-0 bg-canvas-deep">
          {image ? <SafeImage src={image} alt={listing.title || ''} fill sizes="96px" className="object-cover" /> : null}
        </Link>
        <Link href={href} className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pl-3 pr-10">
          <span className="u-tabular truncate text-[1rem] font-semibold leading-tight text-ink">
            <Price
              amount={listing.price}
              purpose={listing.purpose}
              pricePeriod={listing.price_period}
              currency={listing.currency}
              priceOriginal={listing.price_original}
            />
          </span>
          <span className="truncate text-[0.75rem] text-ink-70">{[type, ...specs].filter(Boolean).join(' · ')}</span>
          {place ? <span className="truncate text-[0.75rem] text-ink-45">{place}</span> : null}
          <span className="mt-0.5 text-[0.75rem] font-semibold text-blue">{t('listings.map.viewDetails')}</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('listings.map.closePreview')}
          className="u-press u-hit absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-45 hover:bg-canvas-alt hover:text-ink"
        >
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
