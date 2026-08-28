'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { NAV_ITEMS, isNavItemActive } from './navItems';

/**
 * Fixed 4-icon bottom nav, mobile and tablet only (`lg:hidden`) — the sole
 * remaining consumer of NAV_ITEMS now that SideRail.js, the desktop
 * equivalent this used to hand off to at the `lg` breakpoint, has been
 * removed entirely. Desktop reaches the same four destinations through
 * Header's top-right utility row instead (see Header.js).
 *
 * The matching bottom padding lives once in app/(site)/layout.js. It used
 * to be absent there and re-implemented ad hoc on four separate pages
 * (pb-24, pb-32 sm:pb-6, pb-20 sm:pb-12) — those are gone.
 */
export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="grid grid-cols-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isNavItemActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`u-press relative flex flex-col items-center gap-1 py-2.5 text-[0.625rem] font-medium tracking-[0.02em] transition-colors ${
                active ? 'text-blue-deep' : 'text-ink-45'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 mx-auto h-[2px] rounded-b-full bg-blue transition-all ${
                  active ? 'w-8 opacity-100' : 'w-0 opacity-0'
                }`}
              />
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.375rem] w-[1.375rem]" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
