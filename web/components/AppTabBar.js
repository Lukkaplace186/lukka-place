'use client';

import Link from '@/components/IntentLink';
import { usePathname } from 'next/navigation';
import { Home, Search, Heart, Bell, User } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useIsLoggedIn } from '@/lib/customerClient';
import { APP_TABS, activeAppTab, hidesAppTabs } from '@/lib/appModeRules';
import { useAlertsUnread } from '@/lib/useAlertsUnread';
import { useChatUnread } from '@/lib/useChatUnread';
import UnreadBadge from './chat/UnreadBadge';

const ICONS = { home: Home, search: Search, favorites: Heart, notifications: Bell, account: User };

/**
 * The app's bottom tab bar (app mode only, app/(site)/layout.js). The site
 * itself has no bottom bar on purpose (see that layout's comment); inside the
 * store app the tabs are what people expect. The spacer keeps the last line
 * of every page above the bar.
 *
 * Badges, signed-in customers only: unread app alerts on Notifications
 * (GET /api/push/unread, refreshed when a push arrives — lib/appBridge.js)
 * and unread chat messages on Compte, where Mes messages lives.
 */
export default function AppTabBar() {
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const locale = useLocale();
  const loggedIn = useIsLoggedIn();
  const t = useT();
  // Hooks before the early return: the listing page hides the bar, not the counts.
  const unreadAlerts = useAlertsUnread({ side: 'customer', loadNow: true, enabled: loggedIn });
  const unreadMessages = useChatUnread('customer', { enabled: loggedIn });
  if (hidesAppTabs(pathname)) return null;
  const badges = {
    notifications: { count: unreadAlerts, label: t('nav.unreadNotifications', { count: unreadAlerts }) },
    account: { count: unreadMessages, label: t('chat.inbox.unreadLabel', { count: unreadMessages }) },
  };
  const active = activeAppTab(pathname);

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))]" />
      <nav
        aria-label={t('nav.appTabs')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid h-16 max-w-lg grid-cols-5">
          {APP_TABS.map((tab) => {
            const Icon = ICONS[tab.key];
            const isActive = active === tab.key;
            // Signed out, the account tab opens the sign-in page directly.
            const href = tab.key === 'account' && !loggedIn ? '/compte/connexion' : tab.href;
            return (
              <li key={tab.key}>
                <Link
                  href={localizeHref(href, locale)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors duration-75 active:bg-canvas-deep ${
                    isActive ? 'text-blue' : 'text-ink-45'
                  }`}
                >
                  <span className="relative">
                    <Icon strokeWidth={isActive ? 2.25 : ICON_STROKE_WIDTH} className="h-6 w-6" fill={isActive && tab.key === 'favorites' ? 'currentColor' : 'none'} />
                    {badges[tab.key] ? (
                      <UnreadBadge
                        count={badges[tab.key].count}
                        label={badges[tab.key].label}
                        className="absolute -right-2.5 -top-1.5 bg-danger ring-2 ring-surface"
                      />
                    ) : null}
                  </span>
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
