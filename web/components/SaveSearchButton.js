'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell } from 'lucide-react';
import { isSearchSaved, removeSavedSearch, saveSearch, subscribeSavedSearches } from '@/lib/favorites';
import { buildSearchLabel, searchCriteriaTags } from '@/lib/searchLabel';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useIsLoggedIn } from '@/lib/customerClient';

// Both dialogs render only after a tap, so their code is fetched only then
// rather than shipped to every /listings visit up front.
const AuthPromptModal = dynamic(() => import('./AuthPromptModal'), { ssr: false });
const SearchAlertConfirmModal = dynamic(() => import('./SearchAlertConfirmModal'), { ssr: false });

// Same pop used for the saved-heart glyph (FavoriteButton.js) — the CSS
// `.u-pop` keyframes in app/globals.css, which honour prefers-reduced-motion
// on their own. `key={pulseKey}` remounts the span on each real toggle so
// the animation replays; pulseKey 0 (first render) never animates.
function AnimatedBell({ pulseKey, ...bellProps }) {
  return (
    <span key={pulseKey} className={pulseKey > 0 ? 'u-pop inline-flex' : 'inline-flex'}>
      <Bell {...bellProps} />
    </span>
  );
}

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
 * segment of FloatingControlBar's phone pill), never the icon.
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
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const loggedIn = useIsLoggedIn();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Bumped on every real save/remove (handleClick and handleConfirm — the
  // toggle can complete from either path) so AnimatedBell's pop replays once
  // per actual state change, never on mount.
  const [pulseKey, setPulseKey] = useState(0);
  const resumedRef = useRef(false);
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => isSearchSaved(queryString),
    () => false,
  );

  const resumeKey = variant === 'pill' ? 'alert' : 'save';

  function cleanParams() {
    const params = new URLSearchParams(queryString);
    params.delete(AUTH_RETURN_PARAM);
    return params;
  }

  function performSave() {
    const params = cleanParams();
    const query = params.toString();
    saveSearch({ query, label: buildSearchLabel(params, t), href: `${pathname}?${query}` });
    setPulseKey((k) => k + 1);
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
      setPulseKey((k) => k + 1);
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
      tags={searchCriteriaTags(cleanParams(), t)}
    />
  ) : null;

  // One segment of FloatingControlBar's Carte | Trier | Alerte pill — the
  // only place the alert lives on a phone, so the short label has to carry
  // the saved state on its own.
  if (variant === 'pill') {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={handleClick}
          aria-pressed={saved}
          aria-label={saved ? t('listings.alert.created') : t('listings.alert.create')}
          className={`u-press flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors hover:bg-canvas-alt active:scale-95 ${
            saved ? 'text-blue-deep' : ''
          }`}
        >
          <AnimatedBell
            pulseKey={pulseKey}
            fill={saved ? 'currentColor' : 'none'}
            strokeWidth={ICON_STROKE_WIDTH}
            className="h-4 w-4"
          />
          {saved ? t('listings.alert.shortOn') : t('listings.alert.short')}
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
        <AnimatedBell
          pulseKey={pulseKey}
          fill={saved ? 'currentColor' : 'none'}
          strokeWidth={ICON_STROKE_WIDTH}
          className="h-4 w-4"
        />
        {saved ? t('listings.alert.created') : t('listings.alert.create')}
      </button>
      {authPrompt}
      {confirmModal}
    </span>
  );
}
