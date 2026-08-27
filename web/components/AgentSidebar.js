'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, Landmark, Mail, SlidersHorizontal, LogOut } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { Wordmark } from './Brand';

/**
 * Agent dashboard app shell nav — mirrors app/admin/AdminSidebar.js's
 * structure (usePathname-driven active state, a `mobile` rendering for
 * small screens) but on a white rail with a royal-fill active pill, per
 * web/Design's "Espace agent" screen — the admin console's own solid
 * blue-deep rail is a different, internal-tool register on purpose.
 *
 * `listingsCount`/`newLeadsCount` are real counts passed down from
 * app/compte/agent/layout.js's own fetch (own listings length, leads with
 * status='NEW'); no fabricated badge is ever shown when a count is 0 or
 * undefined — the badge only renders for a truthy count, same convention
 * the source design's own `count && ...` guard used.
 */
const NAV = [
  { href: '/compte/agent', label: "Vue d'ensemble", short: 'Vue', icon: BarChart3, exact: true },
  { href: '/compte/agent/biens', label: 'Mes biens', short: 'Biens', icon: Landmark, countKey: 'listings' },
  { href: '/compte/agent/demandes', label: 'Demandes', short: 'Demandes', icon: Mail, countKey: 'leads' },
  { href: '/compte/agent/parametres', label: 'Paramètres', short: 'Réglages', icon: SlidersHorizontal },
];

function isActive(pathname, item) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export default function AgentSidebar({ agentName, agentInitials, listingsCount, newLeadsCount, logoutAction }) {
  const pathname = usePathname();
  const counts = { listings: listingsCount, leads: newLeadsCount };

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-7 border-r border-line bg-white px-4 py-6 lg:flex">
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
                className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold transition-colors ${
                  active ? 'bg-blue text-white' : 'text-ink-70 hover:bg-canvas-alt'
                }`}
              >
                <item.icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {!!count && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      active ? 'bg-white/25 text-white' : 'bg-canvas-deep text-ink-70'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2.5 px-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-tint text-[0.8125rem] font-extrabold text-blue-deep">
            {agentInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.8125rem] font-bold text-ink">{agentName}</div>
            <form action={logoutAction}>
              <button type="submit" className="inline-flex items-center gap-1 text-xs text-ink-45 hover:text-ink">
                <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
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
                <span className="relative">
                  <item.icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.375rem] w-[1.375rem]" />
                  {!!count && (
                    <span className="absolute -right-1.5 -top-1 rounded-full bg-blue px-[5px] text-[0.5625rem] font-bold text-white">
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
