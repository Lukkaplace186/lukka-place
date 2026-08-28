import { Search, Heart, Mail, User } from 'lucide-react';

/**
 * The four primary destinations. Set and labels come from web/Design's
 * mobile tab bar exactly — Rechercher / Favoris / Demandes / Compte. This
 * replaced a five-item bar (Recherche / Favoris / Actus / Plan / Messages)
 * whose last three pointed at honest stub pages; the design carries none of
 * them, and "Demandes" and "Compte" both map onto real, working account
 * routes instead. /mises-a-jour, /plan and /messages still exist and are
 * still reachable by URL — they simply lost their tab-bar slot.
 *
 * Two former consumers of this exact set are both gone entirely now:
 * SideRail.js (a fixed desktop icon rail) and BottomNav.js (a fixed mobile
 * tab bar) — web/Design's screens never carried a left toolbar, and the
 * bottom bar was dropped on an explicit instruction to favour Header's own
 * hamburger menu + top-right utility row instead (see app/(site)/layout.js
 * and Header.js). Header's mobile Sheet menu is the last direct consumer
 * left; desktop reaches the same four destinations via Header's top-right
 * utility row (Rechercher through the search icon/FilterBar, Favoris and
 * Demandes as text links, Compte via the account dropdown).
 */
export const NAV_ITEMS = [
  { href: '/listings', label: 'Rechercher', icon: Search },
  { href: '/favoris', label: 'Favoris', icon: Heart },
  { href: '/compte/demandes', label: 'Demandes', icon: Mail },
  { href: '/compte/client', label: 'Compte', icon: User },
];

export function isNavItemActive(href, pathname) {
  if (href === '/listings') return pathname.startsWith('/listings');
  // '/compte/client' has its own children (favoris, alertes, messages...)
  // that must all light up the same 'Compte' tab, the same reason
  // '/listings' above uses startsWith rather than an exact match. The
  // sibling '/compte/demandes' tab stays a separate exact match — it's a
  // different route entirely, not a child of this one.
  if (href === '/compte/client') return pathname === href || pathname.startsWith(`${href}/`);
  return pathname === href;
}
