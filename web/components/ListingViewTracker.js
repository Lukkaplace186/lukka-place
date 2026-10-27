'use client';

import { useEffect } from 'react';

import { trackEvent } from '@/lib/analyticsClient';
import { rememberViewed } from '@/lib/recentlyViewed';
import { adEvent } from '@/lib/adEvents';
import { NUDGE_EVENT } from '@/lib/signupNudgeRules';

/**
 * Fires once per detail-page mount — the page_view side of web/lib/analytics.js.
 * A tracking ping, not content: renders nothing, never blocks/delays the
 * page it sits in, and a failed/blocked request (ad blockers routinely block
 * analytics-shaped endpoints) is swallowed rather than surfaced to the visitor.
 */
export default function ListingViewTracker({ path, commune, listingId = null, price = null }) {
  useEffect(() => {
    trackEvent('page_view', { path, commune });
  }, [path, commune]);

  // Feeds the "Récemment consultés" rail (components/RecentlyViewed.js), the
  // ad platforms' ViewContent (lib/adEvents.js, a no-op without pixels or
  // consent) and the signup prompt's "third listing opened" (SignupNudge).
  useEffect(() => {
    if (listingId == null) return;
    rememberViewed(listingId);
    const value = Number(price);
    adEvent('ViewContent', { contentIds: [listingId], ...(Number.isFinite(value) && value > 0 ? { value, currency: 'USD' } : {}) });
    window.dispatchEvent(new CustomEvent(NUDGE_EVENT, { detail: { reason: 'listing_viewed' } }));
  }, [listingId, price]);

  return null;
}
