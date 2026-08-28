'use client';

import { useEffect } from 'react';

/**
 * Fires once per detail-page mount — the page_view side of web/lib/analytics.js.
 * A tracking ping, not content: renders nothing, never blocks/delays the
 * page it sits in, and a failed/blocked request (ad blockers routinely block
 * analytics-shaped endpoints) is swallowed rather than surfaced to the visitor.
 */
export default function ListingViewTracker({ path, commune }) {
  useEffect(() => {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'page_view', path, commune }),
      keepalive: true,
    }).catch(() => {});
  }, [path, commune]);

  return null;
}
