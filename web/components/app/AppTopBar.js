'use client';

import Link from '@/components/IntentLink';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useIsLoggedIn } from '@/lib/customerClient';
import { useAlertsUnread } from '@/lib/useAlertsUnread';
import UnreadBadge from '@/components/chat/UnreadBadge';
import { cn } from '@/lib/utils';

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
 */
export default function AppTopBar() {
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const locale = useLocale();
  const loggedIn = useIsLoggedIn();
  const t = useT();
  const unread = useAlertsUnread({ side: 'customer', loadNow: true, enabled: loggedIn });
  const onHome = pathname === '/';
  const bellHref = loggedIn ? INBOX : `/compte/connexion?next=${encodeURIComponent(INBOX)}`;

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between px-4 transition-colors duration-200',
        onHome ? 'bg-blue text-white' : 'border-b border-line bg-surface text-blue',
      )}
    >
      <Link href={localizeHref('/', locale)} className="u-app-serif text-[1.5rem] leading-none" aria-label="Lukka Place">
        Lukka Place
      </Link>
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
