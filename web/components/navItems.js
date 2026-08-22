import { Search, Heart, Bell, ClipboardList, MessageCircle } from 'lucide-react';

/**
 * The five primary destinations, shared by BottomNav (mobile) and SideRail
 * (desktop) so the two can never drift apart.
 *
 * Only "Recherche" and "Favoris" map onto something substantial today — see
 * app/(site)/mises-a-jour, /plan and /messages for what the other three
 * actually do (honest stub pages, not dead links; /messages routes to the
 * real WhatsApp channel).
 */
export const NAV_ITEMS = [
  { href: '/listings', label: 'Recherche', icon: Search },
  { href: '/favoris', label: 'Favoris', icon: Heart },
  { href: '/mises-a-jour', label: 'Actus', icon: Bell },
  { href: '/plan', label: 'Plan', icon: ClipboardList },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
];

export function isNavItemActive(href, pathname) {
  if (href === '/listings') return pathname.startsWith('/listings');
  return pathname === href;
}
