'use client';

import { usePathname } from 'next/navigation';

const PROFILE_PATH = /^\/agents\/[^/]+\/?$/;

function useOnProfile() {
  return PROFILE_PATH.test(usePathname() || '');
}

/**
 * The portfolio layout's white header, hidden below `lg` on one agent's
 * profile (/agents/<id>): there the royal band carries the Lukka Place logo
 * and is the page's header on a phone (Claude Design "Agent Profile Mobile").
 * The directory (/agents) keeps it at every width.
 */
export default function PortfolioHeaderShell({ children }) {
  const onProfile = useOnProfile();
  return (
    <header className={`sticky top-0 z-30 border-b border-line bg-surface ${onProfile ? 'hidden lg:block' : ''}`}>
      {children}
    </header>
  );
}

/** The footer, padded on a profile so the pinned contact bar never covers it. */
export function PortfolioFooterShell({ children }) {
  const onProfile = useOnProfile();
  return (
    <footer className={`border-t border-line bg-canvas-alt pt-8 ${onProfile ? 'pb-24' : 'pb-8'}`}>
      {children}
    </footer>
  );
}
