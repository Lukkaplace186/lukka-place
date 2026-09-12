'use client';

import { useEffect } from 'react';

import { trackEvent } from '@/lib/analyticsClient';

/**
 * Fires once per detail-page mount — the page_view side of web/lib/analytics.js.
 * A tracking ping, not content: renders nothing, never blocks/delays the
 * page it sits in, and a failed/blocked request (ad blockers routinely block
 * analytics-shaped endpoints) is swallowed rather than surfaced to the visitor.
 */
export default function ListingViewTracker({ path, commune }) {
  useEffect(() => {
    trackEvent('page_view', { path, commune });
  }, [path, commune]);

  return null;
}
