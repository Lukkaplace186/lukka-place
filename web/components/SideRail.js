'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { NAV_ITEMS, isNavItemActive } from './navItems';

/**
 * Persistent desktop icon rail, mirroring the five destinations BottomNav
 * already carries on mobile.
 *
 * This exists because those five pages previously had *no* desktop entry
 * point at all — the header only ever linked to "À vendre" and "À louer",
 * so /favoris, /mises-a-jour, /plan and /messages were reachable on a phone
 * and unreachable on a laptop.
 *
 * Breakpoint handoff is exact: this is `hidden lg:flex`, BottomNav is
 * `lg:hidden`. Never both, never neither.
 */
export default function SideRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-y-0 left-0 z-50 hidden w-[76px] flex-col items-center border-r border-line bg-surface pt-[4.5rem] lg:flex"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex w-full flex-col items-center gap-1.5 py-3.5 transition-colors ${
              active ? 'text-blue-deep' : 'text-ink-45 hover:text-ink'
            }`}
          >
            {/* Active marker rides the left edge — reads as a tab selection
                rather than a filled block, which would fight the header. */}
            <span
              aria-hidden="true"
              className={`absolute left-0 top-1/2 h-7 -translate-y-1/2 rounded-r-full bg-blue transition-all ${
                active ? 'w-[3px] opacity-100' : 'w-0 opacity-0'
              }`}
            />
            <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.375rem] w-[1.375rem]" />
            <span className="text-[0.625rem] font-medium tracking-[0.02em]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
