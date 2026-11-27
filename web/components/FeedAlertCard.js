'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BellRing, ChevronDown } from 'lucide-react';
import QueryAlertButton from './QueryAlertButton';
import { isSearchSaved, subscribeSavedSearches } from '@/lib/favorites';
import { buildSearchLabel } from '@/lib/searchLabel';
import { homeAlertQuery } from '@/lib/homeAlert';
import { feedAlertOffersCommunes, feedAlertQuery, feedAlertReady } from '@/lib/feedAlertRules';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const ENTRY = 'feed_alert';

/**
 * "Recevez les nouveaux biens sur WhatsApp" inside the /listings feed, after
 * the 3rd result (2026-11-24, lib/feedAlertRules.js). A card that scrolls by
 * like a listing — no pop-up — for the paid visitor who looks at one page.
 *
 * - The search has a commune (or another city): one button, the alert for
 *   exactly this search. QueryAlertButton does the rest — the confirmation
 *   when signed in, "Continuer avec WhatsApp" for a guest, and the alert is
 *   saved when they land back here signed in (SaveSearchButton's resume).
 * - No commune yet (the ad's "toutes les villes" landing): a commune first,
 *   since every listing of the city is the feed, not an alert.
 * - Already saved: nothing.
 *
 * "Shown" is counted once, when the card has actually been on screen.
 */
export default function FeedAlertCard({ params = {}, communes = [] }) {
  const t = useT();
  const ref = useRef(null);
  const [commune, setCommune] = useState('');
  const ready = feedAlertReady(params);
  const baseQuery = feedAlertQuery(params);
  const transaction = params.transaction_type === 'vente' ? 'vente' : 'location';
  const pickedQuery = commune
    ? homeAlertQuery({ transaction, commune, price_max: typeof params.price_max === 'string' ? params.price_max : '' })
    : null;
  const query = ready ? baseQuery : pickedQuery;
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => (ready && baseQuery ? isSearchSaved(baseQuery) : false),
    () => false,
  );
  const offerCommunes = !ready && feedAlertOffersCommunes(params) && communes.length > 0;
  const visible = !saved && (ready || offerCommunes);

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
  const label = ready && baseQuery ? buildSearchLabel(new URLSearchParams(baseQuery), t) : '';

  return (
    <aside
      ref={ref}
      aria-labelledby="feed-alert-title"
      className="flex flex-col gap-3 rounded-card border border-blue/30 bg-surface px-5 py-5 shadow-[var(--shadow-card)]"
    >
      <div className="flex min-w-0 gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p id="feed-alert-title" className="text-[0.9375rem] font-semibold text-ink">{t('listings.feedAlert.title')}</p>
          <p className="mt-1 text-[0.8125rem] text-ink-70">
            {label ? t('listings.feedAlert.bodyFor', { search: label }) : t('listings.feedAlert.body')}
          </p>
        </div>
      </div>

      {offerCommunes ? (
        <div>
          <label htmlFor="feed-alert-commune" className="mb-1 block text-[0.8125rem] font-semibold text-ink">
            {t('listings.feedAlert.commune')}
          </label>
          <div className="relative flex min-h-11 items-center rounded-xl border border-ink-25 bg-surface px-3 focus-within:border-blue">
            <select
              id="feed-alert-commune"
              value={commune}
              onChange={(e) => setCommune(e.target.value)}
              className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent py-2.5 text-[0.9375rem] text-ink focus:outline-none"
            >
              <option value="">{t('listings.feedAlert.communePlaceholder')}</option>
              {communes.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
          </div>
        </div>
      ) : null}

      {query ? (
        <QueryAlertButton query={query} label={t('listings.feedAlert.button')} entry={ENTRY} fullWidth />
      ) : null}
      <p className="text-[0.75rem] text-ink-45">{t('listings.feedAlert.footnote')}</p>
    </aside>
  );
}
