'use client';

import Link from '@/components/IntentLink';
import { usePathname, useSearchParams } from 'next/navigation';
import { m } from 'motion/react';
import { Search, Heart, User } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useChatUnread } from '@/lib/useChatUnread';
import { APP_TABS, activeAppTab, hidesAppTabs } from '@/lib/appModeRules';
import UnreadBadge from './chat/UnreadBadge';
import { useIsLoggedIn } from '@/lib/customerClient';

const ICONS = { search: Search, saved: Heart, account: User };

/**
 * The app's bottom tab bar (app mode only, app/(site)/layout.js): Search,
 * Saved, Account, as in the app design (2026-11-11); notifications are the
 * bell in AppTopBar. The site itself has no bottom bar on purpose (see that
 * layout's comment). The spacer keeps the last line of every page above it.
 *
 * Motion: the short blue bar above the active tab slides to the tab tapped
 * (a shared layoutId), which is what tells the eye where it went; the icon
 * dips on press. Nothing moves on its own.
 *
 * Hidden on a listing page and on the results' full-screen map, which both
 * have their own bottom bar. Rendered inside <Suspense> (useSearchParams).
 *
 * Badge: unread chat messages on Account, where Messages lives (signed-in
 * customers only).
 */
export default function AppTabBar() {
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const locale = useLocale();
  const loggedIn = useIsLoggedIn();
  const t = useT();
  // Hooks before the early return: the listing page hides the bar, not the counts.
  const unreadMessages = useChatUnread('customer', { enabled: loggedIn });
  // The results' full-screen map (?view=map) has its own bottom control ("Liste").
  const mapView = useSearchParams()?.get('view') === 'map';
  if (hidesAppTabs(pathname) || mapView) return null;
  const active = activeAppTab(pathname);

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.25rem+env(safe-area-inset-bottom))]" />
      <nav
        aria-label={t('nav.appTabs')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid h-[4.25rem] max-w-lg grid-cols-3">
          {APP_TABS.map((tab) => {
            const Icon = ICONS[tab.key];
            const isActive = active === tab.key;
            const badge = tab.key === 'account' ? unreadMessages : 0;
            return (
              <li key={tab.key} className="relative">
                {isActive ? (
                  <m.span
                    layoutId="app-tab-active"
                    aria-hidden="true"
                    className="absolute inset-x-8 top-0 h-[3px] rounded-b-full bg-blue"
                    transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                  />
                ) : null}
                <Link
                  href={localizeHref(tab.href, locale)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[0.75rem] font-semibold transition-colors duration-150 ${
                    isActive ? 'text-blue' : 'text-ink-45'
                  }`}
                >
                  <m.span whileTap={{ scale: 0.86 }} className="relative">
                    <Icon
                      strokeWidth={isActive ? 2.25 : ICON_STROKE_WIDTH}
                      className="h-6 w-6"
                      fill={isActive && tab.key !== 'search' ? 'currentColor' : 'none'}
                    />
                    {badge ? (
                      <UnreadBadge
                        count={badge}
                        label={t('chat.inbox.unreadLabel', { count: badge })}
                        className="absolute -right-2.5 -top-1.5 bg-danger ring-2 ring-surface"
                      />
                    ) : null}
                  </m.span>
                  <span>{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
