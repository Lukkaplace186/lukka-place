'use client';

import { usePathname } from 'next/navigation';

const PROFILE_PATH = /^\/agents\/[^/]+\/?$/;

/**
 * The portfolio layout's footer, padded on one agent's profile (/agents/<id>)
 * so its pinned contact bar never covers the footer's last line. The
 * directory (/agents) has no such bar.
 */
export default function PortfolioFooterShell({ children }) {
  const onProfile = PROFILE_PATH.test(usePathname() || '');
  return (
    <footer className={`border-t border-line bg-canvas-alt pt-8 ${onProfile ? 'pb-28' : 'pb-8'}`}>
      {children}
    </footer>
  );
}
