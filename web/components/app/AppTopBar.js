'use client';

import Link from '@/components/IntentLink';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, ChevronLeft } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useIsLoggedIn } from '@/lib/customerClient';
import { useAlertsUnread } from '@/lib/useAlertsUnread';
import UnreadBadge from '@/components/chat/UnreadBadge';
import { cn } from '@/lib/utils';
import { hidesAppTabs } from '@/lib/appModeRules';

const INBOX = '/compte/client/notifications';

/**
 * The app's top bar (app mode, app/(site)/layout.js), in place of the
 * website's Header: the wordmark and the notifications bell, nothing else —
 * the tab bar and the account menu carry the rest. Same h-16 as Header, so
 * every page's pt-16 / top-16 offsets still hold.
 *
 * Royal blue on the home screen, where it runs into the search band (the app
 * design's "Search home"); white with a hairline everywhere else. Signed out,
 * the bell opens sign-in and comes back to the inbox.
 *
 * Off the tabs (a listing, its booking screen) it leads with a back arrow:
 * back in history when there is one, else up to the results or the listing.
 */
export default function AppTopBar() {
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const locale = useLocale();
  const loggedIn = useIsLoggedIn();
  const t = useT();
  const unread = useAlertsUnread({ side: 'customer', loadNow: true, enabled: loggedIn });
  const router = useRouter();
  const onHome = pathname === '/';
  // A listing and its booking screen have no tab bar: the way out is here.
  const withBack = hidesAppTabs(pathname);
  const upHref = pathname.endsWith('/visite')
    ? pathname.slice(0, -'/visite'.length)
    : pathname.startsWith('/messages/') ? '/messages' : '/listings';
  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(localizeHref(upHref, locale));
  }
  const bellHref = loggedIn ? INBOX : `/compte/connexion?next=${encodeURIComponent(INBOX)}`;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between px-4 transition-colors duration-200',
        onHome ? 'bg-blue text-white' : 'border-b border-line bg-surface text-blue',
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {withBack ? (
          <button
            type="button"
            onClick={goBack}
            aria-label={t('appShell.back')}
            className="u-press -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-canvas-alt"
          >
            <ChevronLeft strokeWidth={2} className="h-6 w-6" aria-hidden="true" />
          </button>
        ) : null}
        <Link href={localizeHref('/', locale)} className="u-app-serif text-[1.5rem] leading-none" aria-label="Lukka Place">
          Lukka Place
        </Link>
      </div>
      <Link
        href={localizeHref(bellHref, locale)}
        aria-label={t('appShell.bell')}
        className={cn(
          'u-press relative flex h-11 w-11 items-center justify-center rounded-full',
          onHome ? 'bg-white/15 text-white' : 'bg-canvas-alt text-ink',
        )}
      >
        <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        <UnreadBadge
          count={unread}
          label={t('nav.unreadNotifications', { count: unread })}
          className={cn('absolute -right-0.5 -top-0.5 bg-danger ring-2', onHome ? 'ring-blue' : 'ring-surface')}
        />
      </Link>
    </header>
  );
}
