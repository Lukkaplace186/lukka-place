'use client';

import { useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Bookmark } from 'lucide-react';
import { isSearchSaved, removeSavedSearch, saveSearch, subscribeSavedSearches } from '@/lib/favorites';
import { buildSearchLabel } from '@/lib/searchLabel';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useIsLoggedIn } from '@/lib/customerClient';

/**
 * "Save search" — real either way, but which backend answers depends on
 * login state (see lib/favorites.js's dispatch to accountFavorites.js vs.
 * localFavorites.js). Logged in, it's a server-synced row /compte/alertes
 * actually re-checks for new matches on every visit. Anonymous — the
 * default, since browsing never requires an account — it's localStorage-
 * only and nothing ever re-checks it. That gap used to be invisible: an
 * anonymous visitor who saved a search had no way to learn that real alerts
 * exist at all, only one tap away behind an account. This surfaces it once,
 * right after the save that would otherwise go quietly nowhere — not on
 * every later visit to an already-saved search, which would just be nagging.
 */
export default function SaveSearchButton() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const loggedIn = useIsLoggedIn();
  const [justSaved, setJustSaved] = useState(false);
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => isSearchSaved(queryString),
    () => false,
  );

  function handleClick() {
    if (saved) {
      removeSavedSearch(queryString);
      setJustSaved(false);
    } else {
      saveSearch({ query: queryString, label: buildSearchLabel(searchParams), href: `${pathname}?${queryString}` });
      setJustSaved(true);
    }
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={saved}
        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 py-2 text-[0.8125rem] font-semibold transition-colors ${
          saved
            ? 'border border-blue bg-blue-tint text-blue-deep'
            : 'border border-line bg-surface text-ink-70 hover:border-blue hover:text-blue-deep'
        }`}
      >
        <Bookmark
          fill={saved ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4 w-4"
        />
        {saved ? 'Enregistrée' : 'Sauvegarder'}
      </button>

      {saved && !loggedIn && justSaved ? (
        <span
          role="note"
          className="u-lift absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-line bg-surface p-3 text-[0.75rem] leading-relaxed text-ink-70"
        >
          Enregistrée sur cet appareil seulement.{' '}
          <a
            href={`/compte/inscription?next=${encodeURIComponent(pathname)}`}
            className="font-semibold text-blue-deep hover:underline"
          >
            Créez un compte
          </a>{' '}
          pour être alerté des nouveaux biens correspondants.
        </span>
      ) : null}
    </span>
  );
}
