'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, Heart, House, MessageCircle, UserRound } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/**
 * Espace Client navigation (2026-10-05 redesign, approved from
 * web/Design/client-portal-prototype.html, same language as the agent
 * portal):
 *
 *   Accueil      /compte/client           what waits on the customer
 *   Enregistrés  /compte/client/favoris   favourites + alerts (?tab=alertes)
 *   Visites      /compte/client/visites   the visit agenda (was a link inside Messages)
 *   Demandes     /compte/client/messages  requests and the answers to them;
 *                                         the form (/demandes) is part of the tab
 *   Profil       /compte/client/parametres
 *
 * Phone: a fixed bottom bar, five equal 58px targets, the active tab marked by
 * a bar on its top edge — the same bar as the agent portal. The public
 * storefront deliberately has no bottom bar (web/CLAUDE.md, "Layout &
 * shell"); this one exists only inside the signed-in portal, where the
 * customer moves between their own five places. From `lg` it is the sticky
 * strip under the site header it always was.
 *
 * Counts are totals (grey), passed in by the layout from cheap reads
 * (lib/customerPortal.js getPortalCounts) and omitted at zero or when the
 * engine could not answer. Nothing here re-runs a saved search.
 */
// Keys, not text — see components/navItems.js.
export const PORTAL_TABS = [
  { href: '/compte/client', labelKey: 'account.portal.nav.home', icon: House, match: (p) => p === '/compte/client' },
  {
    href: '/compte/client/favoris',
    labelKey: 'account.portal.nav.saved',
    icon: Heart,
    countKey: 'savedTotal',
    match: (p) => p.startsWith('/compte/client/favoris') || p.startsWith('/compte/client/alertes'),
  },
  {
    href: '/compte/client/visites',
    labelKey: 'account.portal.nav.visits',
    icon: CalendarDays,
    countKey: 'viewings',
    match: (p) => p.startsWith('/compte/client/visites'),
  },
  {
    href: '/compte/client/messages',
    labelKey: 'account.portal.nav.requests',
    icon: MessageCircle,
    countKey: 'inquiries',
    match: (p) => p.startsWith('/compte/client/messages') || p.startsWith('/compte/client/demandes'),
  },
  { href: '/compte/client/parametres', labelKey: 'account.portal.nav.profile', icon: UserRound, match: (p) => p.startsWith('/compte/client/parametres') },
];

export default function ClientPortalTabs({ counts = {} }) {
  const t = useT();
  const pathname = usePathname() || '';

  return (
    <>
      {/* Desktop: the sticky strip under the fixed h-16 site header. */}
      <div className="sticky top-16 z-20 hidden border-y border-line bg-surface lg:block">
        <nav aria-label={t('account.portal.title')} className="mx-auto flex max-w-[77.5rem] gap-1.5 px-8">
          {PORTAL_TABS.map(({ href, labelKey, icon: Icon, countKey, match }) => {
            const active = match(pathname);
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
                <Icon strokeWidth={ICON_STROKE_WIDTH} className={cn('h-[1.125rem] w-[1.125rem]', active ? 'text-blue' : 'text-ink-35')} aria-hidden="true" />
                {t(labelKey)}
                {count ? (
                  <span className="u-tabular inline-flex min-w-5 justify-center rounded-full bg-canvas-deep px-1.5 py-0.5 text-[0.6875rem] font-bold text-ink-70">
                    {count}
                  </span>
                ) : null}
                {active ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-blue" /> : null}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Phone and tablet: the bottom bar. */}
      <nav
        aria-label={t('account.portal.title')}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {PORTAL_TABS.map(({ href, labelKey, icon: Icon, countKey, match }) => {
          const active = match(pathname);
          const count = countKey ? counts[countKey] : null;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'u-press relative flex min-h-[3.625rem] min-w-0 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] font-semibold transition-colors',
                active ? 'text-blue' : 'text-ink-45',
              )}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-[28%] top-0 h-[3px] rounded-b-[3px] bg-blue" />}
              <span className="relative">
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.375rem] w-[1.375rem]" aria-hidden="true" />
                {count ? (
                  <span className="u-tabular absolute -right-3 -top-1.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-canvas-deep px-[5px] text-[0.65625rem] font-extrabold text-ink-70 ring-2 ring-surface">
                    {count}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate px-0.5">{t(labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
