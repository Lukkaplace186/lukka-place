'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell } from 'lucide-react';
import { isSearchSaved, removeSavedSearch, saveSearch, subscribeSavedSearches } from '@/lib/favorites';
import { buildSearchLabel, searchCriteriaTags } from '@/lib/searchLabel';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useIsLoggedIn } from '@/lib/customerClient';
import AuthPromptModal from './AuthPromptModal';
import SearchAlertConfirmModal from './SearchAlertConfirmModal';

// Namespaced so it can never collide with a real filter key (see
// FilterBar.js's FILTER_PARAM_KEYS) — this one is internal plumbing between
// this component and AuthPromptModal.js, never a search criterion itself.
const AUTH_RETURN_PARAM = 'lkp_auth_return';

/**
 * "M'alerter des nouveaux biens" — one real action, one real label
 * everywhere. This used to render as two visually distinct features
 * depending on breakpoint (a Bookmark "Sauvegarder" pill on desktop, a Bell
 * "Créer une alerte" button on mobile) even though both always drove the
 * exact same save/unsave toggle — confusing to anyone who noticed both,
 * since it read as two different features rather than one. `variant` still
 * picks a *layout* (a compact pill among FilterBar's desktop toolbar vs. a
 * half-width item in its mobile utility row), never the copy or icon
 * anymore — both are the same Bell + label now.
 *
 * Gated behind a real account (see AuthPromptModal.js): an explicit product
 * decision to match the Rightmove/Zoopla pattern of blocking Save/Alert
 * until sign-up, rather than this component's previous behaviour of always
 * saving locally first and only suggesting an account afterward. A
 * signed-in visitor is unaffected either way — saving was always real and
 * server-synced for them (see lib/favorites.js's dispatch to
 * accountFavorites.js vs. localFavorites.js).
 *
 * A signed-in visitor also gets a real confirmation step first
 * (SearchAlertConfirmModal.js) rather than an instant save on click — it
 * shows the exact criteria (via lib/searchLabel.js's searchCriteriaTags,
 * the same function AlertsBoard.js already renders each saved search's tag
 * row from) so nothing gets saved the visitor didn't actually see.
 *
 * The auth gate hands off to the real /compte/inscription phone+password
 * signup (this app has no email-based auth to gate behind instead — see
 * lib/customerAuth.js) and round-trips via a `next` URL carrying
 * AUTH_RETURN_PARAM. On return, the effect below checks for a *genuine*
 * session (`loggedIn`, server-verified) before performing the actual save —
 * nothing here fabricates a saved search for an account that doesn't really
 * exist yet. That resume path skips the confirmation modal (the visitor
 * already reviewed and confirmed intent once, before being sent to sign up;
 * asking again after signup would just be a second friction step for
 * nothing new).
 */
export default function SaveSearchButton({ variant = 'default' }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const loggedIn = useIsLoggedIn();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const resumedRef = useRef(false);
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => isSearchSaved(queryString),
    () => false,
  );

  const resumeKey = variant === 'alert' ? 'alert' : 'save';

  function cleanParams() {
    const params = new URLSearchParams(queryString);
    params.delete(AUTH_RETURN_PARAM);
    return params;
  }

  function performSave() {
    const params = cleanParams();
    const query = params.toString();
    saveSearch({ query, label: buildSearchLabel(params), href: `${pathname}?${query}` });
  }

  // Real resume, not a fabricated auto-fill: fires only once `loggedIn`
  // reflects a genuine server-verified session, and only for the exact
  // save/alert action that sent this visitor to signup in the first place.
  useEffect(() => {
    if (resumedRef.current) return;
    if (!loggedIn) return;
    if (searchParams.get(AUTH_RETURN_PARAM) !== resumeKey) return;
    resumedRef.current = true;
    performSave();
    const params = cleanParams();
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, searchParams]);

  function handleClick() {
    if (saved) {
      removeSavedSearch(queryString);
      return;
    }
    if (!loggedIn) {
      setShowAuthPrompt(true);
      return;
    }
    setShowConfirm(true);
  }

  function handleConfirm() {
    setShowConfirm(false);
    performSave();
  }

  const authPromptNext = (() => {
    const params = cleanParams();
    params.set(AUTH_RETURN_PARAM, resumeKey);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  })();

  const authPrompt = showAuthPrompt ? (
    <AuthPromptModal
      open={showAuthPrompt}
      onClose={() => setShowAuthPrompt(false)}
      trigger={resumeKey}
      next={authPromptNext}
    />
  ) : null;

  const confirmModal = showConfirm ? (
    <SearchAlertConfirmModal
      open={showConfirm}
      onClose={() => setShowConfirm(false)}
      onConfirm={handleConfirm}
      tags={searchCriteriaTags(cleanParams())}
    />
  ) : null;

  if (variant === 'alert') {
    return (
      <span className="relative inline-flex flex-1 justify-center">
        <button
          type="button"
          onClick={handleClick}
          aria-pressed={saved}
          className={`u-press inline-flex items-center gap-1.5 whitespace-nowrap py-2.5 text-[0.8125rem] font-semibold transition-colors ${
            saved ? 'text-blue-deep' : 'text-ink-70 hover:text-blue-deep'
          }`}
        >
          <Bell fill={saved ? 'currentColor' : 'none'} strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {saved ? 'Alerte créée' : "M'alerter des nouveaux biens"}
        </button>
        {authPrompt}
        {confirmModal}
      </span>
    );
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
        <Bell
          fill={saved ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4 w-4"
        />
        {saved ? 'Alerte créée' : "M'alerter des nouveaux biens"}
      </button>
      {authPrompt}
      {confirmModal}
    </span>
  );
}
