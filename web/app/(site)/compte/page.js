import { redirect } from 'next/navigation';
import { getCurrentCustomerId } from '@/lib/customers';

/**
 * `/compte` no longer renders its own account overview — the Espace Client
 * portal's "Vue d'ensemble" tab (app/(site)/compte/client/page.js) covers
 * the same ground (favoris, alertes, demandes) plus messages/visites/
 * parametres, so this route now exists only as the stable entry point every
 * existing `/compte` link (header, bottom nav, bookmarks) forwards through.
 *
 * Middleware (middleware.js) already gates `/compte/:path*` behind the
 * customer session cookie, so an unauthenticated request here has normally
 * already been redirected to `/compte/connexion?next=/compte` before this
 * component ever runs. The explicit check below is defense-in-depth, same
 * posture as every other /compte/* page (see e.g.
 * app/(site)/compte/client/layout.js's own doc comment: "a layout is not an
 * authorization boundary you should rely on alone") — and it sends a
 * logged-out visitor straight to /compte/client afterwards rather than back
 * through this redirect a second time.
 */
export default async function AccountPage() {
  const customerId = await getCurrentCustomerId();
  redirect(customerId ? '/compte/client' : '/compte/connexion?next=/compte/client');
}
