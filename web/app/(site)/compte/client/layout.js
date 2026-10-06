import { redirect } from 'next/navigation';
import { getPortalCustomer, getPortalCounts } from '@/lib/customerPortal';
import { ToastProvider } from '@/components/Toast';
import ClientPortalTabs from './ClientPortalTabs';
import { getT } from '@/lib/i18n/server';

// generateMetadata rather than a static object, so the tab title follows the
// language too — see app/(site)/a-propos/page.js.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('account.portal.metaTitle'),
    robots: { index: false, follow: false },
  };
}

/**
 * Espace Client shell — web/Design/Customer dash's "Espace Client" canvas.
 *
 * The design puts the greeting above the tab bar and keeps both on every
 * tab, so both live here rather than being re-declared by seven pages.
 * Each page still guards its own session (a layout is not an authorization
 * boundary you should rely on alone) and still owns its own h2.
 *
 * Ground is `bg-canvas-warm` (#F9F8F6) — the design's own <body> fill for
 * this canvas, and the one surface in this app that isn't white. White
 * cards read as figure against it; that contrast is the whole point of the
 * portal's look and is why the token exists (app/globals.css).
 *
 * The tab bar sticks at `top-16`, under the fixed h-16 Header — the same
 * coupling FilterBar.js already depends on (web/CLAUDE.md's layout notes).
 */
export default async function ClientPortalLayout({ children }) {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client');

  const { customerId } = session;
  const counts = await getPortalCounts(customerId);
  // Favoris+Alertes collapsed into one tab (ClientPortalTabs.js), so its nav
  // pill shows the combined total rather than picking just one of the two
  // real per-metric counts getPortalCounts() already returns.
  const tabCounts = { ...counts, savedTotal: counts.favorites + counts.alerts };

  return (
    // Ground is canvas-warm, the portal's own fill. The greeting that sat
    // above the tabs on every page now opens Accueil only (2026-10-05): each
    // tab carries its own title, and on a phone the old block took a fifth of
    // the screen before any of the customer's content.
    <div className="min-h-screen bg-canvas-warm">
      <ClientPortalTabs counts={tabCounts} />

      <ToastProvider>
        {/* The phone's fixed bottom bar is cleared by the compact footer
            below the page (components/Footer.js), not by this padding. */}
        <main className="mx-auto max-w-[77.5rem] px-4 pb-10 pt-5 sm:px-6 sm:pt-8 lg:px-8 lg:pb-24 lg:pt-10">{children}</main>
      </ToastProvider>
    </div>
  );
}
