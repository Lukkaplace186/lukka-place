import { redirect } from 'next/navigation';

/**
 * The old standalone "Mes demandes" list. Superseded by the Espace Client's
 * Messages & Visites tab, which shows the same requests with their agency
 * proposals, the visit timeline and the actions a customer can take. Kept only
 * so existing links (Header, Footer, navItems, bookmarks) still land.
 */
export default function DemandesPage() {
  redirect('/compte/client/messages');
}
