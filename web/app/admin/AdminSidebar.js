'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Building2, CalendarClock, ChartNoAxesCombined, CreditCard, FileText, Gauge, HeartPulse, Mail, User, Users,
  Landmark, MessageCircle, Radar, ScrollText, Settings, ShieldCheck, TrendingDown, UsersRound,
} from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { can, sectionPermission } from '@/lib/adminRoles';
import { useT } from '@/lib/i18n/client';
import { QueueBadge, useQueueCounts } from './LiveQueueCounts';

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
 * The design's footer block is a live "{t('admin.nav.todayRate')}" readout plus a
 * "{t('admin.nav.editRate')}" button. That rate is real and already admin-editable,
 * but it lives behind a server-only DB read (lib/currencyRate.js) that this
 * client component can't do, so the footer links to the CMS page that
 * actually owns it rather than restating a number it would have to be
 * passed. Same destination, no duplicated source of truth.
 */
// Keys, not text — see components/navItems.js.
const NAV = [
  { href: '/admin/dashboard', labelKey: 'admin.nav.dashboard', icon: BarChart3 },
  { href: '/admin/listings', labelKey: 'admin.nav.listings', icon: FileText },
  { href: '/admin/conversations', labelKey: 'admin.nav.conversations', icon: MessageCircle },
  { href: '/admin/leads', labelKey: 'admin.nav.leads', icon: Mail },
  { href: '/admin/matching', labelKey: 'admin.nav.matching', icon: Radar },
  { href: '/admin/viewings', labelKey: 'admin.nav.viewings', icon: CalendarClock },
  { href: '/admin/market-data', labelKey: 'admin.nav.marketData', icon: TrendingDown },
  { href: '/admin/benchmarks', labelKey: 'admin.nav.agentPerformance', icon: Gauge },
  // Labelled "Lead Analytics"; the URL stays /admin/telemetry so existing
  // bookmarks and revalidatePath calls keep working.
  { href: '/admin/telemetry', labelKey: 'admin.nav.telemetry', icon: ChartNoAxesCombined },
  { href: '/admin/agents', labelKey: 'admin.nav.agents', icon: User },
  { href: '/admin/agencies', labelKey: 'admin.nav.agencies', icon: Building2 },
  { href: '/admin/verifications', labelKey: 'admin.nav.verifications', icon: ShieldCheck },
  { href: '/admin/customers', labelKey: 'admin.nav.customers', icon: Users },
  { href: '/admin/subscriptions', labelKey: 'admin.nav.subscriptions', icon: Landmark },
  { href: '/admin/billing', labelKey: 'admin.nav.billing', icon: CreditCard },
  { href: '/admin/cms', labelKey: 'admin.nav.cms', icon: Settings },
  { href: '/admin/team', labelKey: 'admin.nav.team', icon: UsersRound },
  { href: '/admin/audit', labelKey: 'admin.nav.audit', icon: ScrollText },
  { href: '/admin/health', labelKey: 'admin.nav.health', icon: HeartPulse },
];

/** Which live work-queue count (lib/adminWorkQueues.js) badges which item. */
const BADGE_FOR = {
  '/admin/listings': 'pendingListings',
  '/admin/viewings': 'escalatedViewings',
  '/admin/conversations': 'humanConversations',
  '/admin/subscriptions': 'pendingPlanRequests',
  // Open ops incidents (services/opsAlerts.js) — where an alert lands when no
  // desk number is configured to receive it.
  '/admin/health': 'openAlerts',
};

export default function AdminSidebar({ mobile = false, role }) {
  const t = useT();
  const pathname = usePathname();
  const counts = useQueueCounts();
  // A role only sees the sections it may open. The layout and every action
  // enforce the same table server-side; hiding a link is not the security.
  const items = NAV.filter(({ href }) => can(role, sectionPermission(href)));

  // Below lg the royal rail is hidden (see layout.js) and the same real
  // destinations ride in a horizontal scroller instead — the design only
  // specifies a desktop console, and a 248px column would eat most of a
  // phone viewport.
  if (mobile) {
    return (
      <nav className="flex gap-1 overflow-x-auto border-b border-line bg-blue-deep px-4 py-2">
        {items.map(({ href, labelKey, icon: Icon }) => {
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
              <span className="flex-1">{t(labelKey)}</span>
              <QueueBadge count={counts?.[BADGE_FOR[href]]} />
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
        <img src="/brand/logo-dark.png" alt={t('footer.columns.brand')} className="h-6 w-auto self-start" />
        <span className="u-eyebrow text-white/60">{t('admin.chrome.eyebrow')}</span>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map(({ href, labelKey, icon: Icon }) => {
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
              <span className="flex-1">{t(labelKey)}</span>
              <QueueBadge count={counts?.[BADGE_FOR[href]]} />
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <span className="text-[0.8125rem] text-white/60">{t('admin.nav.todayRate')}</span>
        <Link
          href="/admin/cms"
          className="u-press inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-[0.8125rem] font-semibold text-white ring-1 ring-inset ring-white/70 transition-colors hover:bg-white hover:text-blue-deep"
        >
          {t('admin.nav.editRate')}
        </Link>
      </div>
    </aside>
  );
}
