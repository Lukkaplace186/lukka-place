'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { sitePageViewPath, trackEvent } from '@/lib/analyticsClient';

/**
 * A page_view for every public page that is not a listing detail page
 * (those send their own, with the commune — ListingViewTracker). Mounted in
 * the (site) and (portfolio) layouts. Before it, only /listings/:id was ever
 * recorded, so the home page, search, map and agent pages had no visitors at
 * all and nothing upstream of a listing could be measured.
 *
 * One row per pathname: a filter or sort change on /listings changes only the
 * query string and is not a new page. Renders nothing; a blocked beacon is
 * swallowed by trackEvent.
 */
export default function SitePageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const path = sitePageViewPath(pathname);
    if (path) trackEvent('page_view', { path });
  }, [pathname]);

  return null;
}
