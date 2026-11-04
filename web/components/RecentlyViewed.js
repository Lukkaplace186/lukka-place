'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import PropertyCard from './PropertyCard';
import Price from './Price';
import SafeImage from './SafeImage';
import SectionHeading from './SectionHeading';
import { getRecentIds, getServerRecentIds, subscribeRecent } from '@/lib/recentlyViewed';
import { useT } from '@/lib/i18n/client';
import { listingImages } from '@/lib/listingView';
import { placeLabel } from '@/lib/placeLabel';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Récemment consultés" — the listings this browser opened, newest first,
 * so someone comparing three flats can get back to the other two without
 * searching again. Reads lib/recentlyViewed.js (localStorage) and turns the
 * ids into real listings through GET /api/listings?ids=, which applies the
 * public gate: a listing unpublished since simply drops out.
 *
 * Renders nothing until there is something to show (`minItems`), and
 * nothing on the server — the list only exists in this browser.
 *
 * `variant="strip"` is the homepage's version (2026-11-04 landing pass): one
 * slim line under the search — a small photo, the price and the place per
 * listing — instead of a full section of cards, and only from two listings
 * up (the page passes minItems 2). One card alone took a whole screen for
 * something the visitor had just seen. The listing page keeps the cards.
 */
export default function RecentlyViewed({ excludeId = null, minItems = 1, variant = 'cards', className = '' }) {
  const t = useT();
  const ids = useSyncExternalStore(subscribeRecent, getRecentIds, getServerRecentIds);
  const wanted = useMemo(
    () => ids.filter((id) => id !== String(excludeId ?? '')).slice(0, 8),
    [ids, excludeId],
  );
  const key = wanted.join(',');

  const [result, setResult] = useState({ key: '', listings: [] });

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    fetch(`/api/listings?ids=${key}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        const byId = new Map((body?.data || []).map((listing) => [String(listing.id), listing]));
        setResult({ key, listings: key.split(',').map((id) => byId.get(id)).filter(Boolean) });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [key]);

  const listings = key && result.key === key ? result.listings : [];
  if (listings.length < minItems) return null;
  if (variant === 'strip') return <RecentStrip listings={listings} label={t('listings.recent.title')} className={className} />;

  return (
    // pt-6/pb-1 on a phone (was py-12 + the rail's pb-4): with the next
    // section's own top padding that left ~100px of blank band between two
    // rails (reported 2026-10-06). The rail keeps a little bottom room for
    // card shadows.
    <section className={`pt-6 pb-1 sm:py-12 ${className}`}>
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow={t('listings.recent.eyebrow')} title={t('listings.recent.title')} className="mb-4 sm:mb-6" />
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:pb-4">
          {listings.map((listing) => (
            <div key={listing.id} className="w-[17rem] shrink-0 snap-start sm:w-[19rem]">
              <PropertyCard listing={listing} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentStrip({ listings, label, className }) {
  return (
    <section aria-label={label} className={`bg-canvas ${className}`}>
      <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-4 pt-6 sm:px-6 sm:pt-9 lg:px-8">
        <p className="hidden shrink-0 items-center gap-2 text-[0.8125rem] font-semibold text-ink-45 md:flex">
          <History strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />
          {label}
        </p>
        <ul className="no-scrollbar -mx-4 flex min-w-0 flex-1 gap-5 overflow-x-auto px-4 sm:mx-0 sm:gap-7 sm:px-0">
          {listings.map((listing) => {
            const photo = listingImages(listing)[0];
            const place = placeLabel(listing);
            return (
              <li key={listing.id} className="shrink-0">
                <Link href={`/listings/${listing.id}`} className="u-press group flex min-h-14 items-center gap-3 rounded-xl pr-2">
                  <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-canvas-deep">
                    {photo ? <SafeImage src={photo} alt="" fill sizes="56px" className="object-cover" /> : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="u-tabular whitespace-nowrap text-[0.9375rem] font-bold text-ink">
                      <Price
                        amount={listing.price}
                        purpose={listing.purpose}
                        pricePeriod={listing.price_period}
                        periodClassName="ml-1 text-[0.75rem] font-normal tracking-normal text-ink-45"
                      />
                    </span>
                    {place ? (
                      <span className="max-w-[13rem] truncate text-[0.8125rem] text-ink-45 group-hover:text-ink">{place}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
