'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The design's sticky portal tab bar ("Espace Client" canvas): a white
 * strip with a hairline on both edges, tabs that scroll horizontally on
 * narrow viewports, an active tab carrying a 3px royal underline and a
 * bold ink label, and a real count riding in a pill beside the label.
 *
 * The design's underline is `inset 0 -3px 0 var(--royal-600)` — an inset
 * box-shadow rather than a border, so the tab's own height never shifts by
 * 3px when it becomes active. Kept exactly, via a bottom border on an
 * absolutely-positioned rule.
 *
 * Counts are passed in already computed (lib/customerPortal.js) and are
 * omitted entirely when zero — the design's own `sc-if` on `t.count` does
 * the same thing, and a "0" pill would be noise rather than information.
 *
 * Down from the original 7 destinations (Vue d'ensemble, Mes favoris, Mes
 * alertes, Mes messages, Soumettre une recherche, Visites planifiées,
 * Paramètres) to 4, per an explicit simplification request. The overview
 * tab is gone outright — `/compte/client` now lands directly on saved
 * properties instead of a redundant summary of numbers this bar already
 * shows. Favoris+Alertes and Messages+Visites each collapse into one tab
 * (a `?tab=` sub-toggle for the former, one merged chronological list for
 * the latter — see ./page.js and ./messages/InquiryThreads.js), and
 * Demandes/Paramètres are just relabelled, not restructured. `savedTotal`
 * (favorites + alerts) is computed by the layout, not `getPortalCounts()`
 * itself — that function's real return shape stays the honest per-metric
 * one other callers still rely on.
 */
const TABS = [
  { href: '/compte/client', label: 'Favoris & Alertes', exact: true, countKey: 'savedTotal' },
  { href: '/compte/client/messages', label: 'Messages & Visites', countKey: 'inquiries' },
  { href: '/compte/client/demandes', label: 'Trouver pour moi' },
  { href: '/compte/client/parametres', label: 'Mon profil' },
];

export default function ClientPortalTabs({ counts = {} }) {
  const pathname = usePathname();

  return (
    <div className="sticky top-16 z-20 border-y border-line bg-surface">
      <nav
        aria-label="Espace client"
        className="no-scrollbar mx-auto flex max-w-[77.5rem] gap-1.5 overflow-x-auto px-4 sm:px-6 lg:px-8"
      >
        {TABS.map(({ href, label, exact, countKey }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const count = countKey ? counts[countKey] : null;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-4 pb-[1.0625rem] pt-5 text-[0.875rem] transition-colors',
                active ? 'font-bold text-ink' : 'font-medium text-ink-45 hover:text-ink-70',
              )}
            >
              <span>{label}</span>
              {count ? (
                <span
                  className={cn(
                    'u-tabular inline-flex min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold',
                    active ? 'bg-blue text-white' : 'bg-canvas-deep text-ink-45',
                  )}
                >
                  {count}
                </span>
              ) : null}
              {active ? (
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-blue" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
