'use client';

import { useSyncExternalStore } from 'react';
import { Target } from 'lucide-react';
import { getSavedSearches, subscribeSavedSearches } from '@/lib/accountFavorites';
import { useIsLoggedIn } from '@/lib/customerClient';
import { bestSavedSearchMatch } from '@/lib/savedSearchMatch';
import { useT } from '@/lib/i18n/client';

const NO_QUERIES = '';

/**
 * "92 % correspond à votre recherche" under a card's price (2026-11-03) —
 * signed-in customers with at least one saved search only; nothing for
 * anyone else, and nothing when the listing falls outside the search
 * (lib/savedSearchMatch.js has the rules).
 *
 * The saved searches come from the same in-memory account store the save
 * buttons use (lib/accountFavorites.js), fetched once per page however many
 * cards render. The snapshot is the joined query strings, a stable string,
 * so useSyncExternalStore never sees a "new" value for the same searches.
 * Server snapshot: nothing, so the badge only appears after hydration and
 * the server HTML never disagrees with the client.
 */
export default function SavedSearchMatchBadge({ listing, className = '' }) {
  const t = useT();
  const loggedIn = useIsLoggedIn();
  const joined = useSyncExternalStore(
    subscribeSavedSearches,
    () => (loggedIn ? getSavedSearches().map((s) => s.query).join('\n') : NO_QUERIES),
    () => NO_QUERIES,
  );
  if (!joined) return null;

  const percent = bestSavedSearchMatch(listing, joined.split('\n'));
  if (percent == null) return null;

  return (
    <p
      className={`u-reveal inline-flex items-center gap-1 rounded-full bg-green-tint px-2 py-0.5 text-[0.75rem] font-semibold text-green-ink ${className}`}
    >
      <Target strokeWidth={2.25} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t('listings.match.savedSearch', { percent })}
    </p>
  );
}
