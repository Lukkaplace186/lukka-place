'use client';

import { usePathname } from 'next/navigation';

/**
 * Wraps the main content column so its left padding can react to
 * SideRail.js hiding itself on the homepage — `lg:pl-[76px]` exists only to
 * clear the fixed SideRail, so it has to disappear on the one route where
 * SideRail does too, or home would render with a dead 76px gutter on the
 * left at desktop widths.
 */
export default function SiteShell({ children }) {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return <div className={`flex min-h-screen flex-col pt-16 ${isHome ? '' : 'lg:pl-[76px]'}`}>{children}</div>;
}
