'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, FileText, Mail, User, Landmark, MessageCircle, Radar, Settings } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The royal admin rail from web/Design's "Console d'administration" screen.
 *
 * Design anatomy: a fixed 248px `--surface-royal` column, the white logo
 * lockup over an "Administration" eyebrow, an icon nav whose active item
 * takes a `rgba(255,255,255,.14)` fill and 700 weight, and a footer block
 * pinned to the bottom.
 *
 * This replaces the previous admin chrome — a white top bar with seven
 * plain text links — which shared nothing with the design.
 *
 * The design's footer block is a live "Taux du jour" readout plus a
 * "Modifier le taux" button. That rate is real and already admin-editable,
 * but it lives behind a server-only DB read (lib/currencyRate.js) that this
 * client component can't do, so the footer links to the CMS page that
 * actually owns it rather than restating a number it would have to be
 * passed. Same destination, no duplicated source of truth.
 */
const NAV = [
  { href: '/admin/dashboard', label: 'Tableau de bord', icon: BarChart3 },
  { href: '/admin/listings', label: 'Annonces', icon: FileText },
  { href: '/admin/conversations', label: 'Conversations', icon: MessageCircle },
  { href: '/admin/leads', label: 'Prospects', icon: Mail },
  { href: '/admin/matching', label: 'Attribution', icon: Radar },
  { href: '/admin/agents', label: 'Agents', icon: User },
  { href: '/admin/subscriptions', label: 'Abonnements', icon: Landmark },
  { href: '/admin/cms', label: 'CMS', icon: Settings },
];

export default function AdminSidebar({ mobile = false }) {
  const pathname = usePathname();

  // Below lg the royal rail is hidden (see layout.js) and the same real
  // destinations ride in a horizontal scroller instead — the design only
  // specifies a desktop console, and a 248px column would eat most of a
  // phone viewport.
  if (mobile) {
    return (
      <nav className="flex gap-1 overflow-x-auto border-b border-line bg-blue-deep px-4 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[0.8125rem] transition-colors ${
                active ? 'bg-white/15 font-bold text-white' : 'font-semibold text-white/75'
              }`}
            >
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-7 bg-blue-deep px-5 py-7">
      <div className="flex flex-col gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- static local
            brand asset, same reasoning as components/Brand.js */}
        <img src="/brand/logo-dark.png" alt="Lukka Place" className="h-6 w-auto self-start" />
        <span className="u-eyebrow text-white/60">Administration</span>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-[0.875rem] transition-colors ${
                active ? 'bg-white/15 font-bold text-white' : 'font-semibold text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <span className="text-[0.8125rem] text-white/60">Taux du jour</span>
        <Link
          href="/admin/cms"
          className="u-press inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[0.8125rem] font-semibold text-white ring-1 ring-inset ring-white/70 transition-colors hover:bg-white hover:text-blue-deep"
        >
          Modifier le taux
        </Link>
      </div>
    </aside>
  );
}
