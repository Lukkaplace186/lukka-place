'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import PropertyCard from './PropertyCard';
import SectionHeading from './SectionHeading';
import { getRecentIds, getServerRecentIds, subscribeRecent } from '@/lib/recentlyViewed';
import { useT } from '@/lib/i18n/client';

/**
 * "Récemment consultés" — the listings this browser opened, newest first,
 * so someone comparing three flats can get back to the other two without
 * searching again. Reads lib/recentlyViewed.js (localStorage) and turns the
 * ids into real listings through GET /api/listings?ids=, which applies the
 * public gate: a listing unpublished since simply drops out.
 *
 * Renders nothing until there is something to show (`minItems`), and
 * nothing on the server — the list only exists in this browser.
 */
export default function RecentlyViewed({ excludeId = null, minItems = 1, className = '' }) {
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
