'use client';

import Link from '@/components/IntentLink';
import { User, Heart, Bell, LogOut, MessageCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { useT } from '@/lib/i18n/client';
import UnreadBadge from './chat/UnreadBadge';
import { logoutAction } from '@/app/(site)/compte/actions';

// Keys, not text — see navItems.js on why a module-level constant cannot
// hold translated copy.
const ACCOUNT_LINKS = [
  { href: '/compte/client', labelKey: 'nav.myAccount', icon: User },
  { href: '/messages', labelKey: 'nav.messages', icon: MessageCircle },
  { href: '/favoris', labelKey: 'nav.myFavorites', icon: Heart },
  { href: '/compte/alertes', labelKey: 'nav.alerts', icon: Bell },
];

/**
 * The signed-in customer's account dropdown, split out of Header.js on
 * 2026-11-21: Radix DropdownMenu brings Popper and Floating UI (~20 KB gzip),
 * and only signed-in customers ever see this menu. Header.js imports it the
 * moment it knows the visitor is signed in and draws a look-alike button
 * until then (same `triggerClassName`, so nothing moves). Same items as before.
 */
export default function HeaderAccountMenu({ unread, triggerClassName }) {
  const t = useT();
  const unreadText = t('chat.inbox.unreadLabel', { count: unread });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('nav.myAccount')}
        // Where a saved listing's heart flies to (lib/flyToAccount.js).
        data-fly-target="account"
        className={triggerClassName}
      >
        <User strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        <UnreadBadge count={unread} label={unreadText} className="absolute -right-1 -top-1 ring-2 ring-surface" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ACCOUNT_LINKS.map(({ href, labelKey, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href} className="flex items-center gap-2.5">
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
              {t(labelKey)}
              {href === '/messages' ? <UnreadBadge count={unread} label={unreadText} className="ml-auto" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logoutAction()} className="flex items-center gap-2.5">
          <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
          {t('common.actions.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
