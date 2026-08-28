import { Search, Heart, Mail, User } from 'lucide-react';

/**
 * The four primary destinations, shared by BottomNav (mobile) and SideRail
 * (desktop) so the two can never drift apart.
 *
 * Set and labels come from web/Design's mobile tab bar exactly —
 * Rechercher / Favoris / Demandes / Compte. This replaced a five-item bar
 * (Recherche / Favoris / Actus / Plan / Messages) whose last three pointed
 * at honest stub pages; the design carries none of them, and "Demandes"
 * and "Compte" both map onto real, working account routes instead.
 * /mises-a-jour, /plan and /messages still exist and are still reachable
 * by URL — they simply lost their tab-bar slot.
 */
export const NAV_ITEMS = [
  { href: '/listings', label: 'Rechercher', icon: Search },
  { href: '/favoris', label: 'Favoris', icon: Heart },
  { href: '/compte/demandes', label: 'Demandes', icon: Mail },
  { href: '/compte', label: 'Compte', icon: User },
];

export function isNavItemActive(href, pathname) {
  if (href === '/listings') return pathname.startsWith('/listings');
  // /compte must not light up on /compte/demandes (or any other child) —
  // they are two separate tabs.
  if (href === '/compte') return pathname === '/compte';
  return pathname === href;
}
