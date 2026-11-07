'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3, Building2, ChevronDown, Handshake, CalendarClock, ClipboardPaste, HandCoins, ChartNoAxesCombined, CreditCard, FileText, Gauge, HeartPulse, Mail, Newspaper, Presentation, User, Users,
  Building, Landmark, Link2, Megaphone, MessageCircle, Radar, ScrollText, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Star, Target, TrendingDown, TrendingUp, Truck, UsersRound,
} from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { can, sectionPermission } from '@/lib/adminRoles';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { QueueBadge, useQueueCounts } from './LiveQueueCounts';
import { ADMIN_NAV_GROUPS } from '@/lib/adminNav';
import {
  OPEN_GROUPS_STORAGE_KEY, PINNED_HREF, badgeTone, badgeValue, initialOpenGroups, isActiveHref, parseStoredOpenGroups,
  toggleOpenGroup, urgentTotal,
} from '@/lib/adminNavState';
import { ADMIN_SEARCH_EVENT } from './GlobalSearch';

/**
 * The royal admin rail from web/Design's "Console d'administration" screen:
 * a fixed 248px `--blue-deep` column, the white logo lockup over an
 * "Administration" eyebrow, the icon nav, and the exchange-rate block at the
 * bottom.
 *
 * Tidied 2026-11-06 (owner: "too messy"): the five groups and every icon
 * stay; each group folds (lib/adminNavState.js has the rules), the dashboard
 * is pinned above them, badges are red only when someone is waiting on us,
 * a folded group shows its urgent total, and group titles are white/65
 * (white/45 measured ~4.3:1 on the royal ground, under AA).
 *
 * The footer's rate lives behind a server-only DB read (lib/currencyRate.js),
 * so it links to the CMS page that owns it rather than restating a number.
 */
// Keys, not text — see components/navItems.js. The list itself lives in
// lib/adminNav.js (shared with /admin/settings).
const ICONS = { BarChart3, Building, Building2, CalendarClock, ClipboardPaste, ChartNoAxesCombined, CreditCard, FileText, Gauge, HandCoins, Handshake, HeartPulse, Landmark, Link2, Mail, Megaphone, MessageCircle, Newspaper, Presentation, Radar, ScrollText, Search, Send, Settings, ShieldCheck, SlidersHorizontal, Star, Target, TrendingDown, TrendingUp, Truck, User, Users, UsersRound };
const NAV_GROUPS = ADMIN_NAV_GROUPS.map((group) => ({
  ...group,
  items: group.items.map((item) => ({ ...item, icon: ICONS[item.icon] })),
}));

const NAV = NAV_GROUPS.flatMap((group) => group.items);

// The eyebrow's size and tracking in white. Not `.u-eyebrow text-white/…`:
// .u-eyebrow sets its own --ink-45 colour and wins over the utility (same
// layer, later in source), which is why the group titles rendered grey on
// royal — about 2:1, the faint labels in the 2026-11-06 screenshot.
const RAIL_LABEL = 'text-xs font-semibold uppercase leading-4 tracking-[1px] text-white/65';

function NavLink({ item, pathname, counts, t }) {
  const { href, labelKey, icon: Icon } = item;
  const active = isActiveHref(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-2.5 rounded-md px-3 text-[0.875rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        active ? 'bg-white/15 font-bold text-white' : 'font-semibold text-white/80 hover:bg-white/10 hover:text-white',
      )}
    >
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] shrink-0" />
      <span className="flex-1">{t(labelKey)}</span>
      <QueueBadge count={badgeValue(counts, href)} tone={badgeTone(href)} />
    </Link>
  );
}

