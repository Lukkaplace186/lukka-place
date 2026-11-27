'use client';

import { useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Link from '@/components/LocaleLink';
import { Bell, Check } from 'lucide-react';
import { isSearchSaved, saveSearch, subscribeSavedSearches } from '@/lib/favorites';
import { buildSearchLabel, searchCriteriaTags } from '@/lib/searchLabel';
import { useIsLoggedIn } from '@/lib/customerClient';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const AuthPromptModal = dynamic(() => import('./AuthPromptModal'), { ssr: false });
const SearchAlertConfirmModal = dynamic(() => import('./SearchAlertConfirmModal'), { ssr: false });

/**
 * "Create an alert for THIS search" from a page that is not /listings — the
 * listing page's "M'alerter des biens similaires" and the homepage's alert
 * picker. SaveSearchButton saves the search in the address bar; this saves
 * the `query` it is given (lib/similarSearch.js builds the listing's one).
 *
 * The same two paths as SaveSearchButton, and the same records:
 *  - signed in → the criteria are shown (SearchAlertConfirmModal), then
 *    saveSearch with `href` /listings?query — exactly what saving that search
 *    from /listings stores;
 *  - a guest → AuthPromptModal, whose `next` is /listings?query with
 *    `lkp_auth_return=alert`: after signup the visitor lands on those
 *    results, and SaveSearchButton's own resume (the phone pill, always
 *    mounted there) saves the alert once the session is real. Nothing is
 *    saved for an account that does not exist yet.
 *
 * Once saved, the button says so and links to the results.
 *
 * `trigger` names the sign-up funnel entry a guest's prompt records
 * (lib/signupFunnelRules.js entryForPromptTrigger): 'alert' by default,
 * 'price_guide' on /combien-coute pages (PriceGuideAlert).
 * `entry` overrides it for a prompt that is not the plain "Créer une
 * alerte" (the feed card, the home search's bell, the alert page).
 */
export default function QueryAlertButton({ query, label, className = '', fullWidth = false, trigger = 'alert', entry = null, variant = 'primary' }) {
  const t = useT();
  const loggedIn = useIsLoggedIn();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const saved = useSyncExternalStore(
    subscribeSavedSearches,
    () => (query ? isSearchSaved(query) : false),
    () => false,
  );

  if (!query) return null;
  const href = `/listings?${query}`;

  function save() {
    const params = new URLSearchParams(query);
    saveSearch({ query, label: buildSearchLabel(params, t), href });
  }

  const width = fullWidth ? 'w-full' : '';

  if (saved) {
    return (
      <Link
        href={href}
        className={`u-press inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-blue bg-blue-tint px-4 text-[0.9375rem] font-semibold text-blue-deep ${width} ${className}`}
      >
        <Check strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 shrink-0" />
        {t('listings.alert.createdSee')}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (loggedIn ? setShowConfirm(true) : setShowAuthPrompt(true))}
        className={variant === 'secondary'
          // A quiet second action beside a primary one (the home search's bell).
          ? `u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue/40 bg-surface px-4 text-[0.875rem] font-semibold text-blue-deep hover:bg-blue-tint ${width} ${className}`
          : `u-press u-btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-deep px-4 text-[0.9375rem] font-semibold text-white ${width} ${className}`}
      >
        <Bell strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 shrink-0" />
        {label || t('listings.alert.create')}
      </button>
      {showAuthPrompt ? (
        <AuthPromptModal
          open={showAuthPrompt}
          onClose={() => setShowAuthPrompt(false)}
          trigger={trigger}
          entry={entry}
          next={`${href}&lkp_auth_return=alert`}
        />
      ) : null}
      {showConfirm ? (
        <SearchAlertConfirmModal
          open={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={() => {
            setShowConfirm(false);
            save();
          }}
          tags={searchCriteriaTags(new URLSearchParams(query), t)}
        />
      ) : null}
    </>
  );
}
