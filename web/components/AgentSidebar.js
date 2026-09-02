'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Landmark, Mail, SlidersHorizontal, Building2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { Wordmark } from './Brand';

/**
 * The design's 260px agent rail (web/Design "Espace agent"), cloned:
 * white column with a hairline right border, the logo lockup over an
 * "Espace agent" eyebrow, an icon nav whose active item takes a solid
 * royal-600 fill and whose counts ride in a pill, a "Profil complété"
 * progress card pinned to the bottom, and the account block under it.
 *
 * Deliberately NOT the admin console's solid blue-deep rail
 * (app/admin/AdminSidebar.js) — the design gives the agent surface a white
 * rail and the internal console a royal one, and that contrast is the point.
 *
 * Every number here is real: `listingsCount` is the agent's own listing
 * count, `newLeadsCount` is a real count of leads at status NEW, and
 * `completion` is computed by lib/agencies.js's agentProfileCompletion from
 * fields that actually exist and actually change what a visitor sees. The
 * design's own 82 % / "Ajoutez une photo de couverture" is sample data —
 * there is no cover-photo column on this schema, so that specific hint
 * never appears; the real next gap does.
 *
 * Below `lg` this renders as a mobile tab bar instead, one entry per NAV item.
 *
 * Visites is no longer its own section — it is a tab inside Demandes (a
 * viewing request is a stage of the same client conversation, not a second
 * inbox). Its pending count therefore rolls into the Demandes badge rather
 * than disappearing: the badge means "items in this section waiting on you",
 * which after the merge is genuinely new leads *plus* unanswered visit
 * requests. Both halves are real counts (see lib/agentDashboard.js).
 */
const NAV = [
  { href: '/compte/agent', label: "Vue d'ensemble", short: 'Vue', icon: BarChart3, exact: true },
  { href: '/compte/agent/biens', label: 'Mes biens', short: 'Biens', icon: Landmark, countKey: 'listings' },
  { href: '/compte/agent/demandes', label: 'Demandes & visites', short: 'Demandes', icon: Mail, countKey: 'leads' },
  { href: '/compte/agent/parametres', label: 'Paramètres', short: 'Réglages', icon: SlidersHorizontal },
];

function isActive(pathname, item) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AgentSidebar({
  agentName,
  agentInitials,
  listingsCount,
  newLeadsCount,
  pendingVisitsCount,
  completion,
  logoutAction,
}) {
  const pathname = usePathname();
  const counts = { listings: listingsCount, leads: newLeadsCount + pendingVisitsCount };

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-7 border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <Wordmark />
          <div className="mt-1 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-ink-35">Espace agent</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            const count = item.countKey ? counts[item.countKey] : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-[10px] px-3 py-[0.6875rem] text-sm font-semibold transition-colors ${
                  active ? 'bg-blue text-white' : 'text-ink-70 hover:bg-canvas-alt'
                }`}
              >
                <item.icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {!!count && (
                  <span
                    className={`u-tabular rounded-full px-2 py-0.5 text-xs font-bold ${
                      active ? 'bg-white/[0.22] text-white' : 'bg-canvas-deep text-ink-70'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {completion && (
          <div className="mt-auto flex flex-col gap-3 rounded-card bg-canvas-alt p-4">
            <div className="flex items-center justify-between text-[0.8125rem] font-semibold text-ink-70">
              <span>Profil complété</span>
              <span className="u-tabular">{completion.percent} %</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-valuenow={completion.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profil complété"
            >
              <div className="h-full rounded-full bg-blue transition-all" style={{ width: `${completion.percent}%` }} />
            </div>
            {completion.nextHint && <p className="text-xs leading-relaxed text-ink-45">{completion.nextHint}</p>}
          </div>
        )}

        <div className={`flex items-center gap-2.5 px-2 ${completion ? '' : 'mt-auto'}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-tint text-[0.8125rem] font-extrabold text-blue-deep">
            {agentInitials || <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-bold text-ink">{agentName}</div>
            <form action={logoutAction}>
              <button type="submit" className="text-xs text-ink-45 transition-colors hover:text-ink">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </aside>

      <nav
        aria-label="Navigation espace agent"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV.map((item) => {
            const active = isActive(pathname, item);
            const count = item.countKey ? counts[item.countKey] : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`u-press relative flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-semibold transition-colors ${
                  active ? 'text-blue' : 'text-ink-35'
                }`}
              >
                <span className="relative">
                  <item.icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.375rem] w-[1.375rem]" />
                  {!!count && (
                    <span className="u-tabular absolute -right-2 -top-1 rounded-full bg-blue px-[5px] text-[0.5625rem] font-bold text-white">
                      {count}
                    </span>
                  )}
                </span>
                {item.short}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
