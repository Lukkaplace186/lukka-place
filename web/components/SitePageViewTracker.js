'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { sitePageViewPath, trackEvent } from '@/lib/analyticsClient';
import { cleanLandingQuery } from '@/lib/landingQuery';

/**
 * A page_view for every public page that is not a listing detail page
 * (those send their own, with the commune — ListingViewTracker). Mounted in
 * the (site) and (portfolio) layouts. Before it, only /listings/:id was ever
 * recorded, so the home page, search, map and agent pages had no visitors at
 * all and nothing upstream of a listing could be measured.
 *
 * One row per pathname: a filter or sort change on /listings changes only the
 * query string and is not a new page. The query the page LANDED with is sent
 * as `query`, whitelisted (lib/landingQuery.js), so an ad's filtered link is
 * visible in page_views. Renders nothing; a blocked beacon is swallowed by
 * trackEvent.
 */
export default function SitePageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const path = sitePageViewPath(pathname);
    if (!path) return;
    let query = null;
    try {
      query = cleanLandingQuery(window.location.search);
    } catch {
      query = null;
    }
    trackEvent('page_view', { path, ...(query ? { query } : {}) });
  }, [pathname]);

  return null;
}