export default function AdminSidebar({ mobile = false, role, hiddenTabs = [] }) {
  const t = useT();
  const pathname = usePathname();
  const counts = useQueueCounts();
  // A role only sees the sections it may open. The layout and every action
  // enforce the same table server-side; hiding a link is not the security.
  // Tabs hidden on /admin/settings (work in progress) leave the sidebar for
  // everyone; the page itself still opens from its URL so the team can work on it.
  const allowed = ({ href }) => can(role, sectionPermission(href)) && !hiddenTabs.includes(href);
  const items = NAV.filter(allowed);
  const pinned = items.find(({ href }) => href === PINNED_HREF) || null;
  const groups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed(item) && item.href !== PINNED_HREF) }))
    .filter((g) => g.items.length);

  // The server and the first client render agree (default + current page's
  // group); the person's stored choice is applied after mount, so it can
  // never cause a hydration mismatch.
  const [open, setOpen] = useState(() => initialOpenGroups(groups, pathname, null));
  useEffect(() => {
    let stored = null;
    try {
      stored = parseStoredOpenGroups(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY));
    } catch {
      stored = null;
    }
    // Landing on a page always opens its group, whatever was stored.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser storage, which the server cannot see
    setOpen(initialOpenGroups(groups, pathname, stored));
    // groups is derived from props that do not change while the console is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggle(key) {
    setOpen((current) => {
      const next = toggleOpenGroup(current, key);
      try {
        window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private mode or blocked storage: the fold still works for this visit.
      }
      return next;
    });
  }

  // Below lg the royal rail is hidden (see layout.js) and the same real
  // destinations ride in a horizontal scroller instead — a 248px column would
  // eat most of a phone viewport.
  if (mobile) {
    return (
      <nav className="flex gap-1 overflow-x-auto border-b border-line bg-blue-deep px-4 py-2">
        {items.map(({ href, labelKey, icon: Icon }) => {
          const active = isActiveHref(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[0.8125rem] transition-colors ${
                active ? 'bg-white/15 font-bold text-white' : 'font-semibold text-white/80'
              }`}
            >
              <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
              <span className="flex-1">{t(labelKey)}</span>
              <QueueBadge count={badgeValue(counts, href)} tone={badgeTone(href)} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-5 bg-blue-deep px-4 py-7">
      <div className="flex flex-col gap-1 px-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- static local
            brand asset, same reasoning as components/Brand.js */}
        <img src="/brand/logo-dark.png?v=2" alt={t('footer.columns.brand')} className="h-6 w-auto self-start" />
        <span className={RAIL_LABEL}>{t('admin.chrome.eyebrow')}</span>
      </div>

      {/* Opens the header's search (GlobalSearch) — the same box Ctrl/⌘K focuses. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(ADMIN_SEARCH_EVENT))}
        className="flex min-h-10 items-center gap-2.5 rounded-lg bg-white/10 px-3 text-left text-[0.8125rem] text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
        <span className="flex-1">{t('admin.nav.search')}</span>
        <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-[0.6875rem] font-semibold text-white">Ctrl K</kbd>
      </button>

      <nav className="flex flex-col gap-1">
        {pinned ? (
          <div className="pb-2">
            <NavLink item={pinned} pathname={pathname} counts={counts} t={t} />
          </div>
        ) : null}

        {groups.map((group) => {
          const isOpen = open.includes(group.labelKey);
          const waiting = isOpen ? 0 : urgentTotal(group.items, counts);
          const listId = `admin-nav-${group.labelKey.split('.').pop()}`;
          return (
            <div key={group.labelKey} className="flex flex-col">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={listId}
                onClick={() => toggle(group.labelKey)}
                className="flex min-h-11 items-center gap-2 rounded-md px-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <span className={cn(RAIL_LABEL, 'flex-1')}>{t(group.labelKey)}</span>
                {waiting > 0 ? <QueueBadge count={waiting} tone="urgent" /> : null}
                <ChevronDown
                  strokeWidth={ICON_STROKE_WIDTH}
                  aria-hidden="true"
                  className={cn('h-4 w-4 shrink-0 text-white/65 transition-transform', isOpen && 'rotate-180')}
                />
              </button>
              {isOpen ? (
                <div id={listId} className="flex flex-col gap-0.5 pb-2">
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} counts={counts} t={t} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 px-1">
        <span className="text-[0.8125rem] text-white/65">{t('admin.nav.todayRate')}</span>
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
