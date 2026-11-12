'use client';

import Link from '@/components/IntentLink';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { Bell, ChevronLeft } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useIsLoggedIn } from '@/lib/customerClient';
import { useAlertsUnread } from '@/lib/useAlertsUnread';
import UnreadBadge from '@/components/chat/UnreadBadge';
import { cn } from '@/lib/utils';
import { hidesAppTabs, isWelcomePath } from '@/lib/appModeRules';

const INBOX = '/compte/client/notifications';

/**
 * The app's top bar (app mode, app/(site)/layout.js), in place of the
 * website's Header: the real logo and the notifications bell, nothing else —
 * the tab bar and the account menu carry the rest. Same h-16 as Header, so
 * every page's pt-16 / top-16 offsets still hold.
 *
 * On the home screen it starts clear, over the hero photograph (white logo,
 * AppHomeHero tints the sky behind it), and turns white with a hairline once
 * the page has scrolled past the title; white everywhere else. Signed out,
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
  // Past the hero's title the bar becomes the ordinary white one.
  const [scrolled, setScrolled] = useState(false);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 150));
  const overPhoto = onHome && !scrolled;
  // A listing and its booking screen have no tab bar: the way out is here.
  const withBack = hidesAppTabs(pathname) && !isWelcomePath(pathname);
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
      data-app-top-bar=""
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b px-4 transition-colors duration-300',
        overPhoto ? 'border-transparent bg-transparent text-white' : 'border-line bg-surface text-blue',
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
        {/* The supplied logo, as components/Brand.js draws it (static local
            PNGs, so plain imgs): the white one over the photo, the colour one
            on white. Both are mounted on the home screen so the change is a
            cross-fade, not a reload. */}
        <Link href={localizeHref('/', locale)} aria-label="Lukka Place" className="relative inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-light.png?v=2"
            alt=""
            width={2354}
            height={746}
            className={cn('block h-7 w-auto transition-opacity duration-300', overPhoto && 'opacity-0')}
          />
          {onHome ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/brand/logo-dark.png?v=2"
              alt=""
              width={2354}
              height={746}
              className={cn('absolute inset-0 block h-7 w-auto transition-opacity duration-300', !overPhoto && 'opacity-0')}
            />
          ) : null}
        </Link>
      </div>
      <Link
        href={localizeHref(bellHref, locale)}
        aria-label={t('appShell.bell')}
        className={cn(
          'u-press relative flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-300',
          overPhoto ? 'bg-blue-900/35 text-white' : 'bg-canvas-alt text-ink',
        )}
      >
        <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        <UnreadBadge
          count={unread}
          label={t('nav.unreadNotifications', { count: unread })}
          className={cn('absolute -right-0.5 -top-0.5 bg-danger ring-2', overPhoto ? 'ring-transparent' : 'ring-surface')}
        />
      </Link>
    </header>
  );
}
