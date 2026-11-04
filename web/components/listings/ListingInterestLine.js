import { Eye } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getRecentListingViewers } from '@/lib/listingInterest';

/**
 * "12 personnes ont consulté ce bien ces 7 derniers jours" — distinct real
 * visitors from page_views (lib/listingInterest.js), the real count from 1
 * up, nothing at 0. Rendered inside a Suspense boundary so the count never holds
 * up the page.
 */
export default async function ListingInterestLine({ listingId }) {
  const people = await getRecentListingViewers(listingId);
  if (people == null) return null;
  const t = await getT();
  return (
    <p className="inline-flex w-fit items-center gap-1.5 text-[0.8125rem] font-medium text-ink-70">
      <Eye strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t('listings.detail.recentViewers', { count: people })}
    </p>
  );
}
