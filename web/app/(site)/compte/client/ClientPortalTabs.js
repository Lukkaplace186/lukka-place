'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Search, MessageCircle, UserRound } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

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
/**
 * ORDER IS THE FUNNEL, and it is not alphabetical or historical — it is the
 * order a customer actually moves through:
 *
 *   1. Favoris & Alertes  — what they saved while browsing
 *   2. Trouver pour moi   — the request they make when browsing wasn't enough
 *   3. Messages & Visites — where that request is answered and tracked
 *
 * "Trouver pour moi" used to sit AFTER "Messages & Visites", which put the
 * destination before the action that fills it: a new customer met an empty
 * inbox before ever being offered the form that populates it. Submitting the
 * form now lands on tab 3 (../actions.js's submitPropertyRequestAction) and
 * tab 3's empty state points back at tab 2 (./messages/page.js), so the two
 * are a loop in both directions rather than two unconnected pages.
 *
 * Paramètres stays last: it is not part of the funnel.
 */
// Keys, not text — see components/navItems.js.
// `shortKey` + `icon` are the phone layout: four equal segments, nothing to
// scroll sideways. At 375px the full labels ran past the edge, so "Mon
// profil" and half of "Trouver pour moi" were off-screen.
const TABS = [
  { href: '/compte/client', labelKey: 'account.portal.tabs.favorites', shortKey: 'account.portal.tabsShort.favorites', icon: Heart, exact: true, countKey: 'savedTotal' },
  { href: '/compte/client/demandes', labelKey: 'account.portal.tabs.findForMe', shortKey: 'account.portal.tabsShort.findForMe', icon: Search },
  { href: '/compte/client/messages', labelKey: 'account.portal.tabs.messages', shortKey: 'account.portal.tabsShort.messages', icon: MessageCircle, countKey: 'inquiries' },
  { href: '/compte/client/parametres', labelKey: 'account.portal.tabs.profile', shortKey: 'account.portal.tabsShort.profile', icon: UserRound },
];

export default function ClientPortalTabs({ counts = {} }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <div className="sticky top-16 z-20 border-y border-line bg-surface">
      <nav
        aria-label={t('account.portal.title')}
        className="mx-auto grid max-w-[77.5rem] grid-cols-4 sm:flex sm:gap-1.5 sm:px-6 lg:px-8"
      >
        {TABS.map(({ href, labelKey, shortKey, icon: Icon, exact, countKey }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const count = countKey ? counts[countKey] : null;

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              aria-label={t(labelKey)}
              className={cn(
                'relative flex min-w-0 flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[0.6875rem] transition-colors',
                'sm:inline-flex sm:shrink-0 sm:flex-row sm:gap-2 sm:whitespace-nowrap sm:px-4 sm:pb-[1.0625rem] sm:pt-5 sm:text-[0.875rem]',
                active ? 'font-bold text-ink' : 'font-medium text-ink-45 hover:text-ink-70',
              )}
            >
              {/* Phone: icon with the count riding on it, short label under. */}
              <span className="relative sm:hidden">
                <Icon
                  strokeWidth={ICON_STROKE_WIDTH}
                  className={cn('h-5 w-5', active ? 'text-blue' : 'text-ink-45')}
                  aria-hidden="true"
                />
                {count ? (
                  <span className="u-tabular absolute -right-2.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue px-1 text-[0.625rem] font-bold leading-none text-white">
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate sm:hidden">{t(shortKey)}</span>

              <span className="hidden sm:inline">{t(labelKey)}</span>
              {count ? (
                <span
                  className={cn(
                    'u-tabular hidden min-w-5 justify-center rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold sm:inline-flex',
                    active ? 'bg-blue text-white' : 'bg-canvas-deep text-ink-45',
                  )}
                >
                  {count}
                </span>
              ) : null}
              {active ? (
                <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[3px] rounded-t bg-blue sm:inset-x-0 sm:rounded-none" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
