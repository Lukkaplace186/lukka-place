'use client';

import { useEffect } from 'react';
import { trackEvent } from '@/lib/analyticsClient';
import { adEvent } from '@/lib/adEvents';
import { NUDGE_EVENT } from '@/lib/signupNudgeRules';

const SESSION_KEY = 'lukka_tracked_searches';
const MAX_REMEMBERED = 50;

/**
 * Records one committed /listings search in `search_events` (via /api/track),
 * with how many listings matched it EXACTLY. `resultCount` 0 is the demand
 * nobody is supplying — the figure the market data sells.
 *
 * Once per distinct search per browser tab session: going back to a results
 * page, paging, or toggling the map is the same search, not a new one. The
 * key is the search itself, so the same filters with a different sort are
 * still one search. Renders nothing; a blocked beacon costs nothing
 * (lib/analyticsClient.js).
 */
export default function SearchTracker({ search }) {
  const key = JSON.stringify(search);

  useEffect(() => {
    let seen = [];
    try {
      seen = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) || '[]');
      if (!Array.isArray(seen)) seen = [];
    } catch {
      seen = [];
    }
    if (seen.includes(key)) return;

    const search = JSON.parse(key);
    trackEvent('search', search);
    adEvent('Search', { searchString: [search.q, ...(search.communes || [])].filter(Boolean).join(' ').slice(0, 120) || undefined });
    if (search.resultCount === 0) window.dispatchEvent(new CustomEvent(NUDGE_EVENT, { detail: { reason: 'no_results' } }));
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify([...seen, key].slice(-MAX_REMEMBERED)));
    } catch {
      // Storage refused: the search may be counted twice on a revisit, which
      // is better than not at all.
    }
  }, [key]);

  return null;
}
