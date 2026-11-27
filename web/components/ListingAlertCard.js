'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { BellRing } from 'lucide-react';
import QueryAlertButton from './QueryAlertButton';
import { isSearchSaved, subscribeSavedSearches } from '@/lib/favorites';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const ENTRY = 'listing_alert';

/**
 * "Recevez les biens comme celui-ci" in the middle of a listing page, on a
 * phone (2026-11-24, owner: "almost nobody is asked"). 81 % of visitors see
 * one page — usually a listing, from an ad — and the page's only alert offer
 * sat at the very bottom, under the similar listings. Scrolls by like the
 * rest of the page, no pop-up.
 *
 * The alert is the listing's "homes like this one" search
 * (lib/similarSearch.js similarAlertQuery: same rent / sale, commune, type,
 * bedrooms, price ±30 %). QueryAlertButton does the rest: a guest gets the
 * number-and-name form and lands on those results with the alert saved; a
 * signed-in customer confirms. Nothing when the listing states too little to
 * search on, or when that alert is already saved. "Shown" counts once, when
 * the card has actually been on screen.
 *
 * @param {{query: string|null}} props
 */
export default function ListingAlertCard({ query }) {
  const t = useT();
  const ref = useRef(null);
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => (query ? isSearchSaved(query) : false),
    () => false,
  );
  const visible = Boolean(query) && !saved;

  useEffect(() => {
    if (!visible || !ref.current || typeof IntersectionObserver === 'undefined') return undefined;
    const node = ref.current;
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        trackCustomerSignup('prompt_shown', ENTRY);
        seen.disconnect();
      }
    }, { threshold: 0.5 });
    seen.observe(node);
    return () => seen.disconnect();
  }, [visible]);

  if (!visible) return null;
  return (
    <aside
      ref={ref}
      aria-labelledby="listing-alert-title"
      className="flex flex-col gap-3 rounded-2xl border border-blue/30 bg-surface p-5"
    >
      <div className="flex min-w-0 gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p id="listing-alert-title" className="text-[0.9375rem] font-semibold text-ink">{t('listings.listingAlert.title')}</p>
          <p className="mt-1 text-[0.8125rem] text-ink-70">{t('listings.listingAlert.body')}</p>
        </div>
      </div>
      <QueryAlertButton query={query} label={t('listings.listingAlert.button')} entry={ENTRY} fullWidth />
      <p className="text-[0.75rem] text-ink-45">{t('listings.feedAlert.footnote')}</p>
    </aside>
  );
}
