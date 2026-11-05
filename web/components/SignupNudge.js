'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/LocaleLink';
import { usePathname } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { getFavoriteIds, subscribeFavorites } from '@/lib/localFavorites';
import { getRecentIds } from '@/lib/recentlyViewed';
import { NUDGE_EVENT, NUDGE_SESSION_KEY, nudgeAllowedOn, shouldNudge } from '@/lib/signupNudgeRules';

function signedIn() {
  try {
    return /(?:^|;\s*)(lukka_logged_in|lukka_agent_logged_in)=1/.test(document.cookie);
  } catch {
    return false;
  }
}

function alreadyShown() {
  try {
    return window.sessionStorage.getItem(NUDGE_SESSION_KEY) === '1';
  } catch {
    return true;
  }
}

/**
 * "Créez un compte pour être prévenu des nouveaux biens" (growth plan item
 * 24), at the moments lib/signupNudgeRules.js names. A slim card fixed under
 * the header — except on /listings, where the top is the search box and
 * filters, so it docks above the Carte | Trier | Alerte pill instead (see
 * `position` below). The map and a listing's page, whose bottoms are taken,
 * never show it. Once per tab session; nothing for a signed-in visitor. The
 * link carries `next` back to the page.
 *
 * The listing page itself is quiet (its contact bar), so "a third listing
 * opened" shows on the next page that allows it.
 */
export default function SignupNudge() {
  const t = useT();
  const pathname = usePathname();
  const [reason, setReason] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const consider = (next) => {
      if (signedIn() || alreadyShown()) return;
      if (!shouldNudge({ reason: next, favorites: getFavoriteIds().length, viewed: getRecentIds().length })) return;
      setPending(next);
    };
    const onEvent = (event) => consider(event.detail?.reason);
    const onFavorites = () => consider('favorites');
    window.addEventListener(NUDGE_EVENT, onEvent);
    const unsubscribe = subscribeFavorites(onFavorites);
    return () => {
      window.removeEventListener(NUDGE_EVENT, onEvent);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!pending || reason) return;
    if (!nudgeAllowedOn(pathname, window.location.search)) return;
    try {
      window.sessionStorage.setItem(NUDGE_SESSION_KEY, '1');
    } catch {
      // Storage refused: it may show again, once per page — acceptable.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shown in response to a browser event
    setReason(pending);
  }, [pending, pathname, reason]);

  if (!reason) return null;
  const next = encodeURIComponent(pathname || '/');
  // On /listings the top of the screen IS the search box and filters, which
  // this card covered on an empty search (2026-11-04). There it docks at the
  // bottom instead: above the phone's Carte | Trier | Alerte pill
  // (FloatingControlBar, bottom-6), and in the lower-right corner from lg,
  // where that pill does not exist. Elsewhere it stays under the header.
  const onResults = String(pathname || '').startsWith('/listings');
  const position = onResults
    ? 'inset-x-3 bottom-[5.5rem] mx-auto max-w-xl lg:inset-x-auto lg:bottom-6 lg:right-6 lg:max-w-sm'
    : 'inset-x-3 top-[4.5rem] mx-auto max-w-xl';

  return (
    <div className={`fixed z-[55] flex items-start gap-3 rounded-card border border-line bg-surface p-3 shadow-lg ${position}`} role="status">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
        <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="u-micro-strong text-ink">{t(`auth.nudge.${reason}`)}</p>
        <p className="u-micro text-ink-70">{t('auth.nudge.text')}</p>
        <Link href={`/compte/inscription?next=${next}`} className="u-micro-strong mt-1.5 inline-block text-blue-deep underline">
          {t('auth.nudge.cta')}
        </Link>
      </div>
      <button type="button" onClick={() => { setPending(null); setReason(null); }} aria-label={t('auth.nudge.close')} className="u-hit relative shrink-0 rounded p-1 text-ink-45 hover:text-ink">
        <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>
    </div>
  );
}
